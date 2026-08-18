/**
 * views/notes.js — nota interna do contato (só sua, nunca enviada ao cliente).
 */
import { h } from '../h.js';

export function openNoteEditor(ctx, contactId) {
  const { store, dialogs, toast, logger } = ctx;
  const state = store.getState();
  const contact = (state.contacts || {})[contactId] || { name: 'Contato' };
  const card = (state.cards || {})[contactId] || {};

  let textarea = null;

  async function save(value) {
    try {
      await store.actions.setNote(contactId, value);
      return true;
    } catch (error) {
      logger.warn('[notes] setNote falhou', error);
      toast('Não foi possível salvar a nota.', { type: 'error' });
      return false;
    }
  }

  return dialogs.openDialog({
    title: `Nota interna · ${contact.name}`,
    size: 'md',
    body: (hh, api) => {
      textarea = hh('textarea', {
        class: 'kz-textarea',
        value: card.note || '',
        placeholder: 'Histórico da negociação, combinados, objeções…',
        attrs: { 'data-autofocus': '', rows: '10' },
        onKeyDown: async (event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (await save(textarea.value)) {
              toast('Nota salva.', { type: 'success' });
              api.close(true);
            }
          }
        }
      });
      return hh('div', { class: 'kz-field' },
        hh('label', {}, 'Anotações'),
        textarea,
        hh('span', { class: 'kz-hint' }, 'Ctrl+Enter salva e fecha. A nota fica só no seu navegador.'));
    },
    actions: [
      { id: 'cancel', label: 'Cancelar', variant: 'ghost', value: null },
      {
        id: 'save',
        label: 'Salvar nota',
        variant: 'primary',
        onClick: async () => {
          const ok = await save(textarea.value);
          if (ok) toast('Nota salva.', { type: 'success' });
          return ok ? true : false;
        }
      }
    ]
  });
}
