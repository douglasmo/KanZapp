/**
 * views/tags.js — gestão de tags e seletor de tags do card.
 * Recebe tudo por injeção (`ctx`): nenhum singleton do motor é importado aqui.
 */
import { h, icon, clear } from '../h.js';
import { tagsEntry, sameIdSet } from '../undo.js';

const PRESET_COLORS = ['#00a884', '#0b6bcb', '#7c5cd6', '#c2410c', '#b3261e', '#0f766e', '#a4436e', '#6b7280'];

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function colorPicker(initial) {
  const input = h('input', {
    class: 'kz-input',
    type: 'color',
    value: initial,
    style: { width: '46px', padding: '2px' },
    attrs: { 'aria-label': 'Cor da tag' }
  });
  const row = h('div', { class: 'kz-row' }, input, ...PRESET_COLORS.map((color) => {
    const swatch = h('button', {
      class: 'kz-swatch',
      type: 'button',
      attrs: { 'aria-label': `Usar a cor ${color}`, title: color },
      onClick: () => {
        input.value = color;
      }
    });
    swatch.style.background = color;
    return swatch;
  }));
  return { row, input };
}

export function openTagsManager(ctx) {
  const { store, dialogs, toast, logger } = ctx;
  const listEl = h('ul', { class: 'kz-list' });

  function renderList() {
    const tags = store.getState().tags || [];
    clear(listEl);
    if (!tags.length) {
      listEl.appendChild(h('div', { class: 'kz-empty' },
        icon('tag', { size: 22 }),
        h('span', { class: 'kz-empty__title' }, 'Nenhuma tag criada'),
        h('span', { class: 'kz-empty__text' }, 'Tags ajudam a marcar prioridade, origem do lead ou estágio informal.')));
      return;
    }
    for (const tag of tags) {
      const swatch = h('span', { class: 'kz-swatch' });
      swatch.style.background = tag.color || '#6b7280';
      listEl.appendChild(h('li', { class: 'kz-list__item' },
        swatch,
        h('div', { class: 'kz-list__main' },
          h('div', { class: 'kz-list__title' }, tag.name),
          tag.description ? h('div', { class: 'kz-list__sub' }, tag.description) : null),
        h('button', {
          class: 'kz-iconbtn',
          type: 'button',
          attrs: { 'aria-label': `Editar a tag ${tag.name}`, title: 'Editar' },
          onClick: () => editTag(tag)
        }, icon('edit', { size: 15 })),
        h('button', {
          class: 'kz-iconbtn',
          type: 'button',
          attrs: { 'aria-label': `Excluir a tag ${tag.name}`, title: 'Excluir' },
          onClick: () => deleteTag(tag)
        }, icon('trash', { size: 15 }))));
    }
  }

  async function editTag(tag) {
    const picker = colorPicker(tag.color || PRESET_COLORS[0]);
    let nameInput = null;
    let descInput = null;
    const result = await dialogs.openDialog({
      title: 'Editar tag',
      body: (hh) => {
        nameInput = hh('input', { class: 'kz-input', value: tag.name, attrs: { 'data-autofocus': '' } });
        descInput = hh('input', { class: 'kz-input', value: tag.description || '', placeholder: 'Opcional' });
        return hh('div', { class: 'kz-section' },
          hh('div', { class: 'kz-field' }, hh('label', {}, 'Nome'), nameInput),
          hh('div', { class: 'kz-field' }, hh('label', {}, 'Descrição'), descInput),
          hh('div', { class: 'kz-field' }, hh('label', {}, 'Cor'), picker.row));
      },
      actions: [
        { id: 'cancel', label: 'Cancelar', variant: 'ghost', value: null },
        {
          id: 'save',
          label: 'Salvar',
          variant: 'primary',
          onClick: () => {
            const name = nameInput.value.trim();
            if (!name) {
              nameInput.focus();
              return false;
            }
            return { name, description: descInput.value.trim(), color: picker.input.value };
          }
        }
      ]
    });
    if (!result) return;
    try {
      await store.actions.updateTag(tag.id, result);
      renderList();
    } catch (error) {
      logger.warn('[tags] updateTag falhou', error);
      toast('Não foi possível salvar a tag.', { type: 'error' });
    }
  }

  async function deleteTag(tag) {
    const ok = await dialogs.confirmDialog(
      `Excluir a tag "${tag.name}"? Ela será removida de todos os cards.`,
      { title: 'Excluir tag', confirmLabel: 'Excluir', danger: true }
    );
    if (!ok) return;
    try {
      await store.actions.removeTag(tag.id);
      renderList();
    } catch (error) {
      logger.warn('[tags] removeTag falhou', error);
      toast('Não foi possível excluir a tag.', { type: 'error' });
    }
  }

  const picker = colorPicker(PRESET_COLORS[0]);
  const nameInput = h('input', { class: 'kz-input', placeholder: 'Ex.: Lead quente' });
  const descInput = h('input', { class: 'kz-input', placeholder: 'Descrição (opcional)' });

  async function createTag() {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    try {
      await store.actions.addTag({
        id: newId('tag'),
        name,
        color: picker.input.value,
        description: descInput.value.trim()
      });
      nameInput.value = '';
      descInput.value = '';
      renderList();
      toast('Tag criada.', { type: 'success' });
    } catch (error) {
      logger.warn('[tags] addTag falhou', error);
      toast('Não foi possível criar a tag.', { type: 'error' });
    }
  }

  renderList();

  return dialogs.openDialog({
    title: 'Tags',
    size: 'md',
    body: (hh) => hh('div', {},
      hh('div', { class: 'kz-section' },
        hh('div', { class: 'kz-section__title' }, 'Suas tags'),
        listEl),
      hh('div', { class: 'kz-section' },
        hh('div', { class: 'kz-section__title' }, 'Nova tag'),
        hh('div', { class: 'kz-field' }, hh('label', {}, 'Nome'), nameInput),
        hh('div', { class: 'kz-field' }, hh('label', {}, 'Descrição'), descInput),
        hh('div', { class: 'kz-field' }, hh('label', {}, 'Cor'), picker.row),
        hh('div', { class: 'kz-row' },
          hh('button', { class: 'kz-btn kz-btn--primary', type: 'button', onClick: createTag },
            icon('plus', { size: 15 }), 'Criar tag')))),
    actions: [{ id: 'close', label: 'Fechar', variant: 'ghost', value: null }]
  });
}

export function openTagPicker(ctx, contactId) {
  const { store, dialogs, toast, logger, history } = ctx;
  const state = store.getState();
  const contact = (state.contacts || {})[contactId];
  const card = (state.cards || {})[contactId] || {};
  const before = [...(card.tagIds || [])];
  const selected = new Set(card.tagIds || []);
  const listEl = h('div', { class: 'kz-list' });

  function renderOptions() {
    const tags = store.getState().tags || [];
    clear(listEl);
    if (!tags.length) {
      listEl.appendChild(h('div', { class: 'kz-empty' },
        icon('tag', { size: 22 }),
        h('span', { class: 'kz-empty__title' }, 'Nenhuma tag ainda'),
        h('span', { class: 'kz-empty__text' }, 'Crie tags no botão “Tags” do cabeçalho.')));
      return;
    }
    for (const tag of tags) {
      const checkbox = h('input', {
        type: 'checkbox',
        checked: selected.has(tag.id),
        attrs: { 'aria-label': `Aplicar a tag ${tag.name}` },
        onChange: () => {
          if (checkbox.checked) selected.add(tag.id);
          else selected.delete(tag.id);
        }
      });
      const swatch = h('span', { class: 'kz-swatch' });
      swatch.style.background = tag.color || '#6b7280';
      listEl.appendChild(h('label', { class: 'kz-option' },
        checkbox,
        swatch,
        h('span', { class: 'kz-list__main' },
          h('span', { class: 'kz-list__title' }, tag.name),
          tag.description ? h('span', { class: 'kz-list__sub' }, tag.description) : null)));
    }
  }

  renderOptions();

  return dialogs.openDialog({
    title: contact ? `Tags de ${contact.name}` : 'Tags do contato',
    body: () => listEl,
    actions: [
      {
        id: 'manage',
        label: 'Gerenciar tags',
        variant: 'ghost',
        onClick: () => {
          openTagsManager(ctx);
          return null;
        }
      },
      { id: 'cancel', label: 'Cancelar', variant: 'ghost', value: null },
      {
        id: 'save',
        label: 'Salvar',
        variant: 'primary',
        onClick: async () => {
          const after = Array.from(selected);
          try {
            await store.actions.setCardTags(contactId, after);
            // entra na pilha de desfazer só se mudou de fato
            if (history && !sameIdSet(before, after)) {
              history.push(tagsEntry(
                [{ contactId, before, after }],
                `Tags de ${contact ? contact.name : 'contato'}`
              ));
            }
          } catch (error) {
            logger.warn('[tags] setCardTags falhou', error);
            toast('Não foi possível salvar as tags.', { type: 'error' });
          }
          return true;
        }
      }
    ]
  });
}
