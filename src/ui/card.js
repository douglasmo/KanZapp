/**
 * card.js — o card de contato.
 *
 * Cada card é criado UMA vez e depois só atualizado in-place (`update`), para
 * que o render por diff do board possa reaproveitar o nó: sem flicker, sem
 * perder foco, sem matar um drag em andamento.
 */
import { h, icon, setText, clear } from './h.js';

const AVATAR_PALETTE = ['#3f7f6c', '#2f5f9e', '#6a4c93', '#a4436e', '#9c5b1f', '#1f6f6b', '#4b4f9c'];

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function colorOf(name) {
  const str = String(name || '');
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

/** Tempo relativo em pt-BR. Mantido local para a UI não depender de core/. */
export function relativeTime(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = now - ts;
  if (diff < 0) {
    const ahead = Math.abs(diff);
    if (ahead < 60000) return 'em instantes';
    if (ahead < 3600000) return `em ${Math.round(ahead / 60000)} min`;
    if (ahead < 86400000) return `em ${Math.round(ahead / 3600000)} h`;
    return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return `há ${Math.floor(diff / 60000)} min`;
  if (diff < 86400000) return `há ${Math.floor(diff / 3600000)} h`;
  if (diff < 172800000) return 'ontem';
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function createCard(contactId, ctx) {
  const state = { avatarUrl: null, tagSig: '', name: '', archived: null };

  const avatarImg = h('img', {
    class: 'kz-avatar__img',
    alt: '',
    hidden: true,
    attrs: { loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }
  });
  // Fallback de avatar SEM atributo HTML: listener programático (P1 do contrato).
  avatarImg.addEventListener('error', () => {
    avatarImg.hidden = true;
    avatarImg.removeAttribute('src');
  });
  avatarImg.addEventListener('load', () => {
    if (avatarImg.getAttribute('src')) avatarImg.hidden = false;
  });

  const avatarFallback = h('span', { class: 'kz-avatar__fallback', attrs: { 'aria-hidden': 'true' } });
  const unreadBadge = h('span', { class: 'kz-badge-unread', hidden: true });
  const avatar = h('span', { class: 'kz-avatar' }, avatarFallback, avatarImg, unreadBadge);

  const nameEl = h('span', { class: 'kz-card__name' });
  const timeEl = h('span', { class: 'kz-card__time' });
  const previewEl = h('span', { class: 'kz-card__preview' });
  const tagsEl = h('span', { class: 'kz-card__tags' });

  const noteChip = h('span', { class: 'kz-chip', hidden: true, attrs: { title: 'Tem nota interna' } }, icon('note', { size: 13 }));
  const followChip = h('span', { class: 'kz-chip', hidden: true }, icon('bell', { size: 13 }), h('span', {}));

  function actionButton(name, label, handler) {
    return h('button', {
      class: 'kz-iconbtn',
      type: 'button',
      dataset: { cardAction: name },
      attrs: { 'aria-label': label, title: label },
      onPointerDown: (event) => event.stopPropagation(),
      onClick: (event) => {
        event.stopPropagation();
        event.preventDefault();
        handler(contactId, el);
      }
    }, icon(name, { size: 15 }));
  }

  const tagBtn = actionButton('tag', 'Tags do contato', ctx.onTags);
  const messageBtn = actionButton('message', 'Enviar modelo de mensagem', ctx.onTemplate);
  const bellBtn = actionButton('bell', 'Agendar follow-up', ctx.onFollowup);
  const noteBtn = actionButton('note', 'Nota interna', ctx.onNote);
  const archiveBtn = actionButton('archive', 'Arquivar (tira do funil, sem apagar)', ctx.onArchive || (() => {}));

  const el = h('article', {
    class: 'kz-card',
    dataset: { cardId: contactId },
    attrs: {
      tabindex: '0',
      role: 'listitem',
      'aria-grabbed': 'false',
      'aria-roledescription': 'card do funil, pressione espaço para mover com o teclado'
    },
    onClick: (event) => {
      if (event.defaultPrevented) return;
      if (ctx.isDragging && ctx.isDragging()) return;
      // quem decide entre abrir a conversa e (des)selecionar é o board: só ele
      // conhece o estado da seleção múltipla
      if (typeof ctx.onCardClick === 'function') ctx.onCardClick(contactId, event);
      else ctx.onOpenChat(contactId);
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter' && !event.altKey) {
        event.preventDefault();
        ctx.onOpenChat(contactId);
      }
    }
  },
  tagsEl,
  h('div', { class: 'kz-card__top' },
    avatar,
    h('span', { class: 'kz-card__info' },
      h('span', { class: 'kz-card__name-row' }, nameEl, timeEl),
      previewEl)),
  h('div', { class: 'kz-card__meta' },
    noteChip,
    followChip,
    h('div', { class: 'kz-card__actions' }, tagBtn, messageBtn, bellBtn, noteBtn, archiveBtn)));

  function update(model) {
    const contact = model.contact || {};
    const card = model.card || {};
    const now = model.now || Date.now();
    const name = contact.name || 'Sem nome';

    if (state.name !== name) {
      state.name = name;
      setText(nameEl, name);
      setText(avatarFallback, initialsOf(name));
      avatar.style.setProperty('--kz-avatar-bg', colorOf(name));
      el.setAttribute('aria-label', name);
    }

    const avatarUrl = contact.avatarUrl || '';
    if (state.avatarUrl !== avatarUrl) {
      state.avatarUrl = avatarUrl;
      if (avatarUrl) {
        avatarImg.setAttribute('src', avatarUrl);
        // fica escondido até o `load`; se falhar, o fallback já está atrás
        avatarImg.hidden = !avatarImg.complete || !avatarImg.naturalWidth;
      } else {
        avatarImg.hidden = true;
        avatarImg.removeAttribute('src');
      }
    }

    setText(previewEl, contact.preview || 'Sem mensagens');
    setText(timeEl, contact.timeLabel || relativeTime(contact.lastSeenAt, now));

    const unread = Number(contact.unread) || 0;
    unreadBadge.hidden = unread <= 0;
    if (unread > 0) setText(unreadBadge, unread > 99 ? '99+' : String(unread));
    el.classList.toggle('is-unread', unread > 0);

    const tags = model.tags || [];
    const sig = tags.map((t) => `${t.id}:${t.name}:${t.color}`).join('|');
    if (sig !== state.tagSig) {
      state.tagSig = sig;
      clear(tagsEl);
      for (const tag of tags) {
        const pill = h('span', {
          class: 'kz-pill',
          attrs: { title: tag.description || tag.name }
        }, tag.name);
        pill.style.setProperty('--kz-pill-bg', tag.color || '#4c6773');
        tagsEl.appendChild(pill);
      }
    }

    const hasNote = Boolean(card.note && String(card.note).trim());
    noteChip.hidden = !hasNote;
    noteBtn.classList.toggle('is-on', hasNote);

    const followup = model.followup;
    if (followup && !followup.done && followup.timestamp) {
      followChip.hidden = false;
      const late = followup.timestamp <= now;
      followChip.className = `kz-chip ${late ? 'kz-chip--due' : 'kz-chip--soon'}`;
      setText(followChip.lastChild, `${followup.title || 'Follow-up'} · ${relativeTime(followup.timestamp, now)}`);
      followChip.setAttribute('title', new Date(followup.timestamp).toLocaleString('pt-BR'));
      bellBtn.classList.toggle('is-alert', late);
      bellBtn.classList.toggle('is-on', !late);
    } else {
      followChip.hidden = true;
      bellBtn.classList.remove('is-alert');
      bellBtn.classList.remove('is-on');
    }

    const tagCount = tags.length;
    tagBtn.classList.toggle('is-on', tagCount > 0);

    // arquivado: fica esmaecido e a ação vira "Desarquivar" (§7)
    const archived = card.archived === true;
    if (state.archived !== archived) {
      state.archived = archived;
      el.classList.toggle('is-archived', archived);
      const label = archived ? 'Desarquivar (volta para o funil)' : 'Arquivar (tira do funil, sem apagar)';
      archiveBtn.setAttribute('aria-label', label);
      archiveBtn.setAttribute('title', label);
      archiveBtn.classList.toggle('is-on', archived);
    }
  }

  return { el, update, contactId };
}
