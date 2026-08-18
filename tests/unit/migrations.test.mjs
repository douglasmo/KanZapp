import { describe, it, expect } from '../run.mjs';
import { migrate, mapLegacyId, validateState, hasLegacyData } from '../../src/core/migrations.js';
import { SCHEMA_VERSION } from '../../src/core/constants.js';
import { nameIdFor } from '../../src/core/utils.js';

const JID = '5511999998888@c.us';
const GROUP = '120363000000000000@g.us';
const NOME = 'Maria Fernanda';
const NOME_ID = nameIdFor(NOME);
const NOW = 1_700_000_000_000;

function legacyCompleto() {
  return {
    kanbanColumns: [
      { id: 'todo', title: 'Entrada' },
      { id: 'doing', title: 'Em atendimento' },
      { id: 'done', title: 'Concluido' }
    ],
    kanbanTags: [
      { id: 'tag_1', name: 'VIP', color: '#ff0000', description: 'Cliente importante' },
      { id: 'tag_2', name: 'Frio', color: '#0000ff' }
    ],
    kanbanMessages: [{ id: 'msg_1', title: 'Saudação', text: 'Olá! Tudo bem?' }],
    kanbanData: { [JID]: 'doing', [NOME]: 'done', [GROUP]: 'todo' },
    contactTags: { [JID]: ['tag_1'], [NOME]: ['tag_2', 'tag_inexistente'] },
    contactNotes: { [JID]: 'Prefere ligação de manhã.' },
    followups: {
      [JID]: { contactId: JID, contactName: 'João', title: 'Retornar orçamento', timestamp: NOW + 86400000 },
      [NOME]: { contactId: NOME, contactName: NOME, title: 'Ligar', timestamp: NOW - 1000 }
    },
    allConversations: {
      [JID]: { id: JID, name: 'João', lastMsg: 'Oi', unreadCount: 2, avatarUrl: 'blob:x', scrapedAt: NOW - 5000 },
      [NOME]: { id: NOME, name: NOME, lastMsg: 'Fechado!', unreadCount: 0, scrapedAt: NOW - 9000 },
      [GROUP]: { id: GROUP, name: 'Equipe Vendas', lastMsg: 'ok', unreadCount: 7, scrapedAt: NOW - 1000 }
    },
    inboxConversations: {
      [JID]: { id: JID, name: 'João', lastMsg: 'Oi de novo', unreadCount: 3, inboxOrder: 0, scrapedAt: NOW }
    }
  };
}

describe('migrations/v1 completo', () => {
  const state = migrate(null, legacyCompleto(), { now: NOW });

  it('produz um estado v2 válido', () => {
    expect(state.version).toBe(SCHEMA_VERSION);
    expect(Array.isArray(state.columns)).toBeTruthy();
    expect(state.columns).toHaveLength(3);
  });

  it('kanbanColumns → columns com color/wipLimit/collapsed', () => {
    const first = state.columns[0];
    expect(first.id).toBe('todo');
    expect(typeof first.color).toBe('string');
    expect(first.wipLimit).toBeNull();
    expect(first.collapsed).toBe(false);
  });

  it('kanbanTags → tags (mantém descrição)', () => {
    expect(state.tags).toHaveLength(2);
    expect(state.tags[0].description).toBe('Cliente importante');
  });

  it('kanbanMessages → templates', () => {
    expect(state.templates).toHaveLength(1);
    expect(state.templates[0].text).toBe('Olá! Tudo bem?');
  });

  it('conversas → contacts, com jid preservado', () => {
    expect(state.contacts[JID].name).toBe('João');
    expect(state.contacts[JID].idKind).toBe('jid');
    expect(state.contacts[GROUP].isGroup).toBe(true);
  });

  it('id da v1 baseado em nome vira name:<hash> (senão o CRM ficaria órfão)', () => {
    expect(state.contacts[NOME_ID]).toBeTruthy();
    expect(state.contacts[NOME_ID].name).toBe(NOME);
    expect(state.contacts[NOME_ID].idKind).toBe('name');
    expect(state.contacts[NOME]).toBeUndefined();
  });

  it('kanbanData → cards[].columnId', () => {
    expect(state.cards[JID].columnId).toBe('doing');
    expect(state.cards[NOME_ID].columnId).toBe('done');
  });

  it('contactTags → cards[].tagIds, descartando tag inexistente', () => {
    expect(state.cards[JID].tagIds).toEqual(['tag_1']);
    expect(state.cards[NOME_ID].tagIds).toEqual(['tag_2']);
  });

  it('contactNotes → cards[].note', () => {
    expect(state.cards[JID].note).toBe('Prefere ligação de manhã.');
  });

  it('followups migrados com o id novo', () => {
    expect(state.followups[JID].title).toBe('Retornar orçamento');
    expect(state.followups[NOME_ID].contactId).toBe(NOME_ID);
    expect(state.followups[NOME_ID].done).toBe(false);
  });

  it('inboxConversations sobrescreve preview/unread mais recente', () => {
    expect(state.contacts[JID].unread).toBe(3);
  });

  it('todo card tem contato e todo contato tem card', () => {
    for (const id of Object.keys(state.cards)) expect(state.contacts[id]).toBeTruthy();
    for (const id of Object.keys(state.contacts)) expect(state.cards[id]).toBeTruthy();
  });

  it('order é inteiro denso por coluna', () => {
    const byColumn = {};
    for (const [id, card] of Object.entries(state.cards)) {
      (byColumn[card.columnId] ||= []).push(card.order);
    }
    for (const orders of Object.values(byColumn)) {
      const sorted = [...orders].sort((a, b) => a - b);
      expect(sorted).toEqual(sorted.map((_, i) => i));
    }
  });

  it('é idempotente: migrar de novo não muda nada', () => {
    const again = migrate(state, legacyCompleto(), { now: NOW });
    expect(again).toEqual(state);
    const terceira = migrate(again, {}, { now: NOW });
    expect(terceira).toEqual(state);
  });

  it('não perde nenhum contato conhecido', () => {
    expect(Object.keys(state.contacts)).toHaveLength(3);
  });
});

describe('migrations/v1 parcial', () => {
  it('correlaciona chaves por nome com o JID unico da mesma conversa', () => {
    const name = 'Ana Paula';
    const jid = '5511988887777@c.us';
    const state = migrate(null, {
      kanbanTags: [{ id: 'vip', name: 'VIP' }],
      allConversations: {
        [jid]: { id: jid, name, lastMsg: 'Oi', scrapedAt: NOW }
      },
      kanbanData: { [name]: 'done' },
      contactTags: { [name]: ['vip'] },
      contactNotes: { [name]: 'Prefere contato pela manhã.' },
      followups: {
        [name]: { contactId: name, contactName: name, title: 'Retornar', timestamp: NOW + 60000 }
      }
    }, { now: NOW });

    expect(Object.keys(state.contacts)).toEqual([jid]);
    expect(Object.keys(state.cards)).toEqual([jid]);
    expect(state.cards[jid].columnId).toBe('done');
    expect(state.cards[jid].note).toBe('Prefere contato pela manhã.');
    expect(state.cards[jid].tagIds).toEqual(['vip']);
    expect(state.followups[jid].contactId).toBe(jid);
  });

  it('só kanbanData: cria contatos e usa colunas padrão com alias', () => {
    const state = migrate(null, { kanbanData: { [JID]: 'doing', [NOME]: 'todo' } }, { now: NOW });
    expect(state.columns.length).toBeGreaterThanOrEqual(4);
    expect(state.cards[JID].columnId).toBe('doing');
    // 'todo' da v1 não existe na v2 → alias para a primeira coluna 'inbox'
    expect(state.cards[NOME_ID].columnId).toBe('inbox');
    expect(state.contacts[NOME_ID].name).toBe(NOME);
  });

  it('só tags e notas, sem conversas', () => {
    const state = migrate(
      null,
      { kanbanTags: [{ id: 't1', name: 'Novo' }], contactNotes: { [JID]: 'nota' } },
      { now: NOW }
    );
    expect(state.tags).toHaveLength(1);
    expect(state.cards[JID].note).toBe('nota');
    expect(state.contacts[JID]).toBeTruthy();
  });

  it('followup sem timestamp é descartado sem quebrar', () => {
    const state = migrate(null, { followups: { [JID]: { contactId: JID, title: 'x' } } }, { now: NOW });
    expect(Object.keys(state.followups)).toHaveLength(0);
  });
});

describe('migrations/estados de borda', () => {
  it('estado vazio devolve o padrão', () => {
    const state = migrate(null, {}, { now: NOW });
    expect(state.version).toBe(SCHEMA_VERSION);
    expect(state.columns).toHaveLength(4);
    expect(state.contacts).toEqual({});
    expect(state.cards).toEqual({});
    expect(state.settings.theme).toBe('auto');
  });

  it('undefined/lixo não quebra', () => {
    expect(migrate(undefined, undefined, { now: NOW }).version).toBe(SCHEMA_VERSION);
    expect(migrate(42, 'x', { now: NOW }).version).toBe(SCHEMA_VERSION);
  });

  it('v2 já migrado passa intacto', () => {
    const original = migrate(null, legacyCompleto(), { now: NOW });
    const again = migrate(original, {}, { now: NOW });
    expect(again).toEqual(original);
  });

  it('v2 com coluna removida reatribui os cards órfãos', () => {
    const original = migrate(null, legacyCompleto(), { now: NOW });
    const semDoing = { ...original, columns: original.columns.filter((c) => c.id !== 'doing') };
    const fixed = migrate(semDoing, {}, { now: NOW });
    expect(fixed.cards[JID].columnId).toBe(fixed.columns[0].id);
  });

  it('settings inválidos caem no padrão', () => {
    const state = migrate({ settings: { theme: 'roxo', refreshMs: 10, sort: 'x' } }, {}, { now: NOW });
    expect(state.settings.theme).toBe('auto');
    expect(state.settings.refreshMs).toBe(1000);
    expect(state.settings.sort).toBe('inbox');
  });
});

describe('migrations/helpers', () => {
  it('mapLegacyId reconhece jid embutido', () => {
    expect(mapLegacyId('true_5511999998888@c.us_3EB0').id).toBe(JID);
  });

  it('mapLegacyId devolve null para vazio', () => {
    expect(mapLegacyId('   ')).toBeNull();
  });

  it('hasLegacyData detecta presença real de dados', () => {
    expect(hasLegacyData({})).toBeFalsy();
    expect(hasLegacyData({ kanbanTags: [] })).toBeFalsy();
    expect(hasLegacyData({ kanbanTags: [{ id: 'x' }] })).toBeTruthy();
  });

  it('validateState recusa lixo e aceita estado bom', () => {
    expect(validateState(null).ok).toBeFalsy();
    expect(validateState({ hello: 'world' }).ok).toBeFalsy();
    expect(validateState({ version: 1 }).ok).toBeFalsy();
    expect(validateState({ version: 2 }).ok).toBeFalsy();
    expect(validateState({ version: 2, kanbanData: {} }, { complete: true }).ok).toBeFalsy();
    expect(validateState({ columns: 'x' }).ok).toBeFalsy();
    expect(validateState({ ...migrate(null, {}, { now: NOW }), columns: ['x'] }, { complete: true }).ok).toBeFalsy();
    expect(validateState({ version: 999 }).ok).toBeFalsy();
    expect(validateState({ kanbanData: { [JID]: 'doing' } }).ok).toBeTruthy();
    expect(validateState(migrate(null, {}, { now: NOW })).ok).toBeTruthy();
  });
});
