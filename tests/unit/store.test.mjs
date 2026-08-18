import { describe, it, expect } from '../run.mjs';
import { installChromeStub } from '../chrome-stub.mjs';
import { createStore, select } from '../../src/core/store.js';
import { STORAGE_KEY, defaultState } from '../../src/core/constants.js';
import { nameIdFor } from '../../src/core/utils.js';

function chat(id, name, extra = {}) {
  return {
    id,
    idKind: id.includes('@') ? 'jid' : id.startsWith('name:') ? 'name' : 'dom',
    name,
    avatarUrl: '',
    preview: 'oi',
    unread: 0,
    isGroup: false,
    muted: false,
    pinned: false,
    timeLabel: '10:00',
    ...extra
  };
}

async function novoStore(initial = {}, latency = 0) {
  const stub = installChromeStub({ initial, latency });
  const store = createStore({});
  await store.ready();
  return { stub, store, done: () => stub.uninstall() };
}

describe('store/ciclo de vida', () => {
  it('ready carrega o padrão quando não há nada', async () => {
    const { store, done } = await novoStore();
    const state = store.getState();
    expect(state.version).toBe(2);
    expect(state.columns).toHaveLength(4);
    expect(Object.isFrozen(state)).toBeTruthy();
    done();
  });

  it('migra dados v1 na primeira carga', async () => {
    const { store, done } = await novoStore({
      kanbanTags: [{ id: 't1', name: 'VIP', color: '#f00' }],
      kanbanData: { '5511@c.us': 'doing' }
    });
    const state = store.getState();
    expect(state.tags).toHaveLength(1);
    expect(state.cards['5511@c.us'].columnId).toBe('doing');
    done();
  });

  it('não apaga as chaves da v1 (ficam como backup)', async () => {
    const { stub, done } = await novoStore({ kanbanTags: [{ id: 't1', name: 'VIP' }] });
    expect(stub.snapshot().kanbanTags).toBeTruthy();
    done();
  });

  it('subscribe recebe cada mutação e o unsubscribe funciona', async () => {
    const { store, done } = await novoStore();
    let hits = 0;
    const off = store.subscribe(() => {
      hits += 1;
    });
    await store.actions.addColumn('Extra');
    expect(hits).toBe(1);
    off();
    await store.actions.addColumn('Outra');
    expect(hits).toBe(1);
    done();
  });
});

describe('store/syncContacts', () => {
  it('cria contato e card na primeira coluna', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana'), chat('2@c.us', 'Bruno')]);
    const state = store.getState();
    expect(Object.keys(state.contacts)).toHaveLength(2);
    expect(state.cards['1@c.us'].columnId).toBe('inbox');
    expect(state.cards['1@c.us'].order).toBe(0);
    expect(state.cards['2@c.us'].order).toBe(1);
    done();
  });

  it('não apaga contatos que sumiram da inbox (lista virtualizada)', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana'), chat('2@c.us', 'Bruno')]);
    await store.actions.syncContacts([chat('1@c.us', 'Ana')]);
    const state = store.getState();
    expect(Object.keys(state.contacts)).toHaveLength(2);
    expect(state.contacts['2@c.us']).toBeTruthy();
    done();
  });

  /**
   * A garantia mais importante do produto: no dia em que o WhatsApp mudar de
   * layout e o adapter ficar mudo, o usuário não pode abrir o quadro e achar o
   * CRM vazio. Nada de apagar o que não veio na leitura.
   */
  it('adapter mudo (0 conversas) não esvazia nada, nem repetido', async () => {
    const { store, done } = await novoStore();
    const lote = [];
    for (let i = 0; i < 50; i += 1) lote.push(chat(`${i}@c.us`, `Contato ${i}`));
    await store.actions.syncContacts(lote);
    await store.actions.addTag({ id: 'tg', name: 'VIP' });
    await store.actions.setCardTags('7@c.us', ['tg']);
    await store.actions.setNote('7@c.us', 'combinado para segunda');
    await store.actions.moveCard('7@c.us', 'deal', 0);
    await store.actions.setFollowup('9@c.us', { title: 'Ligar', timestamp: Date.now() + 3600000 });
    await store.actions.addColumn('Proposta');
    const antes = store.getState();

    await store.actions.syncContacts([]);
    await store.actions.syncContacts([]);
    const depois = store.getState();

    expect(Object.keys(depois.contacts)).toHaveLength(50);
    expect(Object.keys(depois.cards)).toHaveLength(50);
    expect(depois.columns).toHaveLength(antes.columns.length);
    expect(depois.tags).toHaveLength(1);
    expect(depois.cards['7@c.us'].note).toBe('combinado para segunda');
    expect(depois.cards['7@c.us'].tagIds).toEqual(['tg']);
    expect(depois.cards['7@c.us'].columnId).toBe('deal');
    expect(depois.followups['9@c.us'].title).toBe('Ligar');
    done();
  });

  it('leitura parcial (3 de 50) mantém os 47 ausentes intactos', async () => {
    const { store, done } = await novoStore();
    const lote = [];
    for (let i = 0; i < 50; i += 1) lote.push(chat(`${i}@c.us`, `Contato ${i}`));
    await store.actions.syncContacts(lote);
    await store.actions.setNote('42@c.us', 'não pode sumir');

    await store.actions.syncContacts([chat('0@c.us', 'Contato 0'), chat('1@c.us', 'Contato 1'), chat('2@c.us', 'Contato 2')]);
    const state = store.getState();
    expect(Object.keys(state.contacts)).toHaveLength(50);
    expect(Object.keys(state.cards)).toHaveLength(50);
    expect(state.contacts['49@c.us'].name).toBe('Contato 49');
    expect(state.cards['42@c.us'].note).toBe('não pode sumir');
    // quem foi relido tem lastSeenAt mais novo — é assim que o diagnóstico
    // separa "sumiu do viewport" de "nunca mais apareceu"
    expect(state.contacts['0@c.us'].lastSeenAt).toBeGreaterThanOrEqual(state.contacts['49@c.us'].lastSeenAt);
    done();
  });

  // AUDIT-01 #5: os três campos vinham do adapter e eram jogados fora, então
  // todo card caía no tempo relativo de `lastSeenAt` e dizia "agora" para sempre
  it('preserva timeLabel, muted e pinned vindos do adapter', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([
      chat('1@c.us', 'Ana', { timeLabel: '10:03', muted: true, pinned: true })
    ]);
    let contato = store.getState().contacts['1@c.us'];
    expect(contato.timeLabel).toBe('10:03');
    expect(contato.muted).toBe(true);
    expect(contato.pinned).toBe(true);

    // e sobrevivem à normalização que roda em toda mutação seguinte
    await store.actions.setNote('1@c.us', 'nota qualquer');
    contato = store.getState().contacts['1@c.us'];
    expect(contato.timeLabel).toBe('10:03');
    expect(contato.pinned).toBe(true);
    done();
  });

  // AUDIT-01 #1 (defesa em profundidade): um rótulo da interface que vaza para
  // a extração não pode sobrescrever nomes bons já gravados em disco
  it('nome repetido em quase todo o lote não sobrescreve nome bom já salvo', async () => {
    const { store, done } = await novoStore();
    const bons = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio'];
    await store.actions.syncContacts(bons.map((nome, i) => chat(`${i}@c.us`, nome)));

    // sincronização envenenada: todas as linhas com o mesmo rótulo
    await store.actions.syncContacts(
      bons.map((_, i) => chat(`${i}@c.us`, 'Menu de contexto da conversa'))
    );

    const state = store.getState();
    bons.forEach((nome, i) => {
      expect(state.contacts[`${i}@c.us`].name).toBe(nome);
    });
    expect(Object.keys(state.contacts)).toHaveLength(bons.length);
    done();
  });

  it('nome legítimo repetido em poucos contatos continua sendo aceito', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([
      chat('1@c.us', 'Antigo A'),
      chat('2@c.us', 'Antigo B'),
      chat('3@c.us', 'Carla'),
      chat('4@c.us', 'Diego'),
      chat('5@c.us', 'Elisa')
    ]);
    // dois homônimos em cinco: abaixo do limiar de suspeita
    await store.actions.syncContacts([
      chat('1@c.us', 'Rafael'),
      chat('2@c.us', 'Rafael'),
      chat('3@c.us', 'Carla'),
      chat('4@c.us', 'Diego'),
      chat('5@c.us', 'Elisa')
    ]);
    const state = store.getState();
    expect(state.contacts['1@c.us'].name).toBe('Rafael');
    expect(state.contacts['2@c.us'].name).toBe('Rafael');
    done();
  });

  it('nome suspeito não funde contatos distintos', async () => {
    const { store, done } = await novoStore();
    const lixo = 'Abrir painel lateral';
    await store.actions.syncContacts([
      chat('1@c.us', lixo),
      chat('2@c.us', lixo),
      chat('3@c.us', lixo),
      chat('4@c.us', lixo)
    ]);
    // contatos novos entram com o nome ruim, mas continuam sendo 4 registros
    expect(Object.keys(store.getState().contacts)).toHaveLength(4);
    // e a próxima leitura boa corrige os nomes
    await store.actions.syncContacts([
      chat('1@c.us', 'Ana'),
      chat('2@c.us', 'Bruno'),
      chat('3@c.us', 'Carla'),
      chat('4@c.us', 'Diego')
    ]);
    expect(store.getState().contacts['1@c.us'].name).toBe('Ana');
    done();
  });

  it('não recria card nem muda a coluna de quem já foi movido', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana')]);
    await store.actions.moveCard('1@c.us', 'done', 0);
    await store.actions.syncContacts([chat('1@c.us', 'Ana')]);
    expect(store.getState().cards['1@c.us'].columnId).toBe('done');
    done();
  });

  it('P3: id melhor (jid) absorve o registro antigo baseado em nome', async () => {
    const { store, done } = await novoStore();
    const antigo = nameIdFor('Ana Paula');
    await store.actions.syncContacts([chat(antigo, 'Ana Paula', { idKind: 'name' })]);
    await store.actions.addTag({ id: 'tag_vip', name: 'VIP' });
    await store.actions.setCardTags(antigo, ['tag_vip']);
    await store.actions.setNote(antigo, 'cliente antiga');
    await store.actions.moveCard(antigo, 'deal', 0);

    await store.actions.syncContacts([chat('55@c.us', 'Ana Paula')]);
    const state = store.getState();
    expect(state.contacts[antigo]).toBeUndefined();
    expect(state.contacts['55@c.us'].idKind).toBe('jid');
    expect(state.cards['55@c.us'].tagIds).toEqual(['tag_vip']);
    expect(state.cards['55@c.us'].note).toBe('cliente antiga');
    expect(state.cards['55@c.us'].columnId).toBe('deal');
    done();
  });

  it('repara no próximo sync a duplicação JID + name gravada por builds antigos', async () => {
    const name = 'Ana Paula';
    const jid = '55@c.us';
    const weakId = nameIdFor(name);
    const raw = defaultState();
    raw.tags = [{ id: 'vip', name: 'VIP', color: '#00a884', description: '' }];
    raw.contacts[jid] = { ...chat(jid, name), firstSeenAt: 1, lastSeenAt: 2, inboxOrder: 0 };
    raw.contacts[weakId] = { ...chat(weakId, name, { idKind: 'name' }), firstSeenAt: 1, lastSeenAt: 2, inboxOrder: null };
    raw.cards[jid] = { columnId: 'inbox', order: 0, tagIds: [], note: '', createdAt: 1, updatedAt: 1 };
    raw.cards[weakId] = { columnId: 'done', order: 0, tagIds: ['vip'], note: 'Legado', createdAt: 1, updatedAt: 1 };
    raw.followups[weakId] = {
      contactId: weakId,
      contactName: name,
      title: 'Retornar',
      timestamp: Date.now() + 60000,
      done: false
    };
    const { store, done } = await novoStore({ [STORAGE_KEY]: raw });

    await store.actions.syncContacts([chat(jid, name)]);

    const state = store.getState();
    expect(Object.keys(state.contacts)).toEqual([jid]);
    expect(state.cards[jid].columnId).toBe('done');
    expect(state.cards[jid].note).toBe('Legado');
    expect(state.cards[jid].tagIds).toEqual(['vip']);
    expect(state.followups[jid].contactId).toBe(jid);
    done();
  });

  it('renomear o contato não destrói o CRM quando há jid', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('9@c.us', 'Nome Antigo')]);
    await store.actions.setNote('9@c.us', 'histórico');
    await store.actions.syncContacts([chat('9@c.us', 'Nome Novo')]);
    const state = store.getState();
    expect(state.contacts['9@c.us'].name).toBe('Nome Novo');
    expect(state.cards['9@c.us'].note).toBe('histórico');
    done();
  });
});

describe('store/arquivamento e lote', () => {
  // ROADMAP §7: arquivar é do KanZapp, é reversível e não apaga nada.
  it('setArchived tira do quadro sem perder contato, card, nota ou tag', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana'), chat('2@c.us', 'Bruno')]);
    await store.actions.addTag({ id: 'tg', name: 'VIP' });
    await store.actions.setCardTags('1@c.us', ['tg']);
    await store.actions.setNote('1@c.us', 'nota importante');

    await store.actions.setArchived('1@c.us', true);
    const state = store.getState();
    expect(state.cards['1@c.us'].archived).toBe(true);
    expect(state.cards['1@c.us'].archivedAt).toBeGreaterThan(0);
    expect(state.cards['1@c.us'].note).toBe('nota importante');
    expect(state.cards['1@c.us'].tagIds).toEqual(['tg']);
    expect(state.contacts['1@c.us'].name).toBe('Ana');

    expect(select.cardsByColumn(state, {}).inbox).toHaveLength(1);
    expect(select.cardsByColumn(state, { showArchived: true }).inbox).toHaveLength(2);
    expect(select.stats(state).archived).toBe(1);
    expect(select.stats(state).activeCards).toBe(1);

    await store.actions.setArchived('1@c.us', false);
    expect(select.cardsByColumn(store.getState(), {}).inbox).toHaveLength(2);
    done();
  });

  it('setArchived em lote é uma escrita só', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana'), chat('2@c.us', 'Bruno'), chat('3@c.us', 'Caio')]);
    let commits = 0;
    const off = store.subscribe(() => { commits += 1; });
    await store.actions.setArchived(['1@c.us', '2@c.us', '3@c.us'], true);
    off();
    expect(commits).toBe(1, 'lote é UMA mutação (roadmap §4)');
    expect(select.stats(store.getState()).archived).toBe(3);
    done();
  });

  // ROADMAP §6: filtro de grupos é de exibição — nada some do store.
  it('hideGroups esconde grupos sem apagá-los', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([
      chat('1@c.us', 'Ana'),
      chat('120@g.us', 'Equipe', { isGroup: true })
    ]);
    const state = store.getState();
    expect(select.cardsByColumn(state, { hideGroups: true }).inbox).toHaveLength(1);
    expect(select.cardsByColumn(state, { hideGroups: false }).inbox).toHaveLength(2);
    expect(Object.keys(state.contacts)).toHaveLength(2);
    done();
  });

  it('moveCards move o lote em uma escrita e densifica as ordens', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([
      chat('1@c.us', 'Ana'), chat('2@c.us', 'Bruno'), chat('3@c.us', 'Caio'), chat('4@c.us', 'Duda')
    ]);
    let commits = 0;
    const off = store.subscribe(() => { commits += 1; });
    await store.actions.moveCards(['1@c.us', '3@c.us'], 'deal');
    off();
    expect(commits).toBe(1, 'lote é UMA mutação (roadmap §4)');
    const state = store.getState();
    expect(state.cards['1@c.us'].columnId).toBe('deal');
    expect(state.cards['3@c.us'].columnId).toBe('deal');
    expect([state.cards['1@c.us'].order, state.cards['3@c.us'].order].sort()).toEqual([0, 1]);
    const restantes = ['2@c.us', '4@c.us'].map((id) => state.cards[id].order).sort();
    expect(restantes).toEqual([0, 1], 'a coluna de origem fica com ordens densas');
    done();
  });

  it('tags em lote não duplicam nem removem o que não existe', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana'), chat('2@c.us', 'Bruno')]);
    await store.actions.addTag({ id: 'tg', name: 'VIP' });
    await store.actions.setCardTags('1@c.us', ['tg']);

    let commits = 0;
    const off = store.subscribe(() => { commits += 1; });
    await store.actions.addTagToCards(['1@c.us', '2@c.us'], 'tg');
    off();
    expect(commits).toBe(1, 'lote é UMA mutação (roadmap §4)');
    expect(store.getState().cards['1@c.us'].tagIds).toEqual(['tg']);
    expect(store.getState().cards['2@c.us'].tagIds).toEqual(['tg']);

    await store.actions.removeTagFromCards(['1@c.us', '2@c.us'], 'tg');
    expect(store.getState().cards['1@c.us'].tagIds).toHaveLength(0);
    expect(store.getState().cards['2@c.us'].tagIds).toHaveLength(0);

    await store.actions.addTagToCards(['1@c.us'], 'inexistente');
    expect(store.getState().cards['1@c.us'].tagIds).toHaveLength(0, 'tag desconhecida não entra');
    done();
  });

  it('inactiveCards conta só quem está parado e ignora arquivados', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana'), chat('2@c.us', 'Bruno')]);
    const agora = Date.now();
    const velho = agora - 120 * 86400000;
    const state = {
      ...store.getState(),
      contacts: {
        '1@c.us': { ...store.getState().contacts['1@c.us'], lastSeenAt: velho },
        '2@c.us': { ...store.getState().contacts['2@c.us'], lastSeenAt: agora }
      },
      cards: {
        '1@c.us': { ...store.getState().cards['1@c.us'], updatedAt: velho },
        '2@c.us': { ...store.getState().cards['2@c.us'], updatedAt: agora }
      }
    };
    expect(select.inactiveCards(state, 90)).toEqual(['1@c.us']);
    expect(select.inactiveCards(state, 365)).toHaveLength(0);
    const comArquivado = {
      ...state,
      cards: { ...state.cards, '1@c.us': { ...state.cards['1@c.us'], archived: true } }
    };
    expect(select.inactiveCards(comArquivado, 90)).toHaveLength(0);
    done();
  });
});

describe('store/concorrência', () => {
  it('10 moveCard em paralelo — nenhuma atualização se perde (defeito P4)', async () => {
    const { store, done } = await novoStore({}, 1);
    const chats = [];
    for (let i = 0; i < 10; i += 1) chats.push(chat(`${i}@c.us`, `Contato ${i}`));
    await store.actions.syncContacts(chats);

    const alvo = ['doing', 'deal', 'done'];
    await Promise.all(
      chats.map((c, i) => store.actions.moveCard(c.id, alvo[i % 3], 0))
    );

    const state = store.getState();
    for (let i = 0; i < 10; i += 1) {
      expect(state.cards[`${i}@c.us`].columnId).toBe(alvo[i % 3], `card ${i} perdeu a mutação`);
    }
    // e a ordem continua densa em cada coluna
    for (const column of state.columns) {
      const orders = Object.values(state.cards)
        .filter((c) => c.columnId === column.id)
        .map((c) => c.order)
        .sort((a, b) => a - b);
      expect(orders).toEqual(orders.map((_, idx) => idx));
    }
    done();
  });

  it('mutações concorrentes em campos diferentes coexistem', async () => {
    const { store, done } = await novoStore({}, 1);
    await store.actions.syncContacts([chat('1@c.us', 'Ana')]);
    await Promise.all([
      store.actions.setNote('1@c.us', 'nota'),
      store.actions.addTag({ id: 'tg', name: 'Tag' }),
      store.actions.addColumn('Nova'),
      store.actions.updateSettings({ density: 'compact' })
    ]);
    const state = store.getState();
    expect(state.cards['1@c.us'].note).toBe('nota');
    expect(state.tags).toHaveLength(1);
    expect(state.columns).toHaveLength(5);
    expect(state.settings.density).toBe('compact');
    done();
  });
});

describe('store/colunas', () => {
  it('removeColumn move os cards para a primeira coluna restante', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana'), chat('2@c.us', 'Bruno')]);
    await store.actions.moveCard('1@c.us', 'deal', 0);
    await store.actions.moveCard('2@c.us', 'deal', 1);
    await store.actions.removeColumn('deal');
    const state = store.getState();
    expect(state.columns.some((c) => c.id === 'deal')).toBeFalsy();
    expect(state.cards['1@c.us'].columnId).toBe('inbox');
    expect(state.cards['2@c.us'].columnId).toBe('inbox');
    done();
  });

  it('removeColumn não deixa o board sem nenhuma coluna', async () => {
    const { store, done } = await novoStore();
    for (const id of ['doing', 'deal', 'done']) await store.actions.removeColumn(id);
    await store.actions.removeColumn('inbox');
    expect(store.getState().columns).toHaveLength(1);
    done();
  });

  it('reorderColumns respeita a lista e mantém as ausentes', async () => {
    const { store, done } = await novoStore();
    await store.actions.reorderColumns(['done', 'inbox']);
    const ids = store.getState().columns.map((c) => c.id);
    expect(ids[0]).toBe('done');
    expect(ids[1]).toBe('inbox');
    expect(ids).toHaveLength(4);
    done();
  });

  it('renomear e colorir', async () => {
    const { store, done } = await novoStore();
    await store.actions.renameColumn('inbox', 'Leads');
    await store.actions.setColumnColor('inbox', '#123456');
    await store.actions.setColumnWipLimit('inbox', 5);
    const column = store.getState().columns[0];
    expect(column.title).toBe('Leads');
    expect(column.color).toBe('#123456');
    expect(column.wipLimit).toBe(5);
    done();
  });

  it('persiste o estado recolhido da coluna', async () => {
    const { store, done } = await novoStore();
    const columnId = store.getState().columns[0].id;
    await store.actions.setColumnCollapsed(columnId, true);
    expect(store.getState().columns[0].collapsed).toBe(true);
    done();
  });
});

describe('store/tags, notas e templates', () => {
  it('removeTag limpa as referências nos cards', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana')]);
    await store.actions.addTag({ id: 'tg1', name: 'VIP' });
    await store.actions.addTag({ id: 'tg2', name: 'Frio' });
    await store.actions.setCardTags('1@c.us', ['tg1', 'tg2']);
    await store.actions.removeTag('tg1');
    const state = store.getState();
    expect(state.tags).toHaveLength(1);
    expect(state.cards['1@c.us'].tagIds).toEqual(['tg2']);
    done();
  });

  it('setCardTags ignora tag inexistente', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana')]);
    await store.actions.setCardTags('1@c.us', ['fantasma']);
    expect(store.getState().cards['1@c.us'].tagIds).toEqual([]);
    done();
  });

  it('templates: adicionar, atualizar, remover', async () => {
    const { store, done } = await novoStore();
    await store.actions.addTemplate({ id: 'tp1', title: 'Oi', text: 'Olá!' });
    await store.actions.updateTemplate('tp1', { text: 'Olá, tudo bem?' });
    expect(store.getState().templates[0].text).toBe('Olá, tudo bem?');
    await store.actions.removeTemplate('tp1');
    expect(store.getState().templates).toHaveLength(0);
    done();
  });

  it('follow-up: definir e limpar', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana')]);
    await store.actions.setFollowup('1@c.us', { title: 'Ligar', timestamp: 123456789 });
    expect(store.getState().followups['1@c.us'].contactName).toBe('Ana');
    await store.actions.clearFollowup('1@c.us');
    expect(store.getState().followups['1@c.us']).toBeUndefined();
    done();
  });
});

describe('store/export e import', () => {
  it('round-trip preserva o estado', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana'), chat('2@c.us', 'Bruno')]);
    await store.actions.addTag({ id: 'tg', name: 'VIP' });
    await store.actions.setCardTags('1@c.us', ['tg']);
    await store.actions.setNote('1@c.us', 'anotação');
    await store.actions.moveCard('1@c.us', 'done', 0);
    const json = store.actions.exportJSON();
    const antes = store.getState();

    await store.actions.importJSON(defaultState(), { merge: false });
    expect(store.getState().tags).toHaveLength(0);

    const result = await store.actions.importJSON(json, { merge: false });
    expect(result.ok).toBeTruthy();
    const depois = store.getState();
    expect(depois.cards['1@c.us'].note).toBe('anotação');
    expect(depois.cards['1@c.us'].columnId).toBe('done');
    expect(depois.cards['1@c.us'].tagIds).toEqual(['tg']);
    expect(Object.keys(depois.contacts)).toEqual(Object.keys(antes.contacts));
    done();
  });

  it('import recusa JSON inválido sem tocar no estado', async () => {
    const { store, done } = await novoStore();
    await store.actions.addTag({ id: 'tg', name: 'VIP' });
    const result = await store.actions.importJSON('{isso não é json');
    expect(result.ok).toBeFalsy();
    expect(store.getState().tags).toHaveLength(1);
    done();
  });

  it('import recusa objeto sem assinatura sem tocar no estado', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana')]);
    await store.actions.addTag({ id: 'tg', name: 'VIP' });
    const before = store.getState();

    const result = await store.actions.importJSON({ hello: 'world' }, { merge: false });

    expect(result.ok).toBeFalsy();
    expect(store.getState()).toEqual(before);

    const versionOnly = await store.actions.importJSON({ version: 2 }, { merge: false });
    expect(versionOnly.ok).toBeFalsy();
    expect(store.getState()).toEqual(before);

    const legacyVersionOnly = await store.actions.importJSON({ version: 1 }, { merge: false });
    expect(legacyVersionOnly.ok).toBeFalsy();
    expect(store.getState()).toBe(before);

    const conflictingShape = await store.actions.importJSON({
      version: 2,
      kanbanData: {}
    }, { merge: false });
    expect(conflictingShape.ok).toBeFalsy();
    expect(store.getState()).toBe(before);

    const malformed = await store.actions.importJSON({
      ...defaultState(),
      columns: ['x']
    }, { merge: false });
    expect(malformed.ok).toBeFalsy();
    expect(store.getState()).toBe(before);
    done();
  });

  it('importa um backup v1 e correlaciona CRM por nome com o JID', async () => {
    const { store, done } = await novoStore();
    const jid = '5511988887777@c.us';
    const result = await store.actions.importJSON({
      allConversations: { [jid]: { id: jid, name: 'Ana Paula' } },
      kanbanData: { 'Ana Paula': 'done' },
      contactNotes: { 'Ana Paula': 'Nota legada' }
    }, { merge: false });

    expect(result.ok).toBeTruthy();
    expect(Object.keys(store.getState().contacts)).toEqual([jid]);
    expect(store.getState().cards[jid].columnId).toBe('done');
    expect(store.getState().cards[jid].note).toBe('Nota legada');
    done();
  });

  it('import com merge preserva o que já existe', async () => {
    const { store, done } = await novoStore();
    await store.actions.addTag({ id: 'local', name: 'Local' });
    await store.actions.importJSON(
      JSON.stringify({ version: 2, tags: [{ id: 'externa', name: 'Externa' }] }),
      { merge: true }
    );
    const ids = store.getState().tags.map((t) => t.id);
    expect(ids).toContain('local');
    expect(ids).toContain('externa');
    done();
  });
});

describe('store/select', () => {
  it('cardsByColumn agrupa, filtra por busca e por tag', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([
      chat('1@c.us', 'Ana Paula', { unread: 3 }),
      chat('2@c.us', 'Bruno Costa')
    ]);
    await store.actions.addTag({ id: 'tg', name: 'VIP' });
    await store.actions.setCardTags('1@c.us', ['tg']);
    const state = store.getState();

    const todos = select.cardsByColumn(state, {});
    expect(todos.inbox).toHaveLength(2);

    const busca = select.cardsByColumn(state, { search: 'ana' });
    expect(busca.inbox).toHaveLength(1);
    expect(busca.inbox[0].contact.name).toBe('Ana Paula');

    const semAcento = select.cardsByColumn(state, { search: 'PAULA' });
    expect(semAcento.inbox).toHaveLength(1);

    const porTag = select.cardsByColumn(state, { tagIds: ['tg'] });
    expect(porTag.inbox).toHaveLength(1);

    const naoLidas = select.cardsByColumn(state, { onlyUnread: true });
    expect(naoLidas.inbox).toHaveLength(1);
    done();
  });

  // ROADMAP §3: a busca passa a ver nota e tag, e entende prefixos.
  it('cardsByColumn busca por nota, por tag e pelos prefixos tag:/nota:/coluna:', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([
      chat('1@c.us', 'Ana Paula', { preview: 'bom dia' }),
      chat('2@c.us', 'Bruno Costa', { preview: 'bom dia' })
    ]);
    await store.actions.addTag({ id: 'tg', name: 'VIP' });
    await store.actions.setCardTags('1@c.us', ['tg']);
    await store.actions.setNote('2@c.us', 'Pediu orçamento revisado');
    const state = store.getState();
    const so = (filtros) => select.cardsByColumn(state, filtros).inbox.map((e) => e.contact.name);

    expect(so({ search: 'orçamento' })).toEqual(['Bruno Costa'], 'nota entra na busca livre');
    expect(so({ search: 'vip' })).toEqual(['Ana Paula'], 'nome da tag entra na busca livre');
    expect(so({ search: 'tag:vi' })).toEqual(['Ana Paula']);
    expect(so({ search: 'nota:orcamento' })).toEqual(['Bruno Costa']);
    expect(so({ search: 'coluna:entrada' })).toHaveLength(2);
    expect(so({ search: 'coluna:concluído' })).toHaveLength(0);
    expect(so({ search: 'foo:bar' })).toHaveLength(0, 'prefixo desconhecido é texto literal');
    done();
  });

  it('stats conta cartões, não lidas e follow-ups vencidos', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana', { unread: 2 }), chat('2@c.us', 'Bruno')]);
    await store.actions.setFollowup('1@c.us', { title: 'Ligar', timestamp: Date.now() - 1000 });
    const s = select.stats(store.getState());
    expect(s.contacts).toBe(2);
    expect(s.unread).toBe(2);
    expect(s.followupsOverdue).toBe(1);
    expect(s.byColumn.inbox).toBe(2);
    done();
  });

  it('contactsMissingFromInbox aponta quem saiu do viewport', async () => {
    const { store, done } = await novoStore();
    await store.actions.syncContacts([chat('1@c.us', 'Ana'), chat('2@c.us', 'Bruno')]);
    await new Promise((r) => setTimeout(r, 5));
    const state = {
      ...store.getState(),
      contacts: {
        ...store.getState().contacts,
        '2@c.us': { ...store.getState().contacts['2@c.us'], lastSeenAt: Date.now() - 60000 }
      }
    };
    const missing = select.contactsMissingFromInbox(state);
    expect(missing).toHaveLength(1);
    expect(missing[0].id).toBe('2@c.us');
    done();
  });
});

describe('store/persistência', () => {
  it('grava tudo sob uma única chave v2', async () => {
    const { stub, store, done } = await novoStore();
    await store.actions.addColumn('Extra');
    const saved = stub.snapshot()[STORAGE_KEY];
    expect(saved.version).toBe(2);
    expect(saved.columns).toHaveLength(5);
    done();
  });

  it('mudança externa (outra aba) atualiza o estado local', async () => {
    const { stub, store, done } = await novoStore();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    stub.emitExternalChange(STORAGE_KEY, {
      version: 2,
      columns: [{ id: 'x', title: 'Só uma' }],
      tags: [],
      templates: [],
      contacts: {},
      cards: {},
      followups: {},
      settings: {}
    });
    expect(notified).toBe(1);
    expect(store.getState().columns).toHaveLength(1);
    done();
  });

  it('destroy para de reagir a mudanças externas', async () => {
    const { stub, store, done } = await novoStore();
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.destroy();
    stub.emitExternalChange(STORAGE_KEY, { version: 2, columns: [], contacts: {}, cards: {} });
    expect(notified).toBe(0);
    done();
  });
});
