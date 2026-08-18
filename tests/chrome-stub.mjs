// Stub minimo da API `chrome` para rodar o storage-driver e o store em Node
// (e tambem no harness do navegador, que importa este mesmo arquivo).

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function createEventSource() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    hasListener: (fn) => listeners.has(fn),
    dispatch(...args) {
      for (const fn of [...listeners]) fn(...args);
    },
    get size() {
      return listeners.size;
    }
  };
}

/**
 * @param {{initial?: object, latency?: number, runtimeId?: string|null}} [options]
 */
export function createChromeStub(options = {}) {
  const { initial = {}, latency = 0, runtimeId = 'kanzapp-test' } = options;
  let data = clone(initial);
  let alive = runtimeId !== null;

  const onChanged = createEventSource();
  const onMessage = createEventSource();
  const onAlarm = createEventSource();
  const stats = { get: 0, set: 0, remove: 0 };
  const alarms = new Map();
  const notifications = [];
  const sentMessages = [];
  const actionState = { badgeText: '', badgeColor: null };
  let nextTabId = 1;

  const defer = (fn) => {
    if (latency > 0) setTimeout(fn, latency);
    else queueMicrotask(fn);
  };

  const local = {
    get(keys, cb) {
      stats.get += 1;
      defer(() => {
        const out = {};
        const list = keys === null || keys === undefined ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
        for (const key of list) {
          if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = clone(data[key]);
        }
        cb?.(out);
      });
    },
    set(items, cb) {
      stats.set += 1;
      defer(() => {
        const changes = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: clone(data[key]), newValue: clone(value) };
          data[key] = clone(value);
        }
        cb?.();
        onChanged.dispatch(changes, 'local');
      });
    },
    remove(keys, cb) {
      stats.remove += 1;
      defer(() => {
        const list = Array.isArray(keys) ? keys : [keys];
        const changes = {};
        for (const key of list) {
          if (Object.prototype.hasOwnProperty.call(data, key)) {
            changes[key] = { oldValue: clone(data[key]), newValue: undefined };
            delete data[key];
          }
        }
        cb?.();
        onChanged.dispatch(changes, 'local');
      });
    }
  };

  const chrome = {
    runtime: {
      get id() {
        return alive ? runtimeId : undefined;
      },
      lastError: undefined,
      getURL: (path) => `chrome-extension://kanzapp-test/${path}`,
      onMessage,
      onStartup: createEventSource(),
      onInstalled: createEventSource(),
      sendMessage: (message, cb) => {
        sentMessages.push(message);
        defer(() => cb?.({ ok: true }));
      }
    },
    storage: { local, sync: local, onChanged },
    alarms: {
      create: (name, info) => {
        alarms.set(name, info);
        return Promise.resolve();
      },
      clear: (name) => {
        const had = alarms.delete(name);
        return Promise.resolve(had);
      },
      getAll: () => Promise.resolve([...alarms.entries()].map(([name, info]) => ({ name, ...info }))),
      onAlarm
    },
    notifications: {
      create: (id, opts) => {
        notifications.push({ id, opts });
        return Promise.resolve(id);
      },
      clear: () => Promise.resolve(true),
      onClicked: createEventSource(),
      onButtonClicked: createEventSource()
    },
    tabs: {
      query: (q, cb) => defer(() => cb?.([])),
      sendMessage: (tabId, message, cb) => {
        sentMessages.push({ tabId, message });
        defer(() => cb?.({ ok: true }));
      },
      update: () => Promise.resolve({}),
      create: ({ url = '' } = {}) => Promise.resolve({
        id: nextTabId++,
        windowId: 1,
        url,
        active: true,
        status: 'loading'
      })
    },
    windows: { update: () => Promise.resolve({}) },
    action: {
      setBadgeText: ({ text = '' } = {}) => {
        actionState.badgeText = text;
        return Promise.resolve();
      },
      setBadgeBackgroundColor: ({ color = null } = {}) => {
        actionState.badgeColor = color;
        return Promise.resolve();
      },
      onClicked: createEventSource()
    },
    commands: { onCommand: createEventSource() }
  };

  return {
    chrome,
    stats,
    alarms,
    notifications,
    sentMessages,
    actionState,
    /** Simula escrita vinda de outra aba. */
    emitExternalChange(key, newValue) {
      const oldValue = clone(data[key]);
      data[key] = clone(newValue);
      onChanged.dispatch({ [key]: { oldValue, newValue: clone(newValue) } }, 'local');
    },
    /** Simula "Extension context invalidated". */
    kill() {
      alive = false;
    },
    revive() {
      alive = true;
    },
    snapshot() {
      return clone(data);
    },
    reset(next = {}) {
      data = clone(next);
    }
  };
}

/** Instala o stub em globalThis e devolve o handle + funcao de remocao. */
export function installChromeStub(options = {}) {
  const stub = createChromeStub(options);
  const previous = globalThis.chrome;
  globalThis.chrome = stub.chrome;
  stub.uninstall = () => {
    globalThis.chrome = previous;
  };
  return stub;
}
