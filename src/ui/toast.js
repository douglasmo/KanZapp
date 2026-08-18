/**
 * toast.js — avisos não bloqueantes empilháveis.
 * Substitui `alert()` no caminho de notificação (o de confirmação está em dialog.js).
 */
import { h, icon } from './h.js';

const MAX_STACK = 4;
const DEFAULT_DURATION = 4500;

export function createToasts({ parent }) {
  const layer = h('div', {
    class: 'kz-toasts',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' }
  });
  parent.appendChild(layer);

  const timers = new Set();

  function dismiss(node, timer) {
    if (timer) {
      window.clearTimeout(timer);
      timers.delete(timer);
    }
    if (node.parentNode) node.parentNode.removeChild(node);
  }

  function toast(message, options = {}) {
    const { type = 'info', action = null, duration = DEFAULT_DURATION } = options;

    while (layer.children.length >= MAX_STACK) {
      layer.removeChild(layer.firstChild);
    }

    let timer = 0;
    const node = h('div', { class: 'kz-toast', dataset: { type } },
      h('span', { class: 'kz-toast__msg' }, message),
      action && typeof action.onClick === 'function'
        ? h('button', {
          class: 'kz-btn kz-btn--sm',
          type: 'button',
          onClick: () => {
            dismiss(node, timer);
            action.onClick();
          }
        }, action.label || 'Abrir')
        : null,
      h('button', {
        class: 'kz-iconbtn',
        type: 'button',
        attrs: { 'aria-label': 'Fechar aviso' },
        onClick: () => dismiss(node, timer)
      }, icon('close', { size: 14 }))
    );

    layer.appendChild(node);

    if (duration > 0) {
      timer = window.setTimeout(() => dismiss(node, timer), duration);
      timers.add(timer);
    }

    return { dismiss: () => dismiss(node, timer), node };
  }

  return {
    toast,
    layer,
    destroy() {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      if (layer.parentNode) layer.parentNode.removeChild(layer);
    }
  };
}
