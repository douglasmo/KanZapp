// Testa as partes puras do adapter (filtros de texto) e a garantia de que ele
// nunca lanca, mesmo sem DOM nenhum — que e o caso deste runner em Node.
import { describe, it, expect } from '../run.mjs';
import {
  isNoiseText,
  isTimeLabel,
  isUnreadLabel,
  stripUnreadSuffix,
  createWhatsAppAdapter,
  scanRowNodes,
  buildNameCandidates,
  boilerplatePenalties,
  pickNameCandidate
} from '../../src/wa/adapter.js';
import { el, text, makeDocument } from '../dom-stub.mjs';

/* -------------------------------------------------------------------------- *
 * Fábrica de listas de conversa. `extras` injeta os rótulos concorrentes que
 * a auditoria 01 usou para envenenar a extração.
 * -------------------------------------------------------------------------- */
const CONTATOS = [
  ['João Silva', '10:03', 'Oi, tudo bem?', 3],
  ['Maria Fernanda', '09:47', 'Vou confirmar o pedido', 0],
  ['Carlos Eduardo Souza', 'ontem', 'Obrigado!', 1],
  ['Beatriz Antunes', '08:15', 'Documento recebido', 0],
  ['Fornecedor ACME', '12/03', 'Segue a nota fiscal', 0],
  ['Dra. Helena Prado', '11:22', 'Podemos remarcar?', 2],
  ['Rafael', '07:05', 'Bom dia', 0],
  ['Loja Centro', '15/02', 'Chamado encerrado', 0],
  ['Patrícia Nogueira', '16:40', 'Combinado então', 5],
  ['Equipe Comercial', 'ontem', 'Ana: fechamos o mês', 12]
];

const ROW_H = 72;

function linha(index, [nome, hora, previa, naoLidas], options = {}) {
  const top = index * ROW_H;
  const filhos = [];

  if (options.menuAntes) {
    filhos.push(el('button', {
      'aria-label': 'Menu de contexto da conversa',
      rect: { top: top + 24, left: 4, width: 24, height: 24 }
    }));
    filhos.push(el('div', {
      role: 'button',
      'aria-label': 'Selecionar conversa',
      rect: { top: top + 26, left: 32, width: 20, height: 20 }
    }));
  }

  const nomeEl = options.nomeAninhado
    ? el('div', { rect: { top: top + 12, left: 70, width: 220, height: 20 } }, [
      el('div', { rect: { top: top + 12, left: 70, width: 220, height: 20 } }, [
        el('span', { rect: { top: top + 12, left: 70, width: 200, height: 20 } }, [text(nome)])
      ])
    ])
    : el('span', { title: nome, rect: { top: top + 12, left: 70, width: 200, height: 20 } }, [text(nome)]);

  const linha1 = el('div', { rect: { top: top + 12, left: 70, width: 300, height: 20 } }, [
    nomeEl,
    el('span', { rect: { top: top + 12, left: 300, width: 60, height: 18 } }, [text(hora)])
  ]);

  const linha2 = el('div', { rect: { top: top + 40, left: 70, width: 300, height: 20 } }, [
    el('span', { rect: { top: top + 40, left: 70, width: 220, height: 20 } }, [text(previa)]),
    naoLidas
      ? el('span', {
        'aria-label': `${naoLidas} mensagens não lidas`,
        rect: { top: top + 40, left: 330, width: 20, height: 20 }
      }, [text(String(naoLidas))])
      : null
  ]);

  filhos.push(el('div', { rect: { top, left: 60, width: 320, height: ROW_H } }, [linha1, linha2]));

  const props = {
    rect: { top, left: 0, width: 380, height: ROW_H }
  };
  if (!options.semRole) props.role = 'row';
  if (!options.semDataId) props['data-id'] = `55119999000${index}@c.us`;
  if (options.tituloConcorrente) props.title = `Conversa com ${nome}`;
  return el('div', props, filhos);
}

function montar(options = {}) {
  const linhas = CONTATOS.map((contato, i) => linha(i, contato, options));
  const pane = el('div', {
    id: options.semRole ? undefined : 'pane-side',
    rect: { top: 0, left: 0, width: 380, height: 760 },
    scrollHeight: 2000,
    clientHeight: 760
  }, linhas);
  const raiz = el('div', { rect: { top: 0, left: 0, width: 1280, height: 800 } }, [pane]);
  const doc = makeDocument(raiz);
  return { doc, pane, linhas };
}

function nomesDe(options) {
  const { doc } = montar(options);
  const adapter = createWhatsAppAdapter({ doc, win: null });
  const chats = adapter.listChats();
  return { chats, nomes: chats.map((c) => c.name), health: adapter.health, adapter };
}

describe('adapter/ruído textual', () => {
  it('rótulos de sistema em pt-BR e en são ruído', () => {
    for (const texto of ['Arquivadas', 'archived', 'Status', 'Canais', 'Comunidades', 'Pesquisar', 'você', 'Digitando...']) {
      expect(isNoiseText(texto)).toBeTruthy(`"${texto}" deveria ser ruído`);
    }
  });

  it('frases do WhatsApp sobre criptografia são ruído', () => {
    expect(isNoiseText('Suas mensagens pessoais são protegidas com criptografia de ponta a ponta')).toBeTruthy();
    expect(isNoiseText('Messages are end-to-end encrypted')).toBeTruthy();
  });

  it('nome de contato normal não é ruído', () => {
    for (const nome of ['João Silva', 'Equipe Comercial', 'Dra. Helena Prado', 'Ed', 'Loja Centro — Suporte']) {
      expect(isNoiseText(nome)).toBeFalsy(`"${nome}" não deveria ser ruído`);
    }
  });

  it('vazio é ruído', () => {
    expect(isNoiseText('')).toBeTruthy();
    expect(isNoiseText(null)).toBeTruthy();
  });
});

describe('adapter/rótulos de hora', () => {
  it('reconhece horários e datas', () => {
    for (const t of ['10:03', '9:47', 'ontem', 'Ontem', 'hoje', '12/03', '15/02/2026', 'sábado', 'sex']) {
      expect(isTimeLabel(t)).toBeTruthy(`"${t}" deveria ser hora/data`);
    }
  });

  it('não confunde nome com hora', () => {
    expect(isTimeLabel('João Silva')).toBeFalsy();
    expect(isTimeLabel('Segunda Via Contabilidade')).toBeFalsy();
  });
});

describe('adapter/não lidas', () => {
  it('reconhece rótulos de não lidas em vários formatos', () => {
    expect(isUnreadLabel('3 mensagens não lidas')).toBeTruthy();
    expect(isUnreadLabel('não lidas: 4')).toBeTruthy();
    expect(isUnreadLabel('2 unread messages')).toBeTruthy();
    expect(isUnreadLabel('João Silva')).toBeFalsy();
  });

  it('stripUnreadSuffix limpa o sufixo colado no aria-label', () => {
    expect(stripUnreadSuffix('João Silva, 3 mensagens não lidas')).toBe('João Silva');
    expect(stripUnreadSuffix('Maria Fernanda 2 não lidas')).toBe('Maria Fernanda');
    expect(stripUnreadSuffix('Carlos, 4 unread')).toBe('Carlos');
    expect(stripUnreadSuffix('Beatriz Antunes')).toBe('Beatriz Antunes');
  });
});

describe('adapter/extração de nome por pontuação', () => {
  it('layout atual: 10/10 nomes, leitura saudável', () => {
    const { nomes, health } = nomesDe({});
    expect(nomes).toEqual(CONTATOS.map((c) => c[0]));
    expect(health.degraded).toBeFalsy();
    expect(health.quality).toBe(1);
    expect(health.confidence).toBeGreaterThan(80);
  });

  // AUDIT-01 #1: um button[aria-label] antes do nome envenenava 100% das linhas
  it('botão de menu antes do nome não vira nome de contato', () => {
    const { nomes, health } = nomesDe({ menuAntes: true });
    expect(nomes).toEqual(CONTATOS.map((c) => c[0]));
    expect(nomes).not.toContain('Menu de contexto da conversa');
    expect(health.degraded).toBeFalsy();
  });

  it('sem role, sem data-id e com o nome em span aninhado ainda extrai tudo', () => {
    const { nomes, chats } = nomesDe({ semRole: true, semDataId: true, nomeAninhado: true, menuAntes: true });
    expect(nomes).toEqual(CONTATOS.map((c) => c[0]));
    expect(chats[0].idKind).toBe('name');
  });

  it('title concorrente na própria linha perde para o texto visível', () => {
    const { nomes } = nomesDe({ nomeAninhado: true, tituloConcorrente: true, menuAntes: true });
    expect(nomes).toEqual(CONTATOS.map((c) => c[0]));
  });

  it('não lidas e prévia continuam corretas com os controles no caminho', () => {
    const { chats } = nomesDe({ menuAntes: true });
    expect(chats[0].unread).toBe(3);
    expect(chats[0].preview).toBe('Oi, tudo bem?');
    expect(chats[1].unread).toBe(0);
    expect(chats[0].timeLabel).toBe('10:03');
  });
});

describe('adapter/qualidade da extração', () => {
  // AUDIT-01 #2: confiança media a estratégia, não o resultado
  it('nome repetido em todas as linhas derruba a confiança e marca degradado', () => {
    // pior caso: a linha inteira é igual, não há candidato melhor para escolher
    const repetidos = CONTATOS.map((c) => ['Abrir painel lateral', c[1], 'Abrir painel lateral', c[3]]);
    const linhas = repetidos.map((contato, i) => linha(i, contato, { nomeAninhado: true }));
    const pane = el('div', {
      id: 'pane-side',
      rect: { top: 0, left: 0, width: 380, height: 760 },
      scrollHeight: 2000,
      clientHeight: 760
    }, linhas);
    const doc = makeDocument(el('div', { rect: { top: 0, left: 0, width: 1280, height: 800 } }, [pane]));
    const adapter = createWhatsAppAdapter({ doc, win: null });
    const chats = adapter.listChats();
    expect(chats.length).toBeGreaterThan(0);
    expect(adapter.health.degraded).toBeTruthy();
    expect(adapter.health.confidence).toBeLessThan(45);
    expect(adapter.health.quality).toBeLessThan(0.5);
  });

  it('estratégia fraca com extração perfeita NÃO é degradada', () => {
    const { health, nomes } = nomesDe({ semRole: true, semDataId: true, nomeAninhado: true });
    expect(nomes).toHaveLength(10);
    expect(health.strategy).toContain('cluster');
    expect(health.degraded).toBeFalsy();
    expect(health.confidence).toBeGreaterThan(45);
  });

  it('boilerplatePenalties só pune texto repetido na maioria das linhas', () => {
    const listas = [
      [{ key: 'joao silva' }, { key: 'menu' }],
      [{ key: 'maria' }, { key: 'menu' }],
      [{ key: 'carlos' }, { key: 'menu' }],
      [{ key: 'ana' }, { key: 'menu' }]
    ];
    const penalidades = boilerplatePenalties(listas);
    expect(penalidades.get('menu')).toBeGreaterThan(0);
    expect(penalidades.get('joao silva')).toBeUndefined();
  });

  it('menos de 3 linhas nunca gera penalidade de boilerplate', () => {
    expect(boilerplatePenalties([[{ key: 'x' }], [{ key: 'x' }]]).size).toBe(0);
  });
});

describe('adapter/candidatos a nome', () => {
  it('rótulo de botão não entra na lista de candidatos', () => {
    const row = linha(0, CONTATOS[0], { menuAntes: true });
    makeDocument(el('div', { rect: { top: 0, left: 0, width: 1280, height: 800 } }, [row]));
    const candidatos = buildNameCandidates(row, scanRowNodes(row));
    const chaves = candidatos.map((c) => c.key);
    expect(chaves).toContain('joao silva');
    expect(chaves).not.toContain('menu de contexto da conversa');
    expect(chaves).not.toContain('selecionar conversa');
  });

  it('o melhor candidato é o nome, não a prévia nem a hora', () => {
    const row = linha(0, CONTATOS[0], {});
    makeDocument(el('div', { rect: { top: 0, left: 0, width: 1280, height: 800 } }, [row]));
    const melhor = pickNameCandidate(buildNameCandidates(row, scanRowNodes(row)), null);
    expect(melhor.text).toBe('João Silva');
    expect(melhor.suspect).toBeFalsy();
  });

  it('penalidade de boilerplate marca o nome escolhido como suspeito', () => {
    const row = linha(0, CONTATOS[0], {});
    makeDocument(el('div', { rect: { top: 0, left: 0, width: 1280, height: 800 } }, [row]));
    const candidatos = buildNameCandidates(row, scanRowNodes(row));
    const melhor = pickNameCandidate(candidatos, new Map([['joao silva', 70]]));
    // o boilerplate derrubou o vencedor: outro texto assume, mas marcado
    expect(melhor.text).not.toBe('João Silva');
    expect(melhor.suspect).toBeTruthy();
  });

  it('sem penalidade e com um candidato claro, nada é suspeito', () => {
    const row = linha(0, CONTATOS[2], {});
    makeDocument(el('div', { rect: { top: 0, left: 0, width: 1280, height: 800 } }, [row]));
    const melhor = pickNameCandidate(buildNameCandidates(row, scanRowNodes(row)), new Map());
    expect(melhor.text).toBe('Carlos Eduardo Souza');
    expect(melhor.suspect).toBeFalsy();
  });
});

describe('adapter/robustez sem DOM', () => {
  const adapter = createWhatsAppAdapter({ doc: null, win: null });

  it('probe sem documento não lança e reporta falha', () => {
    const result = adapter.probe(true);
    expect(result.ok).toBeFalsy();
    expect(result.rowsFound).toBe(0);
  });

  it('listChats devolve array vazio', () => {
    expect(adapter.listChats()).toEqual([]);
  });

  it('health fica degradado com mensagem de erro', () => {
    adapter.listChats();
    const health = adapter.health;
    expect(health.ok).toBeFalsy();
    expect(health.degraded).toBeTruthy();
    expect(typeof health.lastError).toBe('string');
  });

  it('observe devolve um stop chamável', () => {
    const stop = adapter.observe(() => {});
    expect(typeof stop).toBe('function');
    stop();
  });

  it('getTheme cai em light e diagnostics é serializável', () => {
    expect(adapter.getTheme()).toBe('light');
    expect(typeof JSON.stringify(adapter.diagnostics())).toBe('string');
  });

  it('health é uma cópia: mexer nela não corrompe o adapter', () => {
    const copia = adapter.health;
    copia.ok = true;
    expect(adapter.health.ok).toBeFalsy();
  });
});
