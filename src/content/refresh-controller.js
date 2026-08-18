// Agenda a sincronizacao periodica enquanto o board esta aberto. Usa timeout
// recursivo para que mudancas de preferencias possam rearmar o proximo ciclo
// imediatamente, sem deixar um setInterval antigo vivo.

const DEFAULT_REFRESH_MS = 4000;
const MIN_REFRESH_MS = 1500;

function normalized(settings = {}) {
  return {
    enabled: settings.autoRefresh !== false,
    interval: Math.max(MIN_REFRESH_MS, Number(settings.refreshMs) || DEFAULT_REFRESH_MS)
  };
}

export function createRefreshController({
  onRefresh,
  onError,
  setTimer = (fn, ms) => window.setTimeout(fn, ms),
  clearTimer = (id) => window.clearTimeout(id)
} = {}) {
  let config = normalized();
  let timer = 0;
  let active = false;
  let destroyed = false;

  function disarm() {
    if (!timer) return;
    clearTimer(timer);
    timer = 0;
  }

  function arm() {
    disarm();
    if (destroyed || !active || !config.enabled || typeof onRefresh !== 'function') return;
    timer = setTimer(async () => {
      timer = 0;
      if (destroyed || !active || !config.enabled) return;
      try {
        await onRefresh();
      } catch (error) {
        if (typeof onError === 'function') onError(error);
      } finally {
        arm();
      }
    }, config.interval);
  }

  return {
    configure(settings) {
      const next = normalized(settings);
      const changed = next.enabled !== config.enabled || next.interval !== config.interval;
      config = next;
      if (changed && active) arm();
      return { ...config };
    },
    start() {
      if (destroyed) return;
      active = true;
      arm();
    },
    stop() {
      active = false;
      disarm();
    },
    destroy() {
      destroyed = true;
      active = false;
      disarm();
    },
    status() {
      return { ...config, active, scheduled: Boolean(timer), destroyed };
    }
  };
}

