import { describe, it, expect } from '../run.mjs';
import { createUndoStack, moveEntry, tagsEntry, archiveEntry, sameIdSet } from '../../src/ui/undo.js';

/** Store mínimo: só cards, que é o que as entradas verificam. */
function fakeStore(cards) {
  const state = { cards: JSON.parse(JSON.stringify(cards)) };
  const chamadas = [];
  const actions = {
    async moveCard(id, columnId, index) {
      chamadas.push(['moveCard', id, columnId, index]);
      if (state.cards[id]) state.cards[id].columnId = columnId;
    },
    async setCardTags(id, tagIds) {
      chamadas.push(['setCardTags', id, [...tagIds]]);
      if (state.cards[id]) state.cards[id].tagIds = [...tagIds];
    },
    async setArchived(ids, value) {
      chamadas.push(['setArchived', [...ids], value]);
      for (const id of ids) if (state.cards[id]) state.cards[id].archived = value;
    }
  };
  return { state, actions, chamadas };
}

describe('undo/pilha', () => {
  const entrada = (marca, efeito) => ({
    label: marca,
    undo: { run: () => efeito.push(`undo:${marca}`) },
    redo: { run: () => efeito.push(`redo:${marca}`) }
  });

  it('desfaz na ordem inversa e refaz na ordem direta', async () => {
    const efeito = [];
    const pilha = createUndoStack();
    pilha.push(entrada('a', efeito));
    pilha.push(entrada('b', efeito));

    expect((await pilha.undo({}, {})).label).toBe('b');
    expect((await pilha.undo({}, {})).label).toBe('a');
    expect(efeito).toEqual(['undo:b', 'undo:a']);
    expect(pilha.canUndo()).toBe(false);

    expect((await pilha.redo({}, {})).label).toBe('a');
    expect((await pilha.redo({}, {})).label).toBe('b');
    expect(efeito).toEqual(['undo:b', 'undo:a', 'redo:a', 'redo:b']);
  });

  it('pilha vazia devolve motivo em vez de quebrar', async () => {
    const pilha = createUndoStack();
    expect(await pilha.undo({}, {})).toEqual({ ok: false, reason: 'vazio' });
    expect(await pilha.redo({}, {})).toEqual({ ok: false, reason: 'vazio' });
  });

  it('guarda no máximo 25 entradas', () => {
    const efeito = [];
    const pilha = createUndoStack();
    for (let i = 0; i < 40; i += 1) pilha.push(entrada(`e${i}`, efeito));
    expect(pilha.size().undo).toBe(25);
    expect(pilha.peek().label).toBe('e39');
  });

  it('ação nova apaga o futuro', async () => {
    const efeito = [];
    const pilha = createUndoStack();
    pilha.push(entrada('a', efeito));
    await pilha.undo({}, {});
    expect(pilha.canRedo()).toBe(true);
    pilha.push(entrada('b', efeito));
    expect(pilha.canRedo()).toBe(false);
  });

  it('entrada inválida é recusada', () => {
    const pilha = createUndoStack();
    expect(pilha.push(null)).toBe(false);
    expect(pilha.push({ label: 'x' })).toBe(false);
    expect(pilha.canUndo()).toBe(false);
  });

  it('operação inversa que lança vira "falhou" sem travar a pilha', async () => {
    const pilha = createUndoStack();
    pilha.push({
      label: 'ruim',
      undo: { run: () => { throw new Error('boom'); } },
      redo: { run: () => {} }
    });
    const r = await pilha.undo({}, {});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('falhou');
    expect(pilha.canUndo()).toBe(false);
  });
});

describe('undo/entradas de card', () => {
  it('moveEntry devolve o card para a coluna de origem', async () => {
    const loja = fakeStore({ 'a@c.us': { columnId: 'nego', tagIds: [] } });
    const pilha = createUndoStack();
    pilha.push(moveEntry([{ contactId: 'a@c.us', from: 'todo', to: 'nego', fromIndex: 2, toIndex: 0 }], 'Mover Ana'));

    const r = await pilha.undo(loja.state, loja.actions);
    expect(r.ok).toBe(true);
    expect(loja.state.cards['a@c.us'].columnId).toBe('todo');
    expect(loja.chamadas[0]).toEqual(['moveCard', 'a@c.us', 'todo', 2]);

    await pilha.redo(loja.state, loja.actions);
    expect(loja.state.cards['a@c.us'].columnId).toBe('nego');
  });

  // Regra do roadmap: nada de aplicar às cegas quando o alvo mudou.
  it('card movido por outro caminho não é desfeito às cegas', async () => {
    const loja = fakeStore({ 'a@c.us': { columnId: 'done', tagIds: [] } });
    const pilha = createUndoStack();
    pilha.push(moveEntry([{ contactId: 'a@c.us', from: 'todo', to: 'nego' }], 'Mover Ana'));

    const r = await pilha.undo(loja.state, loja.actions);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('estado-mudou');
    expect(loja.chamadas).toHaveLength(0, 'nenhuma escrita pode ter acontecido');
    expect(pilha.canUndo()).toBe(false, 'a entrada obsoleta é descartada');
  });

  it('card que sumiu do store não é desfeito', async () => {
    const loja = fakeStore({});
    const pilha = createUndoStack();
    pilha.push(moveEntry([{ contactId: 'sumiu@c.us', from: 'todo', to: 'nego' }], 'Mover'));
    expect((await pilha.undo(loja.state, loja.actions)).reason).toBe('estado-mudou');
  });

  it('tagsEntry restaura exatamente as tags anteriores', async () => {
    const loja = fakeStore({ 'a@c.us': { columnId: 'todo', tagIds: ['vip', 'frio'] } });
    const pilha = createUndoStack();
    pilha.push(tagsEntry([{ contactId: 'a@c.us', before: ['vip'], after: ['vip', 'frio'] }], 'Tags'));

    await pilha.undo(loja.state, loja.actions);
    expect(loja.state.cards['a@c.us'].tagIds).toEqual(['vip']);
    await pilha.redo(loja.state, loja.actions);
    expect(sameIdSet(loja.state.cards['a@c.us'].tagIds, ['frio', 'vip'])).toBe(true);
  });

  it('tags mexidas por fora invalidam a entrada', async () => {
    const loja = fakeStore({ 'a@c.us': { columnId: 'todo', tagIds: ['outra'] } });
    const pilha = createUndoStack();
    pilha.push(tagsEntry([{ contactId: 'a@c.us', before: ['vip'], after: ['vip', 'frio'] }], 'Tags'));
    expect((await pilha.undo(loja.state, loja.actions)).reason).toBe('estado-mudou');
    expect(loja.chamadas).toHaveLength(0);
  });

  it('archiveEntry desfaz em lote com uma escrita só', async () => {
    const loja = fakeStore({
      'a@c.us': { columnId: 'todo', tagIds: [], archived: true },
      'b@c.us': { columnId: 'todo', tagIds: [], archived: true }
    });
    const pilha = createUndoStack();
    pilha.push(archiveEntry(['a@c.us', 'b@c.us'], true, 'Arquivar 2'));

    const r = await pilha.undo(loja.state, loja.actions);
    expect(r.ok).toBe(true);
    expect(loja.chamadas).toHaveLength(1, 'lote é uma única mutação');
    expect(loja.state.cards['a@c.us'].archived).toBe(false);
    expect(loja.state.cards['b@c.us'].archived).toBe(false);
  });

  it('sameIdSet ignora ordem e duplicidade', () => {
    expect(sameIdSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameIdSet(['a', 'a'], ['a'])).toBe(true);
    expect(sameIdSet(['a'], ['a', 'b'])).toBe(false);
    expect(sameIdSet(null, [])).toBe(true);
  });
});
