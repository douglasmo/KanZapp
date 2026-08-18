/**
 * dialog.js — diálogos próprios (o projeto não usa os nativos bloqueantes).
 *
 * `confirmDialog` / `promptDialog` / `alertDialog` são os substitutos diretos.
 * Os nomes são propositalmente diferentes dos globais para que a checklist
 * (seção 7.3 do contrato) possa procurar `confirm(` / `prompt(` / `alert(`
 * sem falso positivo.
 */
import { h, icon, clear } from './h.js';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function createDialogs({ parent }) {
  const stack = [];

  function focusablesOf(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => {
      if (el.hasAttribute('disabled')) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    });
  }

  function activeElementInRoot() {
    const rootNode = parent.getRootNode ? parent.getRootNode() : document;
    return (rootNode && rootNode.activeElement) || document.activeElement;
  }

  function openDialog(options = {}) {
    const {
      title = '',
      body = null,
      actions = [],
      size = 'sm',
      dismissable = true,
      onClose = null
    } = options;

    const previousFocus = activeElementInRoot();
    let settle = null;
    let closed = false;

    const titleId = `kz-dlg-title-${Math.random().toString(36).slice(2, 8)}`;
    const bodyEl = h('div', { class: 'kz-dialog__body' });
    const footEl = h('div', { class: 'kz-dialog__foot' });

    const dialogEl = h('div', {
      class: `kz-dialog kz-dialog--${size}`,
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }
    },
    h('div', { class: 'kz-dialog__head' },
      h('h2', { class: 'kz-dialog__title', id: titleId }, title),
      dismissable
        ? h('button', {
          class: 'kz-iconbtn',
          type: 'button',
          attrs: { 'aria-label': 'Fechar' },
          onClick: () => close(null)
        }, icon('close', { size: 16 }))
        : null
    ),
    bodyEl,
    footEl);

    const layer = h('div', {
      class: 'kz-dialog-layer',
      onPointerDown: (event) => {
        if (!dismissable) return;
        if (event.target === layer) close(null);
      },
      onKeyDown: (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (dismissable) {
            event.preventDefault();
            close(null);
          }
          return;
        }
        if (event.key !== 'Tab') return;
        const items = focusablesOf(dialogEl);
        if (!items.length) {
          event.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const current = activeElementInRoot();
        if (event.shiftKey && (current === first || !dialogEl.contains(current))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (current === last || !dialogEl.contains(current))) {
          event.preventDefault();
          first.focus();
        }
      }
    }, dialogEl);

    const api = {
      dialog: dialogEl,
      body: bodyEl,
      close: (value) => close(value),
      /** Redesenha o rodapé (útil quando as ações dependem do estado). */
      setActions: (next) => renderActions(next)
    };

    function renderActions(list) {
      clear(footEl);
      for (const action of list || []) {
        if (!action) continue;
        const variant = action.variant === 'primary'
          ? 'kz-btn kz-btn--primary'
          : action.variant === 'danger'
            ? 'kz-btn kz-btn--danger'
            : action.variant === 'ghost'
              ? 'kz-btn kz-btn--ghost'
              : 'kz-btn';
        footEl.appendChild(h('button', {
          class: variant,
          type: 'button',
          dataset: { action: action.id || '' },
          onClick: async () => {
            if (typeof action.onClick === 'function') {
              const result = await action.onClick(api);
              if (result === false || action.keepOpen) return;
              close(result === undefined ? (action.value !== undefined ? action.value : action.id) : result);
              return;
            }
            close(action.value !== undefined ? action.value : action.id);
          }
        }, action.label || ''));
      }
      footEl.hidden = footEl.children.length === 0;
    }

    // corpo
    const content = typeof body === 'function' ? body(h, api) : body;
    if (content != null) {
      if (content instanceof Node) bodyEl.appendChild(content);
      else if (Array.isArray(content)) content.forEach((node) => node && bodyEl.appendChild(node));
      else bodyEl.appendChild(document.createTextNode(String(content)));
    }
    renderActions(actions);

    function close(value) {
      if (closed) return;
      closed = true;
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      try {
        if (typeof onClose === 'function') onClose(value);
      } catch {
        /* onClose não pode derrubar o fechamento */
      }
      if (previousFocus && typeof previousFocus.focus === 'function' && previousFocus.isConnected) {
        previousFocus.focus();
      }
      if (settle) settle(value === undefined ? null : value);
    }

    const entry = { layer, dialogEl, close };
    stack.push(entry);
    parent.appendChild(layer);

    // foco inicial
    const preferred = dialogEl.querySelector('[data-autofocus]');
    const first = preferred || focusablesOf(bodyEl)[0] || focusablesOf(footEl)[0] || dialogEl;
    if (first === dialogEl) dialogEl.tabIndex = -1;
    first.focus();

    const promise = new Promise((resolve) => {
      settle = resolve;
    });
    promise.close = close;
    promise.dialog = dialogEl;
    promise.body = bodyEl;
    return promise;
  }

  function alertDialog(message, { title = 'Aviso' } = {}) {
    return openDialog({
      title,
      body: () => h('p', { class: 'kz-dialog__text' }, message),
      actions: [{ id: 'ok', label: 'Entendi', variant: 'primary', value: true }]
    });
  }

  function confirmDialog(message, options = {}) {
    const {
      title = 'Confirmar',
      confirmLabel = 'Confirmar',
      cancelLabel = 'Cancelar',
      danger = false
    } = options;
    return openDialog({
      title,
      body: () => h('p', { class: 'kz-dialog__text' }, message),
      actions: [
        { id: 'cancel', label: cancelLabel, variant: 'ghost', value: false },
        { id: 'ok', label: confirmLabel, variant: danger ? 'danger' : 'primary', value: true }
      ]
    }).then((value) => value === true);
  }

  function promptDialog(label, initialValue = '', options = {}) {
    const {
      title = 'Editar',
      placeholder = '',
      multiline = false,
      confirmLabel = 'Salvar',
      required = true
    } = options;
    let input = null;
    return openDialog({
      title,
      body: (hh, api) => {
        input = multiline
          ? hh('textarea', { class: 'kz-textarea', placeholder, value: initialValue, attrs: { 'data-autofocus': '' } })
          : hh('input', {
            class: 'kz-input',
            type: 'text',
            placeholder,
            value: initialValue,
            attrs: { 'data-autofocus': '' },
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                const value = input.value.trim();
                if (!required || value) api.close(value);
              }
            }
          });
        return hh('div', { class: 'kz-field' }, hh('label', {}, label), input);
      },
      actions: [
        { id: 'cancel', label: 'Cancelar', variant: 'ghost', value: null },
        {
          id: 'ok',
          label: confirmLabel,
          variant: 'primary',
          onClick: () => {
            const value = input ? input.value.trim() : '';
            if (required && !value) {
              input.focus();
              return false;
            }
            return value;
          }
        }
      ]
    });
  }

  return {
    openDialog,
    confirmDialog,
    promptDialog,
    alertDialog,
    hasOpen: () => stack.length > 0,
    /** Fecha o diálogo do topo da pilha; devolve true se havia algum. */
    closeTop() {
      const top = stack[stack.length - 1];
      if (!top) return false;
      top.close(null);
      return true;
    },
    destroy() {
      while (stack.length) stack[stack.length - 1].close(null);
    }
  };
}
