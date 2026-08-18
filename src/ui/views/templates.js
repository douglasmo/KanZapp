/**
 * views/templates.js — modelos de mensagem (as "mensagens prontas" do v1).
 * O envio real é delegado ao `composer` injetado; a UI só mostra o resultado.
 */
import { h, icon, clear } from '../h.js';

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function openTemplatesManager(ctx) {
  const { store, dialogs, toast, logger } = ctx;
  const listEl = h('ul', { class: 'kz-list' });

  const titleInput = h('input', { class: 'kz-input', placeholder: 'Ex.: Saudação inicial' });
  const shortcutInput = h('input', { class: 'kz-input', placeholder: 'Atalho opcional, ex.: /oi' });
  const textInput = h('textarea', { class: 'kz-textarea', placeholder: 'Texto da mensagem…' });

  function renderList() {
    const templates = store.getState().templates || [];
    clear(listEl);
    if (!templates.length) {
      listEl.appendChild(h('div', { class: 'kz-empty' },
        icon('message', { size: 22 }),
        h('span', { class: 'kz-empty__title' }, 'Nenhum modelo salvo'),
        h('span', { class: 'kz-empty__text' }, 'Crie respostas prontas para as etapas do funil e economize digitação.')));
      return;
    }
    for (const template of templates) {
      listEl.appendChild(h('li', { class: 'kz-list__item' },
        h('div', { class: 'kz-list__main' },
          h('div', { class: 'kz-list__title' },
            template.title,
            template.shortcut ? h('span', { class: 'kz-hint' }, ` ${template.shortcut}`) : null),
          h('div', { class: 'kz-list__sub' }, template.text)),
        h('button', {
          class: 'kz-iconbtn',
          type: 'button',
          attrs: { 'aria-label': `Editar o modelo ${template.title}`, title: 'Editar' },
          onClick: () => editTemplate(template)
        }, icon('edit', { size: 15 })),
        h('button', {
          class: 'kz-iconbtn',
          type: 'button',
          attrs: { 'aria-label': `Excluir o modelo ${template.title}`, title: 'Excluir' },
          onClick: () => deleteTemplate(template)
        }, icon('trash', { size: 15 }))));
    }
  }

  async function editTemplate(template) {
    let title = null;
    let text = null;
    let shortcut = null;
    const result = await dialogs.openDialog({
      title: 'Editar modelo',
      size: 'md',
      body: (hh) => {
        title = hh('input', { class: 'kz-input', value: template.title, attrs: { 'data-autofocus': '' } });
        shortcut = hh('input', { class: 'kz-input', value: template.shortcut || '' });
        text = hh('textarea', { class: 'kz-textarea', value: template.text || '' });
        return hh('div', { class: 'kz-section' },
          hh('div', { class: 'kz-field' }, hh('label', {}, 'Título'), title),
          hh('div', { class: 'kz-field' }, hh('label', {}, 'Atalho'), shortcut),
          hh('div', { class: 'kz-field' }, hh('label', {}, 'Texto'), text));
      },
      actions: [
        { id: 'cancel', label: 'Cancelar', variant: 'ghost', value: null },
        {
          id: 'save',
          label: 'Salvar',
          variant: 'primary',
          onClick: () => {
            if (!title.value.trim() || !text.value.trim()) {
              title.focus();
              return false;
            }
            return { title: title.value.trim(), text: text.value, shortcut: shortcut.value.trim() };
          }
        }
      ]
    });
    if (!result) return;
    try {
      await store.actions.updateTemplate(template.id, result);
      renderList();
    } catch (error) {
      logger.warn('[templates] updateTemplate falhou', error);
      toast('Não foi possível salvar o modelo.', { type: 'error' });
    }
  }

  async function deleteTemplate(template) {
    const ok = await dialogs.confirmDialog(`Excluir o modelo "${template.title}"?`, {
      title: 'Excluir modelo',
      confirmLabel: 'Excluir',
      danger: true
    });
    if (!ok) return;
    try {
      await store.actions.removeTemplate(template.id);
      renderList();
    } catch (error) {
      logger.warn('[templates] removeTemplate falhou', error);
      toast('Não foi possível excluir o modelo.', { type: 'error' });
    }
  }

  async function createTemplate() {
    const title = titleInput.value.trim();
    const text = textInput.value;
    if (!title || !text.trim()) {
      titleInput.focus();
      return;
    }
    try {
      await store.actions.addTemplate({
        id: newId('tpl'),
        title,
        text,
        shortcut: shortcutInput.value.trim()
      });
      titleInput.value = '';
      textInput.value = '';
      shortcutInput.value = '';
      renderList();
      toast('Modelo salvo.', { type: 'success' });
    } catch (error) {
      logger.warn('[templates] addTemplate falhou', error);
      toast('Não foi possível salvar o modelo.', { type: 'error' });
    }
  }

  renderList();

  return dialogs.openDialog({
    title: 'Modelos de mensagem',
    size: 'md',
    body: (hh) => hh('div', {},
      hh('div', { class: 'kz-section' }, hh('div', { class: 'kz-section__title' }, 'Seus modelos'), listEl),
      hh('div', { class: 'kz-section' },
        hh('div', { class: 'kz-section__title' }, 'Novo modelo'),
        hh('div', { class: 'kz-field' }, hh('label', {}, 'Título'), titleInput),
        hh('div', { class: 'kz-field' }, hh('label', {}, 'Atalho'), shortcutInput),
        hh('div', { class: 'kz-field' }, hh('label', {}, 'Texto'), textInput),
        hh('div', { class: 'kz-row' },
          hh('button', { class: 'kz-btn kz-btn--primary', type: 'button', onClick: createTemplate },
            icon('plus', { size: 15 }), 'Salvar modelo')))),
    actions: [{ id: 'close', label: 'Fechar', variant: 'ghost', value: null }]
  });
}

export function openTemplatePicker(ctx, contactId) {
  const { store, composer, dialogs, toast, logger } = ctx;
  const state = store.getState();
  const contact = (state.contacts || {})[contactId];
  const templates = state.templates || [];
  const listEl = h('div', { class: 'kz-list' });

  async function run(mode, template) {
    if (!composer) {
      toast('Envio indisponível nesta tela.', { type: 'warn' });
      return;
    }
    try {
      if (mode === 'send') {
        const ok = await composer.sendMessage(contact, template.text);
        toast(ok ? `Mensagem enviada para ${contact.name}.` : 'Não foi possível enviar a mensagem.', {
          type: ok ? 'success' : 'error'
        });
      } else {
        const opened = await composer.openChat(contact);
        if (opened && opened.ok === false) {
          toast('Não foi possível abrir a conversa.', { type: 'error' });
          return;
        }
        const ok = await composer.insertDraft(template.text);
        toast(ok ? 'Texto inserido no campo de mensagem.' : 'Não foi possível inserir o texto.', {
          type: ok ? 'success' : 'error'
        });
      }
    } catch (error) {
      logger.warn('[templates] envio falhou', error);
      toast('Falha ao falar com o WhatsApp.', { type: 'error' });
    }
  }

  if (!templates.length) {
    listEl.appendChild(h('div', { class: 'kz-empty' },
      icon('message', { size: 22 }),
      h('span', { class: 'kz-empty__title' }, 'Nenhum modelo salvo'),
      h('span', { class: 'kz-empty__text' }, 'Crie modelos em “Modelos” no cabeçalho do quadro.')));
  } else {
    for (const template of templates) {
      listEl.appendChild(h('div', { class: 'kz-list__item' },
        h('div', { class: 'kz-list__main' },
          h('div', { class: 'kz-list__title' }, template.title),
          h('div', { class: 'kz-list__sub' }, template.text)),
        h('button', {
          class: 'kz-btn kz-btn--sm',
          type: 'button',
          onClick: () => {
            dialog.close(null);
            run('draft', template);
          }
        }, 'Inserir'),
        h('button', {
          class: 'kz-btn kz-btn--sm kz-btn--primary',
          type: 'button',
          onClick: () => {
            dialog.close(null);
            run('send', template);
          }
        }, 'Enviar')));
    }
  }

  const dialog = dialogs.openDialog({
    title: contact ? `Mensagem para ${contact.name}` : 'Enviar mensagem',
    size: 'md',
    body: () => listEl,
    actions: [
      {
        id: 'manage',
        label: 'Gerenciar modelos',
        variant: 'ghost',
        onClick: () => {
          openTemplatesManager(ctx);
          return null;
        }
      },
      { id: 'close', label: 'Fechar', variant: 'ghost', value: null }
    ]
  });
  return dialog;
}
