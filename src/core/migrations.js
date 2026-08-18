// Migracao v1 -> v2. Funcao pura, idempotente e sem perda de dados.
// As chaves da v1 NAO sao apagadas aqui: ficam como backup ate o usuario limpar.

import {
  SCHEMA_VERSION,
  LEGACY_KEYS,
  COLUMN_PALETTE,
  TAG_PALETTE,
  GROUP_JID_RE,
  LEGACY_COLUMN_ALIAS,
  defaultColumns,
  defaultSettings,
  defaultState
} from './constants.js';
import { normalizeText, normalizeForMatch, extractJid, nameIdFor, idKindOf, clamp } from './utils.js';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asObject(value) {
  return isPlainObject(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Traduz um id da v1 para o formato v2.
 * A v1 caia no NOME quando nao havia `data-id` — por isso o nome vira
 * `name:<hash>`, exatamente o que o adapter v2 gera. Sem isso o CRM antigo
 * ficaria orfao depois da atualizacao.
 */
export function mapLegacyId(oldId) {
  const raw = normalizeText(oldId);
  if (!raw) return null;
  const jid = extractJid(raw);
  if (jid) return { id: jid, idKind: 'jid', name: '' };
  if (raw.startsWith('name:')) return { id: raw, idKind: 'name', name: '' };
  // id da v1 == nome do contato
  return { id: nameIdFor(raw), idKind: 'name', name: raw };
}

function normalizeColumns(list, fallbackPalette = COLUMN_PALETTE) {
  const seen = new Set();
  const out = [];
  asArray(list).forEach((col, index) => {
    if (!isPlainObject(col)) return;
    const id = normalizeText(col.id) || `col_${index}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      title: normalizeText(col.title) || `Coluna ${index + 1}`,
      color: normalizeText(col.color) || fallbackPalette[index % fallbackPalette.length],
      wipLimit: Number.isFinite(col.wipLimit) && col.wipLimit > 0 ? Math.floor(col.wipLimit) : null,
      collapsed: col.collapsed === true
    });
  });
  return out.length ? out : defaultColumns();
}

function normalizeTags(list) {
  const seen = new Set();
  const out = [];
  asArray(list).forEach((tag, index) => {
    if (!isPlainObject(tag)) return;
    const id = normalizeText(tag.id) || `tag_${index}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      name: normalizeText(tag.name) || `Tag ${index + 1}`,
      color: normalizeText(tag.color) || TAG_PALETTE[index % TAG_PALETTE.length],
      description: normalizeText(tag.description)
    });
  });
  return out;
}

function normalizeTemplates(list) {
  const seen = new Set();
  const out = [];
  asArray(list).forEach((tpl, index) => {
    if (!isPlainObject(tpl)) return;
    const id = normalizeText(tpl.id) || `tpl_${index}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      title: normalizeText(tpl.title) || `Mensagem ${index + 1}`,
      text: typeof tpl.text === 'string' ? tpl.text : '',
      shortcut: normalizeText(tpl.shortcut)
    });
  });
  return out;
}

function normalizeSettings(raw) {
  const base = defaultSettings();
  const src = asObject(raw);
  const out = { ...base };
  if (['auto', 'light', 'dark'].includes(src.theme)) out.theme = src.theme;
  if (['comfortable', 'compact'].includes(src.density)) out.density = src.density;
  if (typeof src.autoRefresh === 'boolean') out.autoRefresh = src.autoRefresh;
  if (Number.isFinite(src.refreshMs)) out.refreshMs = clamp(src.refreshMs, 1000, 60000);
  if (typeof src.onlyUnread === 'boolean') out.onlyUnread = src.onlyUnread;
  if (typeof src.hideGroups === 'boolean') out.hideGroups = src.hideGroups;
  // arquivamento do KanZapp, nao do WhatsApp — ver constants.js
  if (typeof src.showArchived === 'boolean') out.showArchived = src.showArchived;
  if (['inbox', 'name', 'recent', 'manual'].includes(src.sort)) out.sort = src.sort;
  if (typeof src.debug === 'boolean') out.debug = src.debug;
  if (isPlainObject(src.launcherPos)) {
    out.launcherPos = { x: Number(src.launcherPos.x) || 0, y: Number(src.launcherPos.y) || 0 };
  }
  return out;
}

function makeContact(partial, now) {
  const name = normalizeText(partial.name);
  return {
    id: partial.id,
    idKind: partial.idKind || idKindOf(partial.id),
    name,
    avatarUrl: normalizeText(partial.avatarUrl),
    preview: normalizeText(partial.preview),
    unread: Number.isFinite(partial.unread) ? Math.max(0, Math.floor(partial.unread)) : 0,
    isGroup: partial.isGroup === true || GROUP_JID_RE.test(partial.id || ''),
    // rotulo de hora que o proprio WhatsApp mostra ("10:03", "ontem"): sem ele
    // o card cai no tempo relativo de `lastSeenAt`, que e reescrito a cada
    // sincronizacao e faria todo card dizer "agora" para sempre
    timeLabel: normalizeText(partial.timeLabel),
    muted: partial.muted === true,
    pinned: partial.pinned === true,
    lastSeenAt: Number.isFinite(partial.lastSeenAt) ? partial.lastSeenAt : now,
    firstSeenAt: Number.isFinite(partial.firstSeenAt) ? partial.firstSeenAt : now,
    // posicao na lista lateral da ultima sincronizacao (null = fora do viewport)
    inboxOrder: Number.isFinite(partial.inboxOrder) ? partial.inboxOrder : null
  };
}

function makeCard(partial, columnId, now) {
  const archived = partial.archived === true;
  return {
    columnId,
    order: Number.isFinite(partial.order) ? partial.order : 0,
    tagIds: asArray(partial.tagIds).map((t) => normalizeText(t)).filter(Boolean),
    note: typeof partial.note === 'string' ? partial.note : '',
    // arquivamento proprio do KanZapp: card fora do funil, sempre reversivel
    archived,
    archivedAt: archived && Number.isFinite(partial.archivedAt) ? partial.archivedAt : (archived ? now : 0),
    createdAt: Number.isFinite(partial.createdAt) ? partial.createdAt : now,
    updatedAt: Number.isFinite(partial.updatedAt) ? partial.updatedAt : now
  };
}

/** Reatribui `order` como inteiros densos por coluna, preservando a ordem atual. */
export function densifyOrders(cards) {
  const byColumn = new Map();
  for (const [id, card] of Object.entries(cards)) {
    if (!byColumn.has(card.columnId)) byColumn.set(card.columnId, []);
    byColumn.get(card.columnId).push(id);
  }
  for (const [, ids] of byColumn) {
    ids.sort((a, b) => {
      const diff = (cards[a].order ?? 0) - (cards[b].order ?? 0);
      return diff !== 0 ? diff : a.localeCompare(b);
    });
    ids.forEach((id, index) => {
      cards[id].order = index;
    });
  }
  return cards;
}

/**
 * @param {object|null} raw estado v2 lido do storage (ou null)
 * @param {object} legacy dump das chaves da v1
 * @param {{now?: number}} [opts]
 * @returns {object} estado v2 valido
 */
export function migrate(raw, legacy = {}, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const src = asObject(raw);
  const lg = asObject(legacy);
  const state = defaultState();
  state.version = SCHEMA_VERSION;

  // --- colunas -------------------------------------------------------------
  const hasV2Columns = Array.isArray(src.columns) && src.columns.length > 0;
  const hasV1Columns = Array.isArray(lg.kanbanColumns) && lg.kanbanColumns.length > 0;
  state.columns = hasV2Columns
    ? normalizeColumns(src.columns)
    : hasV1Columns
      ? normalizeColumns(lg.kanbanColumns)
      : defaultColumns();
  const columnIds = new Set(state.columns.map((c) => c.id));
  const firstColumnId = state.columns[0].id;

  function resolveColumnId(value) {
    const id = normalizeText(value);
    if (columnIds.has(id)) return id;
    const alias = LEGACY_COLUMN_ALIAS[id];
    if (alias && columnIds.has(alias)) return alias;
    return firstColumnId;
  }

  // --- tags e templates ----------------------------------------------------
  state.tags = normalizeTags(
    Array.isArray(src.tags) && src.tags.length ? src.tags : lg.kanbanTags
  );
  state.templates = normalizeTemplates(
    Array.isArray(src.templates) && src.templates.length ? src.templates : lg.kanbanMessages
  );
  const knownTagIds = new Set(state.tags.map((t) => t.id));

  // --- contatos ------------------------------------------------------------
  /** @type {Record<string, object>} */
  const contacts = {};

  function upsertContact(id, patch) {
    if (!id) return null;
    const existing = contacts[id];
    if (!existing) {
      contacts[id] = makeContact({ id, ...patch }, now);
      return contacts[id];
    }
    // merge conservador: nunca sobrescreve valor bom por vazio
    const merged = { ...existing };
    if (patch.name && !merged.name) merged.name = normalizeText(patch.name);
    if (patch.avatarUrl && !merged.avatarUrl) merged.avatarUrl = normalizeText(patch.avatarUrl);
    if (patch.preview && !merged.preview) merged.preview = normalizeText(patch.preview);
    if (Number.isFinite(patch.unread) && patch.unread > merged.unread) merged.unread = patch.unread;
    if (Number.isFinite(patch.lastSeenAt) && patch.lastSeenAt > merged.lastSeenAt) {
      merged.lastSeenAt = patch.lastSeenAt;
    }
    if (Number.isFinite(patch.firstSeenAt) && patch.firstSeenAt < merged.firstSeenAt) {
      merged.firstSeenAt = patch.firstSeenAt;
    }
    if (Number.isFinite(patch.inboxOrder)) merged.inboxOrder = patch.inboxOrder;
    if (patch.timeLabel && !merged.timeLabel) merged.timeLabel = normalizeText(patch.timeLabel);
    merged.muted = merged.muted === true || patch.muted === true;
    merged.pinned = merged.pinned === true || patch.pinned === true;
    merged.isGroup = merged.isGroup || patch.isGroup === true;
    contacts[id] = merged;
    return merged;
  }

  // contatos ja em v2 mantem o id como esta
  for (const [id, contact] of Object.entries(asObject(src.contacts))) {
    if (!isPlainObject(contact)) continue;
    upsertContact(normalizeText(contact.id) || normalizeText(id), {
      idKind: contact.idKind,
      name: contact.name,
      avatarUrl: contact.avatarUrl,
      preview: contact.preview,
      unread: contact.unread,
      isGroup: contact.isGroup,
      timeLabel: contact.timeLabel,
      muted: contact.muted,
      pinned: contact.pinned,
      lastSeenAt: contact.lastSeenAt,
      firstSeenAt: contact.firstSeenAt,
      inboxOrder: contact.inboxOrder
    });
  }

  // contatos da v1 (allConversations + inboxConversations)
  const legacyContacts = { ...asObject(lg.allConversations), ...asObject(lg.inboxConversations) };
  for (const [legacyId, conv] of Object.entries(legacyContacts)) {
    const mapped = mapLegacyId(conv?.id || legacyId);
    if (!mapped) continue;
    const scrapedAt = Number.isFinite(conv?.scrapedAt) ? conv.scrapedAt : now;
    upsertContact(mapped.id, {
      idKind: mapped.idKind,
      name: normalizeText(conv?.name) || mapped.name,
      avatarUrl: conv?.avatarUrl,
      preview: conv?.lastMsg ?? conv?.preview,
      unread: Number(conv?.unreadCount ?? conv?.unread) || 0,
      isGroup: GROUP_JID_RE.test(mapped.id),
      lastSeenAt: scrapedAt,
      firstSeenAt: scrapedAt
    });
  }

  // Alguns backups v1 usam o nome nas chaves do CRM, mesmo quando a lista de
  // conversas ja contem o JID. Correlacionamos apenas nomes com um unico JID;
  // em caso de homonimos mantemos o id fraco para nao fundir pessoas distintas.
  const strongIdsByName = new Map();
  for (const contact of Object.values(contacts)) {
    if (contact.idKind !== 'jid') continue;
    const key = normalizeForMatch(contact.name);
    if (!key) continue;
    if (!strongIdsByName.has(key)) strongIdsByName.set(key, []);
    strongIdsByName.get(key).push(contact.id);
  }

  function mapLegacyEntityId(value, nameHint = '') {
    const mapped = mapLegacyId(value);
    if (!mapped || mapped.idKind !== 'name') return mapped;
    const key = normalizeForMatch(nameHint || mapped.name || value);
    const matches = strongIdsByName.get(key) || [];
    if (matches.length !== 1) return mapped;
    return { id: matches[0], idKind: 'jid', name: mapped.name || normalizeText(nameHint) };
  }

  // --- cards ---------------------------------------------------------------
  /** @type {Record<string, object>} */
  const cards = {};

  function ensureCard(id, columnId) {
    if (!cards[id]) {
      cards[id] = makeCard({}, columnId ?? firstColumnId, now);
    } else if (columnId) {
      cards[id].columnId = columnId;
    }
    return cards[id];
  }

  // cards ja em v2
  for (const [id, card] of Object.entries(asObject(src.cards))) {
    if (!isPlainObject(card)) continue;
    const key = normalizeText(id);
    if (!key) continue;
    cards[key] = makeCard(card, resolveColumnId(card.columnId), now);
  }

  // kanbanData: contactId -> columnId
  for (const [legacyId, columnId] of Object.entries(asObject(lg.kanbanData))) {
    const mapped = mapLegacyEntityId(legacyId);
    if (!mapped) continue;
    if (!cards[mapped.id]) ensureCard(mapped.id, resolveColumnId(columnId));
    if (mapped.name && !contacts[mapped.id]) {
      upsertContact(mapped.id, { idKind: mapped.idKind, name: mapped.name });
    }
  }

  // contactTags: contactId -> [tagId]
  for (const [legacyId, tagIds] of Object.entries(asObject(lg.contactTags))) {
    const mapped = mapLegacyEntityId(legacyId);
    if (!mapped) continue;
    const card = ensureCard(mapped.id);
    const incoming = asArray(tagIds).map((t) => normalizeText(t)).filter(Boolean);
    card.tagIds = [...new Set([...card.tagIds, ...incoming])];
    if (mapped.name && !contacts[mapped.id]) {
      upsertContact(mapped.id, { idKind: mapped.idKind, name: mapped.name });
    }
  }

  // contactNotes: contactId -> texto
  for (const [legacyId, note] of Object.entries(asObject(lg.contactNotes))) {
    const mapped = mapLegacyEntityId(legacyId);
    if (!mapped) continue;
    const card = ensureCard(mapped.id);
    if (!card.note && typeof note === 'string') card.note = note;
    if (mapped.name && !contacts[mapped.id]) {
      upsertContact(mapped.id, { idKind: mapped.idKind, name: mapped.name });
    }
  }

  // limpa referencias a tags inexistentes (so quando ha catalogo de tags)
  if (knownTagIds.size > 0) {
    for (const card of Object.values(cards)) {
      card.tagIds = card.tagIds.filter((t) => knownTagIds.has(t));
    }
  }

  // todo contato precisa de card, e todo card precisa de contato
  for (const id of Object.keys(contacts)) ensureCard(id);
  for (const id of Object.keys(cards)) {
    if (!contacts[id]) {
      upsertContact(id, { idKind: idKindOf(id), name: '' });
    }
  }

  state.contacts = contacts;
  state.cards = densifyOrders(cards);

  // --- follow-ups ----------------------------------------------------------
  /** @type {Record<string, object>} */
  const followups = {};
  const rawFollowups = { ...asObject(lg.followups), ...asObject(src.followups) };
  for (const [legacyId, fu] of Object.entries(rawFollowups)) {
    if (!isPlainObject(fu)) continue;
    const mapped = mapLegacyEntityId(fu.contactId || legacyId, fu.contactName);
    if (!mapped) continue;
    const timestamp = Number(fu.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    const contactName = normalizeText(fu.contactName) || contacts[mapped.id]?.name || mapped.name;
    followups[mapped.id] = {
      contactId: mapped.id,
      contactName,
      title: normalizeText(fu.title) || 'Lembrete',
      timestamp,
      done: fu.done === true
    };
    if (!contacts[mapped.id] && contactName) {
      upsertContact(mapped.id, { idKind: mapped.idKind, name: contactName });
      ensureCard(mapped.id);
    }
  }
  state.followups = followups;

  // --- settings ------------------------------------------------------------
  state.settings = normalizeSettings(src.settings);

  return state;
}

/** `true` quando ha qualquer dado v1 aproveitavel no dump. */
export function hasLegacyData(legacy) {
  const lg = asObject(legacy);
  return Object.keys(lg).some((key) => {
    const value = lg[key];
    if (Array.isArray(value)) return value.length > 0;
    if (isPlainObject(value)) return Object.keys(value).length > 0;
    return false;
  });
}

/** Valida o formato de um estado importado antes de aplicar. */
export function validateState(candidate, { complete = false } = {}) {
  const errors = [];
  if (!isPlainObject(candidate)) {
    return { ok: false, errors: ['O arquivo não contém um objeto JSON válido.'] };
  }
  const owns = (key) => Object.prototype.hasOwnProperty.call(candidate, key);
  const v2DataFields = ['columns', 'tags', 'templates', 'contacts', 'cards', 'followups'];
  const legacyDataFields = LEGACY_KEYS.filter((key) => key !== 'inboxLastUpdatedAt');
  const legacyExclusiveFields = legacyDataFields.filter((key) => key !== 'followups');
  const hasV2ExclusiveShape = [...v2DataFields.filter((key) => key !== 'followups'), 'settings'].some(owns);
  const canBeLegacy = candidate.version === undefined || candidate.version === 1;
  const hasLegacyShape = canBeLegacy && !hasV2ExclusiveShape && (
    legacyExclusiveFields.some(owns) || owns('followups')
  );
  const hasRecognizedData = v2DataFields.some(owns) || legacyExclusiveFields.some(owns);
  if (!hasRecognizedData) {
    errors.push('O arquivo não tem campos reconhecidos de um backup KanZapp.');
  }
  if (candidate.version !== undefined
    && (!Number.isInteger(candidate.version) || candidate.version < 1)) {
    errors.push('Campo "version" inválido.');
  } else if (candidate.version !== undefined && candidate.version > SCHEMA_VERSION) {
    errors.push('O arquivo veio de uma versão mais nova da extensão.');
  }

  if (candidate.version === 1 && !hasLegacyShape) {
    errors.push('O backup v1 não contém campos legados reconhecidos.');
  }

  // O export v2 e completo. Em "Substituir tudo", recusar objetos parciais
  // evita que um JSON de outro produto seja normalizado para um quadro vazio.
  if (complete && !hasLegacyShape) {
    const required = ['version', 'columns', 'tags', 'templates', 'contacts', 'cards', 'followups', 'settings'];
    for (const key of required) {
      if (!owns(key)) errors.push(`Campo obrigatório "${key}" ausente.`);
    }
    if (candidate.version !== SCHEMA_VERSION) {
      errors.push(`O backup v2 precisa declarar version ${SCHEMA_VERSION}.`);
    }
  }
  if (candidate.columns !== undefined && !Array.isArray(candidate.columns)) {
    errors.push('Campo "columns" inválido.');
  }
  if (candidate.tags !== undefined && !Array.isArray(candidate.tags)) {
    errors.push('Campo "tags" inválido.');
  }
  if (candidate.templates !== undefined && !Array.isArray(candidate.templates)) {
    errors.push('Campo "templates" inválido.');
  }
  for (const key of ['contacts', 'cards', 'followups', 'settings']) {
    if (candidate[key] !== undefined && !isPlainObject(candidate[key])) {
      errors.push(`Campo "${key}" inválido.`);
    }
  }
  for (const key of ['kanbanColumns', 'kanbanTags', 'kanbanMessages']) {
    if (candidate[key] !== undefined && !Array.isArray(candidate[key])) {
      errors.push(`Campo "${key}" inválido.`);
    }
  }
  for (const key of ['contactTags', 'kanbanData', 'contactNotes', 'allConversations', 'inboxConversations']) {
    if (candidate[key] !== undefined && !isPlainObject(candidate[key])) {
      errors.push(`Campo "${key}" inválido.`);
    }
  }

  function validateCatalog(key, { requireTitle = false, requireName = false } = {}) {
    const list = candidate[key];
    if (!Array.isArray(list)) return;
    const ids = new Set();
    list.forEach((item, index) => {
      if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id.trim()) {
        errors.push(`Item ${index + 1} de "${key}" não tem id válido.`);
        return;
      }
      if (ids.has(item.id)) errors.push(`Id duplicado "${item.id}" em "${key}".`);
      ids.add(item.id);
      if (requireTitle && (typeof item.title !== 'string' || !item.title.trim())) {
        errors.push(`Item ${index + 1} de "${key}" não tem título válido.`);
      }
      if (requireName && (typeof item.name !== 'string' || !item.name.trim())) {
        errors.push(`Item ${index + 1} de "${key}" não tem nome válido.`);
      }
    });
  }

  validateCatalog('columns', { requireTitle: true });
  validateCatalog('tags', { requireName: true });
  validateCatalog('templates', { requireTitle: true });

  if (complete && Array.isArray(candidate.columns) && candidate.columns.length === 0) {
    errors.push('O backup v2 precisa conter ao menos uma coluna.');
  }

  if (isPlainObject(candidate.contacts)) {
    for (const [id, contact] of Object.entries(candidate.contacts)) {
      if (!id || !isPlainObject(contact) || typeof contact.id !== 'string' || contact.id !== id) {
        errors.push(`Contato "${id}" inválido.`);
      }
    }
  }
  if (isPlainObject(candidate.cards)) {
    const columnIds = new Set(asArray(candidate.columns).map((column) => column?.id));
    for (const [id, card] of Object.entries(candidate.cards)) {
      if (!id || !isPlainObject(card) || typeof card.columnId !== 'string' || !card.columnId) {
        errors.push(`Card "${id}" inválido.`);
        continue;
      }
      if (columnIds.size && !columnIds.has(card.columnId)) {
        errors.push(`Card "${id}" aponta para uma coluna inexistente.`);
      }
      if (card.tagIds !== undefined && !Array.isArray(card.tagIds)) {
        errors.push(`Card "${id}" tem tags inválidas.`);
      }
    }
  }
  if (isPlainObject(candidate.followups)) {
    for (const [id, followup] of Object.entries(candidate.followups)) {
      if (!id || !isPlainObject(followup)
        || typeof followup.contactId !== 'string' || !followup.contactId
        || !Number.isFinite(followup.timestamp)) {
        errors.push(`Follow-up "${id}" inválido.`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
