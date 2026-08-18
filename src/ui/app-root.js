/**
 * app-root.js — host da UI.
 *
 * Cria `<div id="kanzapp-root">` no `documentElement`, abre um Shadow DOM
 * (`mode: 'open'`) e carrega `styles.css` em `adoptedStyleSheets` (com
 * fallback `<style>`). Nada da UI vive fora deste shadow root, por isso o CSS
 * do WhatsApp não nos alcança e o nosso não vaza — sem `!important`.
 *
 * Todas as dependências do motor chegam por injeção; este módulo nunca importa
 * `core/` nem `wa/` (é o que permite a bancada visual rodar sem o motor).
 */
import { h } from './h.js';
import { createTheme } from './theme.js';
import { createToasts } from './toast.js';
import { createDialogs } from './dialog.js';
import { createLauncher } from './launcher.js';
import { createBoard } from './board.js';

const HOST_ID = 'kanzapp-root';
const CSS_PATH = 'src/ui/styles.css';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

/**
 * Qual camada o `Esc` deve desfazer (contrato §5.6: "fecha o topo da pilha").
 * Função pura para poder ser testada em Node — foi exatamente a ordem desta
 * pilha que estava errada: o quadro inteiro fechava mesmo com um card pego
 * pelo teclado, a busca preenchida ou um rename inline aberto.
 *
 * @returns {'none'|'dialog'|'board-layer'|'board'}
 */
export function resolveEscapeTarget({ open, hasDialog, boardHandled }) {
  if (hasDialog) return 'dialog';
  if (!open) return 'none';
  if (boardHandled) return 'board-layer';
  return 'board';
}

function resolveCssUrl() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      return chrome.runtime.getURL(CSS_PATH);
    }
  } catch {
    /* contexto invalidado: cai no fallback */
  }
  return null;
}

export function createAppRoot(deps) {
  const { store, adapter, composer, sweeper, logger, messenger, onOpenChange, onRefresh } = deps;
  const log = logger || { warn() {}, info() {}, debug() {} };

  let host = null;
  let shadow = null;
  let theme = null;
  let toasts = null;
  let dialogs = null;
  let launcher = null;
  let board = null;
  let overlay = null;
  let unsubscribe = null;
  let hostObserver = null;
  let reinjectScheduled = false;
  let open = false;
  let mounted = false;
  let previousFocus = null;

  async function loadStyles() {
    const url = resolveCssUrl();
    if (!url) {
      log.warn('[ui] URL do CSS indisponível (contexto da extensão inválido?)');
      return;
    }
    let cssText = '';
    try {
      const response = await fetch(url);
      cssText = await response.text();
    } catch (error) {
      log.warn('[ui] falha ao carregar styles.css', error);
      return;
    }
    try {
      if (typeof CSSStyleSheet !== 'undefined' && 'replace' in CSSStyleSheet.prototype && 'adoptedStyleSheets' in Document.prototype) {
        const sheet = new CSSStyleSheet();
        await sheet.replace(cssText);
        shadow.adoptedStyleSheets = [...(shadow.adoptedStyleSheets || []), sheet];
        return;
      }
    } catch (error) {
      log.warn('[ui] adoptedStyleSheets indisponível, usando <style>', error);
    }
    const style = document.createElement('style');
    style.textContent = cssText; // texto de CSS próprio, nunca dado de usuário
    shadow.appendChild(style);
  }

  function currentSettings() {
    try {
      return store.getState().settings || {};
    } catch {
      return {};
    }
  }

  function overdueCount(state) {
    const now = Date.now();
    let count = 0;
    for (const followup of Object.values(state.followups || {})) {
      if (followup && !followup.done && followup.timestamp && followup.timestamp <= now) count += 1;
    }
    return count;
  }

  function ensureBoard() {
    if (board) return board;
    board = createBoard({
      store,
      adapter,
      composer,
      sweeper,
      dialogs,
      messenger,
      logger: log,
      toast: (message, options) => toasts.toast(message, options),
      onClose: () => api.close(),
      onRefresh: () => onRefresh && onRefresh()
    });
    overlay.appendChild(board.el);
    return board;
  }

  function onStateChange(state) {
    const next = state || store.getState();
    theme.apply(next.settings || {});
    if (launcher) {
      launcher.setAlert(overdueCount(next));
      const saved = (next.settings || {}).launcherPos;
      if (saved && !launcher.positioned) {
        launcher.applyPosition(saved);
        launcher.positioned = true;
      }
    }
    if (open && board) board.update(next);
  }

  function isTypingTarget(node) {
    if (!node) return false;
    const tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
  }

  /** Só o atalho global de abrir/fechar; precisa vencer o WhatsApp, por isso captura. */
  function onKeyDownCapture(event) {
    if (event.ctrlKey && event.shiftKey && (event.key === 'K' || event.key === 'k')) {
      event.preventDefault();
      api.toggle();
    }
  }

  function onKeyDown(event) {
    if (!open) return;
    if (event.key === 'Escape') {
      // A pilha é consultada explicitamente: confiar só no `stopPropagation`
      // de quem está por baixo não basta (arraste por ponteiro, por exemplo,
      // não tem listener de teclado nenhum).
      const hasDialog = dialogs.hasOpen();
      // `handleEscape` tem efeito colateral: só pode ser chamado quando é a vez
      // do quadro, senão um Esc no diálogo cancelaria o arraste por baixo
      const boardHandled = !hasDialog
        && Boolean(board && board.handleEscape && board.handleEscape());
      const target = resolveEscapeTarget({ open, hasDialog, boardHandled });
      if (target === 'dialog') return; // o próprio diálogo trata e para a propagação
      event.preventDefault();
      if (target === 'board') api.close();
      return;
    }
    // Desfazer/refazer só dentro do quadro e fora de campo de texto — o
    // Ctrl+Z de quem está escrevendo uma nota é do campo, não nosso.
    if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z' || event.key === 'y' || event.key === 'Y')) {
      if (dialogs.hasOpen()) return;
      const active = shadow.activeElement || document.activeElement;
      if (isTypingTarget(active)) return;
      if (!board) return;
      event.preventDefault();
      const redo = event.shiftKey || event.key === 'y' || event.key === 'Y';
      if (redo) board.redo();
      else board.undo();
      return;
    }
    if (event.key === '/' && !dialogs.hasOpen()) {
      const active = shadow.activeElement || document.activeElement;
      if (isTypingTarget(active)) return;
      event.preventDefault();
      if (board) board.focusSearch();
    }
  }

  function focusablesIn(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => {
      if (el.hasAttribute('disabled') || el.hidden) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    });
  }

  /**
   * Armadilha de foco do overlay: com o quadro aberto, Tab não pode vazar para
   * o WhatsApp por baixo (o quadro é modal — clique fora fecha).
   */
  function onOverlayKeyDown(event) {
    if (event.key !== 'Tab') return;
    if (dialogs && dialogs.hasOpen()) return; // o diálogo tem a própria armadilha
    const items = focusablesIn(overlay);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const current = (shadow && shadow.activeElement) || document.activeElement;
    if (event.shiftKey && (current === first || !overlay.contains(current))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || !overlay.contains(current))) {
      event.preventDefault();
      first.focus();
    }
  }

  function scheduleReinject() {
    if (reinjectScheduled) return;
    reinjectScheduled = true;
    window.requestAnimationFrame(() => {
      reinjectScheduled = false;
      if (mounted && host && !host.isConnected) {
        try {
          document.documentElement.appendChild(host);
          log.info('[ui] host reinjetado após remoção pela página');
        } catch (error) {
          log.warn('[ui] falha ao reinjetar o host', error);
        }
      }
    });
  }

  const api = {
    get host() {
      return host;
    },
    get shadow() {
      return shadow;
    },
    get dialogs() {
      return dialogs;
    },
    toast: (message, options) => (toasts ? toasts.toast(message, options) : null),
    isOpen: () => open,
    /** Reavalia o indicador de saúde do adapter sem redesenhar os cards. */
    refreshHealth: () => {
      if (board && open) board.refreshHealth();
    },

    async mount() {
      if (mounted) return api;
      mounted = true;

      host = document.getElementById(HOST_ID);
      if (host && host.shadowRoot) host.remove();
      host = h('div', { id: HOST_ID });
      shadow = host.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(host);

      overlay = h('div', {
        class: 'kz-overlay',
        hidden: true,
        attrs: {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': 'Quadro KanZapp'
        },
        onPointerDown: (event) => {
          if (event.target === overlay) api.close();
        },
        onKeyDown: onOverlayKeyDown
      });
      shadow.appendChild(overlay);

      toasts = createToasts({ parent: shadow });
      dialogs = createDialogs({ parent: shadow });
      theme = createTheme({ host, adapter, logger: log });
      theme.apply(currentSettings());
      theme.start();

      launcher = createLauncher({
        parent: shadow,
        onToggle: () => api.toggle(),
        savePosition: (pos) => {
          Promise.resolve(store.actions.updateSettings({ launcherPos: pos }))
            .catch((error) => log.warn('[ui] não deu para salvar a posição do launcher', error));
        }
      });
      launcher.applyPosition(currentSettings().launcherPos);
      launcher.positioned = true;

      await loadStyles();

      if (typeof store.subscribe === 'function') {
        unsubscribe = store.subscribe((state) => {
          try {
            onStateChange(state);
          } catch (error) {
            log.warn('[ui] falha ao reagir a mudança de estado', error);
          }
        });
      }

      // FASE DE BOLHA: na captura, o listener rodava ANTES de qualquer
      // `stopPropagation()` de dentro do shadow root e engolia o Esc de todo
      // mundo. Aqui ele é o último a ver a tecla, como deve ser.
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('keydown', onKeyDownCapture, true);

      try {
        hostObserver = new MutationObserver(scheduleReinject);
        hostObserver.observe(document.documentElement, { childList: true });
      } catch (error) {
        log.warn('[ui] observer de reinjeção indisponível', error);
      }

      onStateChange(store.getState());
      return api;
    },

    open() {
      if (!mounted || open) return;
      ensureBoard();
      open = true;
      overlay.hidden = false;
      board.update(store.getState());
      launcher.setOpen(true);
      // com o quadro aberto o atalho nao tem funcao e cobre a ultima coluna
      launcher.setHidden(true);
      previousFocus = document.activeElement;
      // foco entra no quadro: sem isso o Tab começaria no WhatsApp de baixo
      const first = focusablesIn(overlay)[0];
      if (first) {
        try {
          first.focus();
        } catch {
          /* elemento pode recusar foco */
        }
      }
      if (onOpenChange) onOpenChange(true);
    },

    close() {
      if (!open) return;
      open = false;
      overlay.hidden = true;
      launcher.setOpen(false);
      launcher.setHidden(false);
      if (previousFocus && typeof previousFocus.focus === 'function' && previousFocus.isConnected) {
        try {
          previousFocus.focus();
        } catch {
          /* a página pode ter trocado o elemento */
        }
      }
      previousFocus = null;
      if (onOpenChange) onOpenChange(false);
    },

    toggle() {
      if (open) api.close();
      else api.open();
    },

    unmount() {
      if (!mounted) return;
      mounted = false;
      open = false;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', onKeyDownCapture, true);
      if (hostObserver) {
        hostObserver.disconnect();
        hostObserver = null;
      }
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {
          /* noop */
        }
        unsubscribe = null;
      }
      if (board) {
        board.destroy();
        board = null;
      }
      if (dialogs) {
        dialogs.destroy();
        dialogs = null;
      }
      if (toasts) {
        toasts.destroy();
        toasts = null;
      }
      if (launcher) {
        launcher.destroy();
        launcher = null;
      }
      if (theme) {
        theme.stop();
        theme = null;
      }
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = null;
      shadow = null;
      overlay = null;
    }
  };

  return api;
}
