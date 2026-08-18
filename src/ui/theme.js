/**
 * theme.js — resolve o tema efetivo da UI.
 *
 * Preferência do usuário: 'auto' | 'light' | 'dark' (settings.theme).
 * Em 'auto' seguimos o WhatsApp através de `adapter.getTheme()`; se o adapter
 * não estiver disponível (bancada de testes, falha de probe), caímos para
 * `prefers-color-scheme`. O tema é escrito como atributo no host do shadow
 * root — todo o CSS deriva dele.
 */

const THEMES = new Set(['light', 'dark']);
const DENSITIES = new Set(['comfortable', 'compact']);

export function createTheme({ host, adapter, logger } = {}) {
  let preference = 'auto';
  let density = 'comfortable';
  let resolved = null;
  let observer = null;
  let mq = null;
  let pending = 0;
  const listeners = new Set();

  const log = logger || { warn() {}, debug() {} };

  function fromMedia() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  function fromAdapter() {
    if (!adapter || typeof adapter.getTheme !== 'function') return null;
    try {
      const value = adapter.getTheme();
      return THEMES.has(value) ? value : null;
    } catch (error) {
      log.warn('[theme] adapter.getTheme falhou', error);
      return null;
    }
  }

  function resolve() {
    if (THEMES.has(preference)) return preference;
    return fromAdapter() || fromMedia();
  }

  function paint() {
    const next = resolve();
    const changed = next !== resolved;
    resolved = next;
    if (host) {
      if (host.getAttribute('data-theme') !== next) host.setAttribute('data-theme', next);
      if (host.getAttribute('data-density') !== density) host.setAttribute('data-density', density);
    }
    if (changed) {
      for (const fn of listeners) {
        try {
          fn(next);
        } catch (error) {
          log.warn('[theme] listener falhou', error);
        }
      }
    }
    return next;
  }

  function schedulePaint() {
    if (pending) return;
    pending = window.setTimeout(() => {
      pending = 0;
      paint();
    }, 250);
  }

  return {
    /** Aplica as preferências vindas de settings. */
    apply(settings = {}) {
      if (settings.theme && (THEMES.has(settings.theme) || settings.theme === 'auto')) {
        preference = settings.theme;
      }
      if (settings.density && DENSITIES.has(settings.density)) density = settings.density;
      return paint();
    },
    current() {
      return resolved || resolve();
    },
    preference() {
      return preference;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Passa a observar mudanças de tema do WhatsApp (só enquanto montado). */
    start() {
      if (observer) return;
      paint();
      try {
        // O WhatsApp troca de tema mexendo em class/style do <html>/<body>.
        observer = new MutationObserver(() => {
          if (preference === 'auto') schedulePaint();
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
        if (document.body) {
          observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
        }
      } catch (error) {
        log.warn('[theme] observer indisponível', error);
      }
      try {
        mq = window.matchMedia('(prefers-color-scheme: dark)');
        mq.addEventListener('change', schedulePaint);
      } catch {
        mq = null;
      }
    },
    stop() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (mq) {
        try {
          mq.removeEventListener('change', schedulePaint);
        } catch {
          /* noop */
        }
        mq = null;
      }
      if (pending) {
        window.clearTimeout(pending);
        pending = 0;
      }
      listeners.clear();
    }
  };
}
