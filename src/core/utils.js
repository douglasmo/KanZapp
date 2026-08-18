// Utilitarios puros. Nenhuma dependencia de DOM: tudo aqui roda em Node.

import { JID_RE, JID_ANY_RE } from './constants.js';

/** Agenda `fn` para depois de `wait` ms sem novas chamadas. */
export function debounce(fn, wait = 200) {
  let timer = null;
  function debounced(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  }
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

/** Executa no maximo uma vez a cada `wait` ms (borda inicial + final). */
export function throttle(fn, wait = 200) {
  let last = 0;
  let timer = null;
  let pendingArgs = null;
  let pendingThis = null;

  function invoke(now, ctx, args) {
    last = now;
    fn.apply(ctx, args);
  }

  function throttled(...args) {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      invoke(now, this, args);
    } else {
      pendingArgs = args;
      pendingThis = this;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          invoke(Date.now(), pendingThis, pendingArgs);
          pendingArgs = null;
          pendingThis = null;
        }, remaining);
      }
    }
  }

  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
    pendingThis = null;
  };
  return throttled;
}

let idSeq = 0;

/** Id curto, unico dentro da sessao. */
export function nextId(prefix = 'id') {
  idSeq += 1;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now().toString(36)}${idSeq.toString(36)}${rand}`;
}

/** FNV-1a 32 bits em base36 — estavel entre sessoes e plataformas. */
export function hashString(str) {
  const input = String(str ?? '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // multiplicacao FNV por 16777619 sem estourar 32 bits
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(36);
}

/** Colapsa espacos e apara as pontas. */
export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Minusculo, sem acento — usado para comparar nomes e detectar ruido. */
export function normalizeForMatch(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Tempo relativo em pt-BR: "agora", "há 5 min", "há 3 h", "ontem", "12/03". */
export function relativeTime(ts, now = Date.now()) {
  const time = Number(ts);
  if (!Number.isFinite(time) || time <= 0) return '';
  const diff = now - time;
  if (diff < 0) {
    const ahead = Math.abs(diff);
    if (ahead < 60000) return 'em instantes';
    if (ahead < 3600000) return `em ${Math.round(ahead / 60000)} min`;
    if (ahead < 86400000) return `em ${Math.round(ahead / 3600000)} h`;
    const future = new Date(time);
    const dd = String(future.getDate()).padStart(2, '0');
    const mm = String(future.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
  }
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return `há ${Math.floor(diff / 60000)} min`;

  const dayDiff = Math.round((startOfDay(now) - startOfDay(time)) / 86400000);
  if (dayDiff === 0) return `há ${Math.max(1, Math.floor(diff / 3600000))} h`;
  if (dayDiff === 1) return 'ontem';

  const d = new Date(time);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

export function groupBy(list, keyFn) {
  const out = {};
  for (const item of list || []) {
    const key = typeof keyFn === 'function' ? keyFn(item) : item?.[keyFn];
    const k = String(key);
    if (!out[k]) out[k] = [];
    out[k].push(item);
  }
  return out;
}

export function escapeForRegExp(str) {
  return String(str ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Congela recursivamente (ignora ciclos). */
export function deepFreeze(obj, seen = new WeakSet()) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  if (seen.has(obj)) return obj;
  seen.add(obj);
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value && typeof value === 'object') deepFreeze(value, seen);
  }
  return obj;
}

/** Clone profundo tolerante (structuredClone quando existe). */
export function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* objetos nao clonaveis caem no JSON abaixo */
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return Array.isArray(value) ? [...value] : { ...value };
  }
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (!a || !b || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Espera `predicate()` virar truthy. Resolve com o valor ou `null` no timeout.
 * Nunca deixa timer orfao: sempre limpa antes de resolver.
 */
export function waitFor(predicate, { timeout = 4000, interval = 100 } = {}) {
  return new Promise((resolve) => {
    let timer = null;
    let deadlineTimer = null;
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      resolve(value);
    };

    const check = () => {
      let value = null;
      try {
        value = predicate();
      } catch {
        value = null;
      }
      if (value) finish(value);
    };

    check();
    if (settled) return;
    timer = setInterval(check, interval);
    deadlineTimer = setTimeout(() => finish(null), timeout);
  });
}

/** Reordena `list` movendo o item de `from` para `to` (sem mutar a original). */
export function moveInArray(list, from, to) {
  const arr = [...(list || [])];
  if (from < 0 || from >= arr.length) return arr;
  const target = clamp(to, 0, arr.length - 1);
  const [item] = arr.splice(from, 1);
  arr.splice(target, 0, item);
  return arr;
}

/** Iniciais do nome para o avatar de fallback. */
export function initialsOf(name = '') {
  const parts = normalizeText(name).split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] || '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** Extrai um JID de um valor de atributo, se houver. Devolve '' quando nao ha. */
export function extractJid(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (JID_RE.test(raw)) return raw;
  const match = raw.match(JID_ANY_RE);
  return match ? match[1] : '';
}

/** Id derivado do nome (ultimo recurso de identidade). */
export function nameIdFor(name) {
  return `name:${hashString(normalizeForMatch(name))}`;
}

/** Classifica um id ja existente: 'jid' | 'name' | 'dom'. */
export function idKindOf(id) {
  const raw = String(id ?? '');
  if (!raw) return 'name';
  if (JID_RE.test(raw)) return 'jid';
  if (raw.startsWith('name:')) return 'name';
  return 'dom';
}

/** Cor deterministica derivada do nome. */
export function colorFromString(str, palette) {
  const list = palette && palette.length ? palette : ['#00a884'];
  const hash = hashString(normalizeForMatch(str));
  let acc = 0;
  for (let i = 0; i < hash.length; i += 1) acc = (acc + hash.charCodeAt(i)) % 997;
  return list[acc % list.length];
}
