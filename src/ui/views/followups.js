/**
 * views/followups.js — agendamento e lista de follow-ups.
 * O alarme em si vive no service worker; aqui só pedimos via `ctx.messenger`.
 */
import { h, icon, clear } from '../h.js';
import { relativeTime } from '../card.js';

const HOUR = 3600000;

function toLocalInputValue(ts) {
  const date = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value) {
  if (!value) return NaN;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : NaN;
}

function tomorrowAt(hour) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

async function persist(ctx, contactId, data) {
  const { store, messenger, logger, toast } = ctx;
  try {
    await store.actions.setFollowup(contactId, data);
  } catch (error) {
    logger.warn('[followups] setFollowup falhou', error);
    toast('Não foi possível salvar o lembrete.', { type: 'error' });
    return false;
  }
  const messengerMethod = data?.done === true ? 'cancelFollowup' : 'scheduleFollowup';
  if (messenger && typeof messenger[messengerMethod] === 'function') {
    try {
      const response = data?.done === true
        ? await messenger.cancelFollowup(contactId)
        : await messenger.scheduleFollowup(data);
      if (!response || response.ok !== true) {
        throw new Error(response?.reason || 'service worker não confirmou a operação');
      }
    } catch (error) {
      logger.warn('[followups] sincronização do alarme falhou', error);
      toast(data?.done === true
        ? 'Lembrete concluído, mas o alarme não pôde ser cancelado.'
        : 'Lembrete salvo, mas o alarme não pôde ser criado.', { type: 'warn' });
      return { saved: true, alarm: false };
    }
  }
  return { saved: true, alarm: true };
}

async function drop(ctx, contactId) {
  const { store, messenger, logger, toast } = ctx;
  try {
    await store.actions.clearFollowup(contactId);
  } catch (error) {
    logger.warn('[followups] clearFollowup falhou', error);
    toast('Não foi possível remover o lembrete.', { type: 'error' });
    return false;
  }
  if (messenger && typeof messenger.cancelFollowup === 'function') {
    try {
      const response = await messenger.cancelFollowup(contactId);
      if (!response || response.ok !== true) {
        logger.warn('[followups] service worker não confirmou o cancelamento', response);
      }
    } catch (error) {
      logger.warn('[followups] cancelamento do alarme falhou', error);
    }
  }
  return true;
}

export function openFollowupScheduler(ctx, contactId) {
  const { store, dialogs, toast } = ctx;
  const state = store.getState();
  const contact = (state.contacts || {})[contactId] || { name: 'Contato' };
  const existing = (state.followups || {})[contactId] || null;

  const titleInput = h('input', {
    class: 'kz-input',
    value: existing ? existing.title || '' : '',
    placeholder: 'Ex.: Enviar proposta revisada',
    attrs: { 'data-autofocus': '' }
  });

  const whenInput = h('input', {
    class: 'kz-input',
    type: 'datetime-local',
    value: toLocalInputValue(existing && existing.timestamp ? existing.timestamp : Date.now() + HOUR)
  });

  const presets = [
    ['Em 1 hora', () => Date.now() + HOUR],
    ['Em 3 horas', () => Date.now() + 3 * HOUR],
    ['Amanhã 9h', () => tomorrowAt(9)],
    ['Em 2 dias', () => Date.now() + 48 * HOUR],
    ['Em 1 semana', () => Date.now() + 168 * HOUR]
  ];

  const presetRow = h('div', { class: 'kz-row' }, ...presets.map(([label, fn]) => h('button', {
    class: 'kz-btn kz-btn--sm',
    type: 'button',
    onClick: () => {
      whenInput.value = toLocalInputValue(fn());
    }
  }, label)));

  const actions = [];
  if (existing) {
    actions.push({
      id: 'remove',
      label: 'Remover',
      variant: 'danger',
      onClick: async () => {
        const removed = await drop(ctx, contactId);
        if (removed) toast('Lembrete removido.', { type: 'success' });
        return removed;
      }
    });
  }
  actions.push({ id: 'cancel', label: 'Cancelar', variant: 'ghost', value: null });
  actions.push({
    id: 'save',
    label: 'Agendar',
    variant: 'primary',
    onClick: async () => {
      const timestamp = fromLocalInputValue(whenInput.value);
      if (!Number.isFinite(timestamp)) {
        whenInput.focus();
        toast('Informe uma data e hora válidas.', { type: 'warn' });
        return false;
      }
      const data = {
        contactId,
        contactName: contact.name,
        title: titleInput.value.trim() || `Retornar para ${contact.name}`,
        timestamp,
        done: false
      };
      const result = await persist(ctx, contactId, data);
      if (result?.saved && result?.alarm) {
        toast(`Lembrete agendado para ${new Date(timestamp).toLocaleString('pt-BR')}.`, { type: 'success' });
      }
      return Boolean(result?.saved);
    }
  });

  return dialogs.openDialog({
    title: `Follow-up · ${contact.name}`,
    body: (hh) => hh('div', { class: 'kz-section' },
      hh('div', { class: 'kz-field' }, hh('label', {}, 'O que precisa ser feito'), titleInput),
      hh('div', { class: 'kz-field' }, hh('label', {}, 'Quando'), whenInput, presetRow),
      hh('p', { class: 'kz-hint' }, 'Você recebe uma notificação do Chrome no horário. Se o navegador estiver fechado, o aviso aparece assim que ele abrir.')),
    actions
  });
}

export function openFollowupsList(ctx) {
  const { store, composer, dialogs, toast, logger } = ctx;
  const listEl = h('div', { class: 'kz-list' });

  function renderList() {
    const state = store.getState();
    const followups = Object.values(state.followups || {})
      .filter(Boolean)
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    clear(listEl);

    if (!followups.length) {
      listEl.appendChild(h('div', { class: 'kz-empty' },
        icon('bell', { size: 22 }),
        h('span', { class: 'kz-empty__title' }, 'Nenhum follow-up agendado'),
        h('span', { class: 'kz-empty__text' }, 'Use o sino no card para agendar um retorno.')));
      return;
    }

    const now = Date.now();
    for (const followup of followups) {
      const late = !followup.done && followup.timestamp <= now;
      const contact = (state.contacts || {})[followup.contactId];
      listEl.appendChild(h('div', { class: 'kz-list__item' },
        icon('clock', { size: 16 }),
        h('div', { class: 'kz-list__main' },
          h('div', { class: 'kz-list__title' }, followup.title || 'Follow-up'),
          h('div', { class: 'kz-list__sub' },
            `${followup.contactName || (contact && contact.name) || followup.contactId} · `,
            h('span', { class: late ? 'kz-chip kz-chip--due' : 'kz-chip' },
              `${new Date(followup.timestamp).toLocaleString('pt-BR')} (${relativeTime(followup.timestamp, now)})`),
            followup.done ? ' · concluído' : '')),
        contact && composer
          ? h('button', {
            class: 'kz-btn kz-btn--sm',
            type: 'button',
            attrs: { title: 'Abrir conversa' },
            onClick: async () => {
              try {
                const result = await composer.openChat(contact);
                if (result?.ok === false) {
                  toast(result.reason || 'Não foi possível abrir a conversa.', { type: 'error' });
                }
              } catch (error) {
                logger.warn('[followups] openChat falhou', error);
                toast('Não foi possível abrir a conversa.', { type: 'error' });
              }
            }
          }, 'Abrir')
          : null,
        h('button', {
          class: 'kz-btn kz-btn--sm',
          type: 'button',
          onClick: () => openFollowupScheduler(ctx, followup.contactId)
        }, 'Reagendar'),
        followup.done
          ? null
          : h('button', {
            class: 'kz-iconbtn',
            type: 'button',
            attrs: { 'aria-label': 'Marcar como concluído', title: 'Concluir' },
            onClick: async () => {
              await persist(ctx, followup.contactId, Object.assign({}, followup, { done: true }));
              renderList();
            }
          }, icon('check', { size: 15 })),
        h('button', {
          class: 'kz-iconbtn',
          type: 'button',
          attrs: { 'aria-label': 'Remover lembrete', title: 'Remover' },
          onClick: async () => {
            await drop(ctx, followup.contactId);
            renderList();
          }
        }, icon('trash', { size: 15 }))));
    }
  }

  renderList();

  return dialogs.openDialog({
    title: 'Follow-ups agendados',
    size: 'lg',
    body: () => listEl,
    actions: [{ id: 'close', label: 'Fechar', variant: 'ghost', value: null }]
  });
}
