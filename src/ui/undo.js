/**
 * undo.js — pilha de desfazer/refazer da sessão.
 *
 * Mora na UI de propósito: desfazer é estado de sessão, não dado do usuário —
 * não persiste e não vai para o backup. Cada entrada guarda a operação inversa
 * E o estado esperado do alvo: se o card foi movido por outro caminho, ou
 * sumiu, a entrada é descartada com aviso em vez de ser aplicada às cegas.
 *
 * Toda aplicação passa por `store.actions`; nada aqui escreve estado direto.
 */

const DEFAULT_LIMIT = 25;

/** Comparação estável de listas de ids (ordem não importa). */
export function sameIdSet(a, b) {
  const left = [...new Set(a || [])].sort();
  const right = [...new Set(b || [])].sort();
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function validSide(side) {
  return Boolean(side && typeof side.run === 'function');
}

/**
 * @param {{limit?: number, logger?: object}} [options]
 */
export function createUndoStack(options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit > 0
    ? Math.floor(options.limit)
    : DEFAULT_LIMIT;
  const logger = options.logger || null;
  /** @type {Array<object>} */
  const undoable = [];
  /** @type {Array<object>} */
  const redoable = [];

  function push(entry) {
    if (!entry || !validSide(entry.undo) || !validSide(entry.redo)) {
      logger?.warn?.('[undo] entrada inválida ignorada', entry);
      return false;
    }
    undoable.push(entry);
    while (undoable.length > limit) undoable.shift();
    // uma ação nova invalida o futuro que existia
    redoable.length = 0;
    return true;
  }

  function verify(side, state) {
    if (typeof side.verify !== 'function') return true;
    try {
      return side.verify(state) !== false;
    } catch (error) {
      logger?.warn?.('[undo] verificação lançou; tratando como estado mudado', error);
      return false;
    }
  }

  /**
   * @param {Array} source pilha de origem
   * @param {Array} target pilha de destino
   * @param {'undo'|'redo'} side
   */
  async function apply(source, target, side, state, actions) {
    const entry = source[source.length - 1];
    if (!entry) return { ok: false, reason: 'vazio' };
    source.pop();
    const step = entry[side];
    if (!verify(step, state)) {
      // entrada obsoleta: descartada, nunca aplicada às cegas
      return { ok: false, reason: 'estado-mudou', label: entry.label || '' };
    }
    try {
      await step.run(actions);
    } catch (error) {
      logger?.warn?.('[undo] a operação inversa falhou', error);
      return { ok: false, reason: 'falhou', label: entry.label || '' };
    }
    target.push(entry);
    return { ok: true, reason: side, label: entry.label || '' };
  }

  return {
    push,
    canUndo: () => undoable.length > 0,
    canRedo: () => redoable.length > 0,
    peek: () => undoable[undoable.length - 1] || null,
    undo: (state, actions) => apply(undoable, redoable, 'undo', state, actions),
    redo: (state, actions) => apply(redoable, undoable, 'redo', state, actions),
    clear() {
      undoable.length = 0;
      redoable.length = 0;
    },
    size: () => ({ undo: undoable.length, redo: redoable.length })
  };
}

/* ------------------------------------------------------------------ *
 * Fábricas de entrada — o "estado esperado" de cada ação vive aqui.
 * ------------------------------------------------------------------ */

/** Move de volta N cards para as colunas/posições de origem. */
export function moveEntry(moves, label) {
  const list = (moves || []).filter((m) => m && m.contactId);
  const inColumn = (state, contactId, columnId) => {
    const card = state && state.cards && state.cards[contactId];
    return Boolean(card) && card.columnId === columnId;
  };
  return {
    label,
    undo: {
      verify: (state) => list.every((m) => inColumn(state, m.contactId, m.to)),
      run: async (actions) => {
        for (const m of list) await actions.moveCard(m.contactId, m.from, m.fromIndex ?? 0);
      }
    },
    redo: {
      verify: (state) => list.every((m) => inColumn(state, m.contactId, m.from)),
      run: async (actions) => {
        for (const m of list) await actions.moveCard(m.contactId, m.to, m.toIndex ?? 0);
      }
    }
  };
}

/** Restaura as tags exatas que cada card tinha antes da mudança. */
export function tagsEntry(changes, label) {
  const list = (changes || []).filter((c) => c && c.contactId);
  const hasTags = (state, contactId, tagIds) => {
    const card = state && state.cards && state.cards[contactId];
    return Boolean(card) && sameIdSet(card.tagIds, tagIds);
  };
  return {
    label,
    undo: {
      verify: (state) => list.every((c) => hasTags(state, c.contactId, c.after)),
      run: async (actions) => {
        for (const c of list) await actions.setCardTags(c.contactId, c.before);
      }
    },
    redo: {
      verify: (state) => list.every((c) => hasTags(state, c.contactId, c.before)),
      run: async (actions) => {
        for (const c of list) await actions.setCardTags(c.contactId, c.after);
      }
    }
  };
}

/**
 * Movimento em lote: uma entrada só, e o desfazer agrupa por coluna de origem
 * para continuar sendo poucas escritas (roadmap §4).
 */
export function bulkMoveEntry(moves, target, label) {
  const list = (moves || []).filter((m) => m && m.contactId);
  const ids = list.map((m) => m.contactId);
  const inColumn = (state, contactId, columnId) => {
    const card = state && state.cards && state.cards[contactId];
    return Boolean(card) && card.columnId === columnId;
  };
  const byOrigin = () => {
    const groups = new Map();
    for (const move of list) {
      if (!groups.has(move.from)) groups.set(move.from, []);
      groups.get(move.from).push(move.contactId);
    }
    return groups;
  };
  return {
    label,
    undo: {
      verify: (state) => list.every((m) => inColumn(state, m.contactId, target)),
      run: async (actions) => {
        for (const [from, group] of byOrigin()) {
          if (typeof actions.moveCards === 'function') await actions.moveCards(group, from);
          else for (const id of group) await actions.moveCard(id, from, 0);
        }
      }
    },
    redo: {
      verify: (state) => list.every((m) => inColumn(state, m.contactId, m.from)),
      run: async (actions) => {
        if (typeof actions.moveCards === 'function') return actions.moveCards(ids, target);
        for (const id of ids) await actions.moveCard(id, target, 0);
        return null;
      }
    }
  };
}

/**
 * Tag em lote. `ids` são só os cards que MUDARAM de fato — desfazer não pode
 * tirar uma tag de quem já a tinha antes da ação.
 */
export function bulkTagEntry(ids, tagId, applied, label) {
  const list = [...new Set(ids || [])];
  const hasTag = (state, contactId, expected) => {
    const card = state && state.cards && state.cards[contactId];
    return Boolean(card) && (card.tagIds || []).includes(tagId) === expected;
  };
  const call = (actions, add) => (add
    ? actions.addTagToCards(list, tagId)
    : actions.removeTagFromCards(list, tagId));
  return {
    label,
    undo: {
      verify: (state) => list.every((id) => hasTag(state, id, applied)),
      run: (actions) => call(actions, !applied)
    },
    redo: {
      verify: (state) => list.every((id) => hasTag(state, id, !applied)),
      run: (actions) => call(actions, applied)
    }
  };
}

/** Arquivar/desarquivar é reversível por definição: nada é apagado. */
export function archiveEntry(ids, archived, label) {
  const list = [...new Set(ids || [])];
  const isArchived = (state, contactId, value) => {
    const card = state && state.cards && state.cards[contactId];
    return Boolean(card) && (card.archived === true) === value;
  };
  return {
    label,
    undo: {
      verify: (state) => list.every((id) => isArchived(state, id, archived)),
      run: (actions) => actions.setArchived(list, !archived)
    },
    redo: {
      verify: (state) => list.every((id) => isArchived(state, id, !archived)),
      run: (actions) => actions.setArchived(list, archived)
    }
  };
}
