// Emitter minimo: um listener quebrado nunca derruba os outros.

export function createEmitter({ onError } = {}) {
  /** @type {Map<string, Set<Function>>} */
  const map = new Map();

  function on(evt, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!map.has(evt)) map.set(evt, new Set());
    map.get(evt).add(fn);
    return () => off(evt, fn);
  }

  function off(evt, fn) {
    const set = map.get(evt);
    if (!set) return;
    if (fn) set.delete(fn);
    else set.clear();
    if (set.size === 0) map.delete(evt);
  }

  function emit(evt, payload) {
    const set = map.get(evt);
    if (!set || set.size === 0) return 0;
    let delivered = 0;
    // copia: um listener pode se desinscrever durante o emit
    for (const fn of [...set]) {
      try {
        fn(payload);
        delivered += 1;
      } catch (error) {
        if (typeof onError === 'function') {
          try {
            onError(error, evt);
          } catch {
            /* ignora erro do proprio handler de erro */
          }
        }
      }
    }
    return delivered;
  }

  function clear() {
    map.clear();
  }

  function count(evt) {
    return evt ? (map.get(evt)?.size || 0) : [...map.values()].reduce((a, s) => a + s.size, 0);
  }

  return { on, off, emit, clear, count };
}
