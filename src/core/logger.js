// Logger com niveis. Silencioso por padrao: so `error` e `warn` passam.

export const LEVELS = Object.freeze({ silent: 0, error: 1, warn: 2, info: 3, debug: 4 });

const PREFIX = '[KanZapp]';

function resolveLevel(value, fallback) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value in LEVELS) return LEVELS[value];
  return fallback;
}

/**
 * @param {string} ns escopo mostrado no console
 * @param {{level?: string|number, sink?: object}} [options]
 */
export function createLogger(ns = 'core', options = {}) {
  let level = resolveLevel(options.level, LEVELS.warn);
  const sink = options.sink || (typeof console !== 'undefined' ? console : null);
  const tag = `${PREFIX}[${ns}]`;

  function emit(method, min, args) {
    if (level < min || !sink) return;
    const fn = sink[method] || sink.log;
    if (typeof fn === 'function') {
      try {
        fn.call(sink, tag, ...args);
      } catch {
        /* console indisponivel (worker encerrando): ignora */
      }
    }
  }

  return {
    get level() {
      return level;
    },
    setLevel(next) {
      level = resolveLevel(next, level);
      return level;
    },
    error: (...args) => emit('error', LEVELS.error, args),
    warn: (...args) => emit('warn', LEVELS.warn, args),
    info: (...args) => emit('info', LEVELS.info, args),
    debug: (...args) => emit('debug', LEVELS.debug, args),
    child(sub, opts = {}) {
      return createLogger(`${ns}:${sub}`, { level: opts.level ?? level, sink });
    }
  };
}

/** Logger padrao da extensao. */
export const logger = createLogger('app');
