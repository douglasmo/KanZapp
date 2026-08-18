// Unica camada que fala com chrome.storage.
// Toda escrita passa por uma fila FIFO: read-modify-write nunca se perde (P4).

import { STORAGE_KEY } from './constants.js';
import { deepClone, nextId } from './utils.js';

const CONTEXT_DEAD = /extension context invalidated|receiving end does not exist|context invalidated/i;
const DEFAULT_LOCK_LEASE_MS = 30000;
const DEFAULT_LOCK_TIMEOUT_MS = 45000;
const DEFAULT_LOCK_POLL_MS = 20;

function isContextError(error) {
  return CONTEXT_DEAD.test(String(error?.message || error || ''));
}

/**
 * @param {{area?: 'local'|'sync', key?: string, logger?: object,
 *          lockLeaseMs?: number, lockTimeoutMs?: number, lockPollMs?: number}} [options]
 */
export function createStorageDriver(options = {}) {
  const {
    area = 'local',
    key = STORAGE_KEY,
    logger = null,
    lockLeaseMs = DEFAULT_LOCK_LEASE_MS,
    lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
    lockPollMs = DEFAULT_LOCK_POLL_MS
  } = options;
  let lockOwner = '';
  try {
    lockOwner = `ctx_${globalThis.crypto.randomUUID()}`;
  } catch {
    lockOwner = nextId('ctx');
  }
  const lockPrefix = `${key}.__lock__.`;
  const lockKey = `${lockPrefix}${lockOwner}`;

  let cache = null;
  let cacheValid = false;
  /** Serializa as escritas: cada mutate encadeia na cauda da fila. */
  let queue = Promise.resolve(null);
  let queueDepth = 0;
  /** Assinatura JSON da ultima escrita propria, para filtrar o proprio onChanged. */
  let lastWrittenJson = null;
  const subscribers = new Set();
  let watcher = null;

  function log(level, ...args) {
    if (logger && typeof logger[level] === 'function') logger[level](...args);
  }

  function chromeApi() {
    // acesso tardio: em testes o stub e instalado depois do import
    return typeof globalThis !== 'undefined' ? globalThis.chrome : undefined;
  }

  function storageArea() {
    const api = chromeApi();
    return api?.storage?.[area] || null;
  }

  function isContextAlive() {
    try {
      return Boolean(chromeApi()?.runtime?.id);
    } catch {
      return false;
    }
  }

  /** Normaliza get/set/remove para Promise, aceitando callback ou promise. */
  function call(method, arg) {
    const store = storageArea();
    if (!store || typeof store[method] !== 'function') return Promise.resolve(undefined);
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        const api = chromeApi();
        const err = api?.runtime?.lastError;
        if (err) {
          if (!isContextError(err)) log('warn', `storage.${method} falhou`, err.message || err);
          resolve(undefined);
          return;
        }
        resolve(value);
      };
      try {
        const maybe = arg === undefined ? store[method](done) : store[method](arg, done);
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(done, (error) => {
            if (!isContextError(error)) log('warn', `storage.${method} rejeitou`, error);
            done(undefined);
          });
        }
      } catch (error) {
        if (!isContextError(error)) log('warn', `storage.${method} lancou`, error);
        done(undefined);
      }
    });
  }

  async function loadFromDisk() {
    const result = await call('get', [key]);
    const value = result && typeof result === 'object' ? result[key] : null;
    cache = value && typeof value === 'object' ? value : null;
    cacheValid = true;
    return cache;
  }

  /** Le o estado v2. Usa o cache em memoria; so vai ao disco se ele estiver sujo. */
  async function read() {
    ensureWatcher();
    if (cacheValid) return cache;
    if (!isContextAlive()) return cache;
    return loadFromDisk();
  }

  async function write(state) {
    const json = safeJson(state);
    lastWrittenJson = json;
    await call('set', { [key]: state });
    return state;
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function readLocks() {
    const all = await call('get', null);
    const locks = [];
    if (!all || typeof all !== 'object') return locks;
    for (const [storageKey, value] of Object.entries(all)) {
      if (!storageKey.startsWith(lockPrefix) || !value || typeof value !== 'object') continue;
      locks.push({ storageKey, ...value });
    }
    return locks;
  }

  function isLiveLock(lock, now = Date.now()) {
    return Number.isFinite(lock?.expiresAt) && lock.expiresAt > now;
  }

  function hasPrecedence(left, right) {
    const leftTicket = Number(left?.ticket) || 0;
    const rightTicket = Number(right?.ticket) || 0;
    if (leftTicket !== rightTicket) return leftTicket < rightTicket;
    return String(left?.owner || '') < String(right?.owner || '');
  }

  function isBlocked(locks, own, now) {
    return locks.some((lock) => {
      if (lock.owner === lockOwner || !isLiveLock(lock, now)) return false;
      if (lock.choosing === true) return true;
      return Number(lock.ticket) > 0 && hasPrecedence(lock, own);
    });
  }

  /**
   * Lamport bakery lock usando uma chave por contexto. Diferente de um unico
   * objeto de lock, as candidaturas nao se sobrescrevem; o desempate por
   * ticket/owner garante exclusao mutua inclusive entre abas e o worker.
   */
  async function acquireWriteLock() {
    const poll = Math.max(5, Number(lockPollMs) || DEFAULT_LOCK_POLL_MS);
    const lease = Math.max(200, Number(lockLeaseMs) || DEFAULT_LOCK_LEASE_MS);
    const requestedTimeout = Number(lockTimeoutMs) || DEFAULT_LOCK_TIMEOUT_MS;
    // Um contender deve sobreviver ao lease completo de um owner que morreu.
    const timeout = Math.max(lease + Math.max(200, poll * 4), requestedTimeout);
    const deadline = Date.now() + timeout;

    await call('set', {
      [lockKey]: {
        owner: lockOwner,
        choosing: true,
        ticket: 0,
        expiresAt: Date.now() + lease
      }
    });
    if (!isContextAlive()) return null;

    const initial = await readLocks();
    const staleKeys = initial
      .filter((lock) => lock.owner !== lockOwner && !isLiveLock(lock))
      .map((lock) => lock.storageKey);
    if (staleKeys.length) await call('remove', staleKeys);
    const highest = initial.reduce((max, lock) => {
      return isLiveLock(lock) ? Math.max(max, Number(lock.ticket) || 0) : max;
    }, 0);
    const own = {
      owner: lockOwner,
      choosing: false,
      ticket: highest + 1,
      expiresAt: Date.now() + lease,
      leaseMs: lease
    };
    await call('set', { [lockKey]: own });

    while (Date.now() < deadline && isContextAlive()) {
      const now = Date.now();
      if (own.expiresAt - now < lease / 2) {
        own.expiresAt = now + lease;
        await call('set', { [lockKey]: own });
      }
      let locks = await readLocks();
      const expiredKeys = locks
        .filter((entry) => entry.owner !== lockOwner && !isLiveLock(entry, now))
        .map((entry) => entry.storageKey);
      if (expiredKeys.length) {
        await call('remove', expiredKeys);
        locks = await readLocks();
      }
      const registered = locks.some((lock) => lock.owner === lockOwner && lock.ticket === own.ticket);
      if (registered && !isBlocked(locks, own, now)) return own;
      await wait(poll);
    }

    log('error', 'timeout ao adquirir lock de escrita cross-context');
    await call('remove', [lockKey]);
    return null;
  }

  /** Renova o lease enquanto o mutator (que pode ser async) esta executando. */
  function startWriteLockHeartbeat(lock) {
    let stopped = false;
    let timer = null;
    let inFlight = Promise.resolve();
    const interval = Math.max(50, Math.floor(lock.leaseMs / 3));

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(() => {
        timer = null;
        if (stopped) return;
        inFlight = (async () => {
          lock.expiresAt = Date.now() + lock.leaseMs;
          await call('set', { [lockKey]: lock });
        })();
        inFlight.finally(schedule);
      }, interval);
    };
    schedule();

    return async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await inFlight;
    };
  }

  async function releaseWriteLock() {
    await call('remove', [lockKey]);
  }

  /**
   * Aplica `fn(draft)` de forma serializada. Resolve sempre (nunca rejeita):
   * em contexto morto devolve o cache atual sem escrever.
   */
  function mutate(fn) {
    queueDepth += 1;
    const run = async () => {
      let lock = null;
      let stopHeartbeat = null;
      try {
        ensureWatcher();
        if (!isContextAlive()) return cache;
        lock = await acquireWriteLock();
        if (!lock) {
          if (isContextAlive()) await loadFromDisk();
          return cache;
        }
        stopHeartbeat = startWriteLockHeartbeat(lock);
        // O cache pode ter sido preenchido antes de outra aba escrever. A
        // leitura fresca, ja dentro do lock, e o que fecha o lost update.
        const current = await loadFromDisk();
        const draft = current ? deepClone(current) : null;
        const produced = await fn(draft);
        const next = produced === undefined ? draft : produced;
        cache = next;
        cacheValid = true;
        await write(next);
        return next;
      } catch (error) {
        if (!isContextError(error)) log('error', 'mutate falhou', error);
        return cache;
      } finally {
        if (stopHeartbeat) await stopHeartbeat();
        if (lock) await releaseWriteLock();
        queueDepth -= 1;
      }
    };
    // encadeia nos dois ramos: uma falha anterior nao pode travar a fila
    queue = queue.then(run, run);
    return queue;
  }

  /** Espera a fila drenar (util em testes e no unmount). */
  function flush() {
    return queue.then(
      () => undefined,
      () => undefined
    );
  }

  async function readRaw(keys) {
    if (!isContextAlive()) return {};
    const result = await call('get', keys);
    return result && typeof result === 'object' ? result : {};
  }

  async function removeRaw(keys) {
    if (!isContextAlive()) return false;
    await call('remove', keys);
    return true;
  }

  /**
   * Um unico listener de `onChanged` por driver mantem o cache coerente,
   * mesmo que ninguem tenha chamado `onExternalChange`.
   */
  function ensureWatcher() {
    if (watcher) return;
    const onChanged = chromeApi()?.storage?.onChanged;
    if (!onChanged || typeof onChanged.addListener !== 'function') return;
    const handler = (changes, changedArea) => {
      if (changedArea && changedArea !== area) return;
      if (!changes || !Object.prototype.hasOwnProperty.call(changes, key)) return;
      const next = changes[key]?.newValue ?? null;
      const json = safeJson(next);
      cache = next && typeof next === 'object' ? next : null;
      cacheValid = true;
      if (json !== null && json === lastWrittenJson) return; // eco da propria escrita
      for (const cb of [...subscribers]) {
        try {
          cb(cache);
        } catch (error) {
          log('error', 'listener de mudanca externa falhou', error);
        }
      }
    };
    onChanged.addListener(handler);
    watcher = () => {
      try {
        onChanged.removeListener(handler);
      } catch {
        /* worker ja encerrado */
      }
      watcher = null;
    };
  }

  /** Escuta mudancas vindas de outras abas. Devolve o unsubscribe. */
  function onExternalChange(cb) {
    if (typeof cb !== 'function') return () => {};
    ensureWatcher();
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  }

  /** Remove o listener global do driver. */
  function dispose() {
    subscribers.clear();
    if (watcher) watcher();
  }

  /** Invalida o cache: a proxima leitura vai ao disco. */
  function invalidate() {
    cacheValid = false;
    return true;
  }

  return {
    read,
    mutate,
    flush,
    readRaw,
    removeRaw,
    onExternalChange,
    isContextAlive,
    invalidate,
    dispose,
    get pending() {
      return queueDepth;
    },
    get storageKey() {
      return key;
    }
  };
}
