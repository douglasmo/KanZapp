// Fonte unica de verdade do CRM. Nenhum outro modulo escreve no storage.

import { SCHEMA_VERSION, LEGACY_KEYS, COLUMN_PALETTE, TAG_PALETTE, defaultState } from './constants.js';
import { migrate, validateState, hasLegacyData } from './migrations.js';
import { createEmitter } from './events.js';
import { createStorageDriver } from './storage-driver.js';
import { parseSearchQuery, matchesSearchQuery } from './search.js';
import {
  deepFreeze,
  deepClone,
  normalizeText,
  normalizeForMatch,
  nameIdFor,
  idKindOf,
  clamp,
  nextId
} from './utils.js';

const CHANGE = 'change';

function idsInColumn(draft, columnId) {
  return Object.keys(draft.cards)
    .filter((id) => draft.cards[id].columnId === columnId)
    .sort((a, b) => {
      const diff = (draft.cards[a].order ?? 0) - (draft.cards[b].order ?? 0);
      return diff !== 0 ? diff : a.localeCompare(b);
    });
}

function renumber(draft, ids) {
  ids.forEach((id, index) => {
    if (draft.cards[id]) draft.cards[id].order = index;
  });
}

/**
 * @param {{driver?: object, logger?: object}} [options]
 */
export function createStore(options = {}) {
  const logger = options.logger || null;
  const ownsDriver = !options.driver;
  const driver = options.driver || createStorageDriver({ logger });
  const emitter = createEmitter({
    onError: (error) => logger?.error?.('subscriber falhou', error)
  });

  let state = deepFreeze(defaultState());
  let readyPromise = null;
  let stopExternal = null;
  let destroyed = false;

  function setState(next) {
    state = deepFreeze(next && typeof next === 'object' ? next : defaultState());
    emitter.emit(CHANGE, state);
    return state;
  }

  /** Aplica `mutator(draft)` de forma serializada pelo driver. */
  async function apply(mutator) {
    if (destroyed) return state;
    const next = await driver.mutate((draft) => {
      // migrate(draft, {}) tambem funciona como normalizador de invariantes
      const base = migrate(draft, {});
      mutator(base);
      base.version = SCHEMA_VERSION;
      return base;
    });
    return setState(next || deepClone(state));
  }

  async function load() {
    const raw = await driver.read();
    const needsLegacy = !raw || Number(raw.version) !== SCHEMA_VERSION;
    // as chaves v1 so entram quando ainda nao ha estado v2: evita ressuscitar
    // dados que o usuario apagou depois da migracao
    const legacy = needsLegacy ? await driver.readRaw(LEGACY_KEYS) : {};
    const migrated = migrate(raw, legacy);
    const changed = !raw || Number(raw.version) !== SCHEMA_VERSION || hasLegacyData(legacy);
    if (changed) {
      await driver.mutate(() => migrated);
    }
    setState(migrated);

    stopExternal = driver.onExternalChange((incoming) => {
      if (destroyed) return;
      setState(migrate(incoming, {}));
    });
    return state;
  }

  function ready() {
    if (!readyPromise) readyPromise = load().catch((error) => {
      logger?.error?.('falha ao carregar o estado', error);
      return setState(defaultState());
    });
    return readyPromise;
  }

  function getState() {
    return state;
  }

  function subscribe(fn) {
    return emitter.on(CHANGE, fn);
  }

  function destroy() {
    destroyed = true;
    if (typeof stopExternal === 'function') stopExternal();
    stopExternal = null;
    emitter.clear();
    if (ownsDriver && typeof driver.dispose === 'function') driver.dispose();
  }

  // --- acoes ---------------------------------------------------------------

  function buildNameIndex(draft) {
    const index = new Map();
    for (const contact of Object.values(draft.contacts)) {
      const key = normalizeForMatch(contact.name);
      if (!key) continue;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(contact.id);
    }
    return index;
  }

  /** Funde o registro `fromId` em `toId` sem perder tag, nota ou lembrete. */
  function mergeContact(draft, fromId, toId) {
    if (fromId === toId) return;
    const fromCard = draft.cards[fromId];
    const toCard = draft.cards[toId];
    if (fromCard) {
      if (!toCard) {
        draft.cards[toId] = { ...fromCard };
      } else {
        toCard.tagIds = [...new Set([...toCard.tagIds, ...fromCard.tagIds])];
        if (!toCard.note) toCard.note = fromCard.note;
        else if (fromCard.note && fromCard.note !== toCard.note) {
          toCard.note = `${toCard.note}\n\n${fromCard.note}`;
        }
        toCard.createdAt = Math.min(toCard.createdAt, fromCard.createdAt);
        toCard.columnId = fromCard.columnId || toCard.columnId;
        toCard.order = fromCard.order ?? toCard.order;
      }
      delete draft.cards[fromId];
    }
    const fromFollowup = draft.followups[fromId];
    if (fromFollowup && !draft.followups[toId]) {
      draft.followups[toId] = { ...fromFollowup, contactId: toId };
    }
    delete draft.followups[fromId];

    const fromContact = draft.contacts[fromId];
    const toContact = draft.contacts[toId];
    if (fromContact && toContact) {
      toContact.firstSeenAt = Math.min(toContact.firstSeenAt, fromContact.firstSeenAt);
      if (!toContact.name) toContact.name = fromContact.name;
      if (!toContact.avatarUrl) toContact.avatarUrl = fromContact.avatarUrl;
    }
    delete draft.contacts[fromId];
  }

  /**
   * P3: quando chega um id melhor (jid/dom) para um contato antes conhecido
   * apenas pelo nome, migra o CRM em vez de criar um registro novo.
   */
  function resolveIdentity(draft, chat, nameIndex, suspicious) {
    const id = chat.id;
    const kind = chat.idKind || idKindOf(id);
    // nome suspeito nunca funde identidades: fundir e irreversivel
    if (suspicious && suspicious.has(normalizeForMatch(chat.name))) return id;
    if (draft.contacts[id]) {
      // Corrige estados v2 que ja foram gravados por uma migracao antiga com
      // o mesmo contato duplicado como JID e `name:<hash>`.
      if (kind !== 'name' && normalizeForMatch(chat.name)) {
        const weakId = nameIdFor(chat.name);
        if (weakId !== id && draft.contacts[weakId]) mergeContact(draft, weakId, id);
      }
      return id;
    }
    if (kind === 'name') return id;

    const nameKey = normalizeForMatch(chat.name);
    if (!nameKey) return id;

    const weakId = nameIdFor(chat.name);
    if (draft.contacts[weakId]) {
      mergeContact(draft, weakId, id);
      return id;
    }
    for (const candidate of nameIndex.get(nameKey) || []) {
      if (candidate === id) continue;
      const contact = draft.contacts[candidate];
      if (!contact) continue;
      if (contact.idKind === 'jid') continue; // ja tem identidade forte propria
      mergeContact(draft, candidate, id);
      return id;
    }
    return id;
  }

  /**
   * Nomes que se repetem em boa parte do lote sao quase sempre um rotulo da
   * interface do WhatsApp que vazou para a extracao ("Menu de contexto da
   * conversa"). Eles nao podem sobrescrever um nome bom ja gravado em disco —
   * a corrupcao seria persistente e o backup exportado a carregaria junto.
   */
  function suspiciousNames(chats) {
    const counts = new Map();
    for (const chat of chats) {
      const key = normalizeForMatch(chat?.name);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const out = new Set();
    if (chats.length < 3) return out;
    for (const [key, count] of counts) {
      if (count >= 3 && count >= chats.length * 0.5) out.add(key);
    }
    return out;
  }

  function syncContacts(list) {
    const chats = Array.isArray(list) ? list : [];
    if (chats.length === 0) return Promise.resolve(state);
    const suspicious = suspiciousNames(chats);
    return apply((draft) => {
      const now = Date.now();
      const firstColumn = draft.columns[0].id;
      const nameIndex = buildNameIndex(draft);
      let tail = idsInColumn(draft, firstColumn).length;

      for (const chat of chats) {
        if (!chat || !chat.id) continue;
        const id = resolveIdentity(draft, chat, nameIndex, suspicious);
        const existing = draft.contacts[id];
        const incomingName = normalizeText(chat.name);
        const poisoned = incomingName
          && suspicious.has(normalizeForMatch(incomingName))
          && Boolean(existing?.name)
          && normalizeForMatch(existing.name) !== normalizeForMatch(incomingName);
        if (poisoned) {
          logger?.warn?.('[store] nome suspeito ignorado na sincronização', {
            id,
            recebido: incomingName,
            mantido: existing.name
          });
        }
        draft.contacts[id] = {
          id,
          idKind: chat.idKind || existing?.idKind || idKindOf(id),
          name: (poisoned ? '' : incomingName) || existing?.name || incomingName || '',
          avatarUrl: normalizeText(chat.avatarUrl) || existing?.avatarUrl || '',
          preview: normalizeText(chat.preview) || existing?.preview || '',
          unread: Number.isFinite(chat.unread) ? Math.max(0, Math.floor(chat.unread)) : 0,
          isGroup: chat.isGroup === true || existing?.isGroup === true,
          timeLabel: normalizeText(chat.timeLabel) || existing?.timeLabel || '',
          muted: chat.muted === true,
          pinned: chat.pinned === true,
          lastSeenAt: now,
          firstSeenAt: existing?.firstSeenAt ?? now,
          inboxOrder: Number.isFinite(chat.inboxOrder) ? chat.inboxOrder : null
        };
        if (!draft.cards[id]) {
          draft.cards[id] = {
            columnId: firstColumn,
            order: tail,
            tagIds: [],
            note: '',
            createdAt: now,
            updatedAt: now
          };
          tail += 1;
        }
      }
      // contatos que sairam do viewport continuam no board (lista virtualizada)
    });
  }

  function moveCard(contactId, columnId, index = 0) {
    return apply((draft) => {
      const card = draft.cards[contactId];
      if (!card) return;
      const target = draft.columns.find((c) => c.id === columnId)?.id || draft.columns[0].id;
      const sourceIds = idsInColumn(draft, card.columnId).filter((id) => id !== contactId);
      const targetIds = idsInColumn(draft, target).filter((id) => id !== contactId);
      card.columnId = target;
      card.updatedAt = Date.now();
      targetIds.splice(clamp(index, 0, targetIds.length), 0, contactId);
      renumber(draft, targetIds);
      renumber(draft, sourceIds);
    });
  }

  function reorderCard(contactId, index = 0) {
    return apply((draft) => {
      const card = draft.cards[contactId];
      if (!card) return;
      const ids = idsInColumn(draft, card.columnId).filter((id) => id !== contactId);
      ids.splice(clamp(index, 0, ids.length), 0, contactId);
      renumber(draft, ids);
      card.updatedAt = Date.now();
    });
  }

  function setCardTags(contactId, tagIds) {
    return apply((draft) => {
      const card = draft.cards[contactId];
      if (!card) return;
      const known = new Set(draft.tags.map((t) => t.id));
      card.tagIds = [...new Set((tagIds || []).map(normalizeText).filter((t) => known.has(t)))];
      card.updatedAt = Date.now();
    });
  }

  function setNote(contactId, text) {
    return apply((draft) => {
      const card = draft.cards[contactId];
      if (!card) return;
      card.note = typeof text === 'string' ? text : '';
      card.updatedAt = Date.now();
    });
  }

  /**
   * Move varios cards para o fim de uma coluna em UMA escrita (roadmap §4).
   * A ordem passada e preservada dentro do destino.
   */
  function moveCards(ids, columnId) {
    const wanted = [...new Set(ids || [])].filter(Boolean);
    if (!wanted.length) return Promise.resolve(state);
    return apply((draft) => {
      const moving = wanted.filter((id) => draft.cards[id]);
      if (!moving.length) return;
      const set = new Set(moving);
      const target = draft.columns.find((c) => c.id === columnId)?.id || draft.columns[0].id;
      // listas das colunas de origem calculadas ANTES de mexer no columnId
      const sources = new Map();
      for (const id of moving) {
        const from = draft.cards[id].columnId;
        if (from === target || sources.has(from)) continue;
        sources.set(from, idsInColumn(draft, from).filter((cid) => !set.has(cid)));
      }
      const targetIds = idsInColumn(draft, target).filter((cid) => !set.has(cid));
      const now = Date.now();
      for (const id of moving) {
        draft.cards[id].columnId = target;
        draft.cards[id].updatedAt = now;
        targetIds.push(id);
      }
      renumber(draft, targetIds);
      for (const [, remaining] of sources) renumber(draft, remaining);
    });
  }

  /** Aplica/remove uma tag em varios cards em UMA escrita. */
  function setTagOnCards(ids, tagId, on) {
    const wanted = [...new Set(ids || [])].filter(Boolean);
    if (!wanted.length || !tagId) return Promise.resolve(state);
    return apply((draft) => {
      if (!draft.tags.some((t) => t.id === tagId)) return;
      const now = Date.now();
      for (const id of wanted) {
        const card = draft.cards[id];
        if (!card) continue;
        const has = card.tagIds.includes(tagId);
        if (on && !has) {
          card.tagIds = [...card.tagIds, tagId];
          card.updatedAt = now;
        } else if (!on && has) {
          card.tagIds = card.tagIds.filter((t) => t !== tagId);
          card.updatedAt = now;
        }
      }
    });
  }

  const addTagToCards = (ids, tagId) => setTagOnCards(ids, tagId, true);
  const removeTagFromCards = (ids, tagId) => setTagOnCards(ids, tagId, false);

  /**
   * Arquivamento do KanZapp: tira o card do funil sem apagar nada.
   * Aceita um id ou uma lista — o lote e UMA escrita so (roadmap §4/§7).
   * @param {string|string[]} idOrIds
   * @param {boolean} archived
   */
  function setArchived(idOrIds, archived = true) {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    const wanted = archived !== false;
    return apply((draft) => {
      const now = Date.now();
      for (const id of new Set(ids)) {
        const card = draft.cards[id];
        if (!card || card.archived === wanted) continue;
        card.archived = wanted;
        card.archivedAt = wanted ? now : 0;
        card.updatedAt = now;
      }
    });
  }

  function addColumn(title) {
    return apply((draft) => {
      const id = nextId('col');
      draft.columns.push({
        id,
        title: normalizeText(title) || 'Nova coluna',
        color: COLUMN_PALETTE[draft.columns.length % COLUMN_PALETTE.length],
        wipLimit: null,
        collapsed: false
      });
    });
  }

  function renameColumn(id, title) {
    return apply((draft) => {
      const column = draft.columns.find((c) => c.id === id);
      if (column) column.title = normalizeText(title) || column.title;
    });
  }

  function setColumnColor(id, color) {
    return apply((draft) => {
      const column = draft.columns.find((c) => c.id === id);
      if (column) column.color = normalizeText(color) || column.color;
    });
  }

  function setColumnWipLimit(id, limit) {
    return apply((draft) => {
      const column = draft.columns.find((c) => c.id === id);
      if (!column) return;
      const value = Number(limit);
      column.wipLimit = Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
    });
  }

  function setColumnCollapsed(id, collapsed) {
    return apply((draft) => {
      const column = draft.columns.find((c) => c.id === id);
      if (column) column.collapsed = collapsed === true;
    });
  }

  function removeColumn(id) {
    return apply((draft) => {
      if (draft.columns.length <= 1) return; // sempre resta uma coluna
      const index = draft.columns.findIndex((c) => c.id === id);
      if (index === -1) return;
      draft.columns.splice(index, 1);
      const fallback = draft.columns[0].id;
      const orphans = Object.keys(draft.cards).filter((cid) => draft.cards[cid].columnId === id);
      const target = idsInColumn(draft, fallback);
      for (const cid of orphans) {
        draft.cards[cid].columnId = fallback;
        target.push(cid);
      }
      renumber(draft, target);
    });
  }

  function reorderColumns(ids) {
    return apply((draft) => {
      const byId = new Map(draft.columns.map((c) => [c.id, c]));
      const ordered = [];
      for (const id of ids || []) {
        const column = byId.get(id);
        if (column && !ordered.includes(column)) ordered.push(column);
      }
      for (const column of draft.columns) if (!ordered.includes(column)) ordered.push(column);
      draft.columns = ordered;
    });
  }

  function addTag(tag) {
    return apply((draft) => {
      const id = normalizeText(tag?.id) || nextId('tag');
      if (draft.tags.some((t) => t.id === id)) return;
      draft.tags.push({
        id,
        name: normalizeText(tag?.name) || 'Nova tag',
        color: normalizeText(tag?.color) || TAG_PALETTE[draft.tags.length % TAG_PALETTE.length],
        description: normalizeText(tag?.description)
      });
    });
  }

  function updateTag(id, patch) {
    return apply((draft) => {
      const tag = draft.tags.find((t) => t.id === id);
      if (!tag) return;
      if (patch?.name !== undefined) tag.name = normalizeText(patch.name) || tag.name;
      if (patch?.color !== undefined) tag.color = normalizeText(patch.color) || tag.color;
      if (patch?.description !== undefined) tag.description = normalizeText(patch.description);
    });
  }

  function removeTag(id) {
    return apply((draft) => {
      draft.tags = draft.tags.filter((t) => t.id !== id);
      for (const card of Object.values(draft.cards)) {
        if (card.tagIds.includes(id)) card.tagIds = card.tagIds.filter((t) => t !== id);
      }
    });
  }

  function addTemplate(template) {
    return apply((draft) => {
      const id = normalizeText(template?.id) || nextId('tpl');
      if (draft.templates.some((t) => t.id === id)) return;
      draft.templates.push({
        id,
        title: normalizeText(template?.title) || 'Nova mensagem',
        text: typeof template?.text === 'string' ? template.text : '',
        shortcut: normalizeText(template?.shortcut)
      });
    });
  }

  function updateTemplate(id, patch) {
    return apply((draft) => {
      const tpl = draft.templates.find((t) => t.id === id);
      if (!tpl) return;
      if (patch?.title !== undefined) tpl.title = normalizeText(patch.title) || tpl.title;
      if (patch?.text !== undefined) tpl.text = typeof patch.text === 'string' ? patch.text : tpl.text;
      if (patch?.shortcut !== undefined) tpl.shortcut = normalizeText(patch.shortcut);
    });
  }

  function removeTemplate(id) {
    return apply((draft) => {
      draft.templates = draft.templates.filter((t) => t.id !== id);
    });
  }

  function setFollowup(contactId, data) {
    return apply((draft) => {
      const timestamp = Number(data?.timestamp);
      if (!Number.isFinite(timestamp)) return;
      draft.followups[contactId] = {
        contactId,
        contactName:
          normalizeText(data?.contactName) || draft.contacts[contactId]?.name || '',
        title: normalizeText(data?.title) || 'Lembrete',
        timestamp,
        done: data?.done === true
      };
    });
  }

  function clearFollowup(contactId) {
    return apply((draft) => {
      delete draft.followups[contactId];
    });
  }

  function updateSettings(patch) {
    return apply((draft) => {
      draft.settings = { ...draft.settings, ...(patch || {}) };
    });
  }

  function exportJSON() {
    return JSON.stringify({ ...deepClone(state), exportedAt: Date.now() }, null, 2);
  }

  async function importJSON(json, { merge = false } = {}) {
    let candidate = json;
    if (typeof json === 'string') {
      try {
        candidate = JSON.parse(json);
      } catch {
        return { ok: false, errors: ['JSON inválido.'] };
      }
    }
    const check = validateState(candidate, { complete: !merge });
    if (!check.ok) return { ok: false, errors: check.errors };

    await apply((draft) => {
      // `candidate` pode ser um estado v2 ou um dump das chaves v1. Passa o
      // mesmo objeto nos dois canais: campos v2 continuam autoritativos e as
      // chaves legadas sao aproveitadas quando presentes.
      const incoming = migrate(candidate, candidate);
      if (!merge) {
        draft.columns = incoming.columns;
        draft.tags = incoming.tags;
        draft.templates = incoming.templates;
        draft.contacts = incoming.contacts;
        draft.cards = incoming.cards;
        draft.followups = incoming.followups;
        draft.settings = incoming.settings;
        return;
      }
      const columnIds = new Set(draft.columns.map((c) => c.id));
      for (const column of incoming.columns) {
        if (!columnIds.has(column.id)) draft.columns.push(column);
      }
      const tagIds = new Set(draft.tags.map((t) => t.id));
      for (const tag of incoming.tags) if (!tagIds.has(tag.id)) draft.tags.push(tag);
      const tplIds = new Set(draft.templates.map((t) => t.id));
      for (const tpl of incoming.templates) if (!tplIds.has(tpl.id)) draft.templates.push(tpl);
      for (const [id, contact] of Object.entries(incoming.contacts)) {
        draft.contacts[id] = { ...contact, ...(draft.contacts[id] || {}) };
      }
      for (const [id, card] of Object.entries(incoming.cards)) {
        if (!draft.cards[id]) draft.cards[id] = card;
      }
      for (const [id, fu] of Object.entries(incoming.followups)) {
        if (!draft.followups[id]) draft.followups[id] = fu;
      }
    });
    return { ok: true, errors: [] };
  }

  /** Apaga as chaves da v1 (backup) — acao explicita do usuario. */
  async function clearLegacyBackup() {
    await driver.removeRaw([...LEGACY_KEYS]);
    return true;
  }

  const actions = {
    syncContacts,
    moveCard,
    reorderCard,
    setCardTags,
    setNote,
    setArchived,
    moveCards,
    addTagToCards,
    removeTagFromCards,
    addColumn,
    renameColumn,
    setColumnColor,
    setColumnWipLimit,
    setColumnCollapsed,
    removeColumn,
    reorderColumns,
    addTag,
    updateTag,
    removeTag,
    addTemplate,
    updateTemplate,
    removeTemplate,
    setFollowup,
    clearFollowup,
    updateSettings,
    exportJSON,
    importJSON,
    clearLegacyBackup
  };

  return {
    ready,
    getState,
    subscribe,
    destroy,
    actions,
    select,
    get driver() {
      return driver;
    }
  };
}

// --- seletores puros (usaveis sem instancia) --------------------------------

function tagsOf(state, card) {
  if (!card?.tagIds?.length) return [];
  return state.tags.filter((t) => card.tagIds.includes(t.id));
}

/**
 * @returns {Record<string, Array<{id, contact, card, tags, followup}>>}
 */
function cardsByColumn(state, filters = {}) {
  const query = parseSearchQuery(filters.search || '');
  const tagFilter = Array.isArray(filters.tagIds)
    ? filters.tagIds.filter(Boolean)
    : filters.tagId
      ? [filters.tagId]
      : [];
  const onlyUnread = filters.onlyUnread ?? state.settings.onlyUnread === true;
  const hideGroups = filters.hideGroups ?? state.settings.hideGroups === true;
  const showArchived = filters.showArchived ?? state.settings.showArchived === true;
  const sort = filters.sort || state.settings.sort || 'inbox';

  const out = {};
  const titleById = {};
  for (const column of state.columns) {
    out[column.id] = [];
    titleById[column.id] = column.title;
  }
  const fallback = state.columns[0]?.id;

  for (const [id, card] of Object.entries(state.cards)) {
    const contact = state.contacts[id];
    if (!contact) continue;
    // filtros de EXIBICAO: nada e apagado, desligar o filtro devolve os cards
    if (card.archived === true && !showArchived) continue;
    if (hideGroups && contact.isGroup === true) continue;
    if (onlyUnread && !(contact.unread > 0)) continue;
    if (tagFilter.length && !tagFilter.every((t) => card.tagIds.includes(t))) continue;
    const bucket = out[card.columnId] ? card.columnId : fallback;
    if (!bucket) continue;
    const tags = tagsOf(state, card);
    // busca sobre nome, prévia, NOTA e TAGS, com os prefixos tag:/nota:/coluna:
    if (!query.isEmpty && !matchesSearchQuery(query, {
      name: contact.name,
      preview: contact.preview,
      note: card.note,
      tags,
      column: titleById[bucket]
    })) continue;
    out[bucket].push({
      id,
      contact,
      card,
      tags,
      followup: state.followups[id] || null
    });
  }

  const comparators = {
    manual: (a, b) => (a.card.order ?? 0) - (b.card.order ?? 0),
    name: (a, b) => a.contact.name.localeCompare(b.contact.name, 'pt-BR'),
    recent: (a, b) => (b.contact.lastSeenAt ?? 0) - (a.contact.lastSeenAt ?? 0),
    inbox: (a, b) => {
      const ai = Number.isFinite(a.contact.inboxOrder) ? a.contact.inboxOrder : Infinity;
      const bi = Number.isFinite(b.contact.inboxOrder) ? b.contact.inboxOrder : Infinity;
      if (ai !== bi) return ai - bi;
      return (a.card.order ?? 0) - (b.card.order ?? 0);
    }
  };
  const cmp = comparators[sort] || comparators.inbox;
  for (const key of Object.keys(out)) out[key].sort(cmp);
  return out;
}

/**
 * Ids de cards sem atividade ha mais de `days` dias — insumo do utilitario
 * MANUAL de arquivamento (§7). E so uma consulta: quem arquiva e o usuario,
 * depois de ver a contagem e confirmar. Nada aqui apaga dado.
 * @returns {string[]}
 */
function inactiveCards(state, days = 90, { includeArchived = false, now = Date.now() } = {}) {
  const span = Math.max(1, Number(days) || 90) * 86400000;
  const limit = now - span;
  const out = [];
  for (const [id, card] of Object.entries(state.cards || {})) {
    const contact = (state.contacts || {})[id];
    if (!card || !contact) continue;
    if (!includeArchived && card.archived === true) continue;
    const last = Math.max(Number(contact.lastSeenAt) || 0, Number(card.updatedAt) || 0);
    if (last > 0 && last < limit) out.push(id);
  }
  return out;
}

/** Contatos que nao apareceram na ultima sincronizacao da lista lateral. */
function contactsMissingFromInbox(state) {
  const values = Object.values(state.contacts);
  if (values.length === 0) return [];
  const latest = values.reduce((max, c) => Math.max(max, c.lastSeenAt || 0), 0);
  if (!latest) return [];
  return values.filter((c) => (c.lastSeenAt || 0) < latest - 1500);
}

function stats(state) {
  const now = Date.now();
  const byColumn = {};
  for (const column of state.columns) byColumn[column.id] = 0;
  let archived = 0;
  for (const card of Object.values(state.cards)) {
    if (card.archived === true) {
      archived += 1;
      continue; // arquivados contam a parte, nao inflam a coluna
    }
    if (byColumn[card.columnId] !== undefined) byColumn[card.columnId] += 1;
  }
  const followups = Object.values(state.followups);
  const total = Object.keys(state.cards).length;
  return {
    contacts: Object.keys(state.contacts).length,
    cards: total,
    activeCards: total - archived,
    archived,
    tags: state.tags.length,
    templates: state.templates.length,
    byColumn,
    unread: Object.values(state.contacts).reduce((sum, c) => sum + (c.unread || 0), 0),
    withNote: Object.values(state.cards).filter((c) => c.note).length,
    followupsPending: followups.filter((f) => !f.done).length,
    followupsOverdue: followups.filter((f) => !f.done && f.timestamp <= now).length
  };
}

export const select = { cardsByColumn, contactsMissingFromInbox, inactiveCards, stats, tagsOf };

export { migrate, validateState };
