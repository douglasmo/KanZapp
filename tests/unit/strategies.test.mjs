import { describe, it, expect } from '../run.mjs';
import {
  scoreCandidate,
  dedupeRows,
  similarHeightChildren,
  isVisible,
  PANE_STRATEGIES,
  ROW_STRATEGIES
} from '../../src/wa/strategies.js';

// --- mini-DOM stub (sem jsdom) ---------------------------------------------
const VIEW = { innerWidth: 1280, innerHeight: 800 };
const DOC = { defaultView: VIEW };

function el({
  tag = 'DIV',
  rect = { top: 0, left: 0, width: 100, height: 60 },
  attrs = {},
  children = [],
  text = null,
  scrollHeight = 0,
  clientHeight = 0
} = {}) {
  const node = {
    nodeType: 1,
    tagName: tag,
    className: attrs.class || '',
    id: attrs.id || '',
    children: [],
    parentElement: null,
    scrollHeight,
    clientHeight,
    ownerDocument: DOC,
    getAttribute: (key) => (key in attrs ? attrs[key] : null),
    hasAttribute: (key) => key in attrs,
    getBoundingClientRect: () => ({
      ...rect,
      bottom: rect.top + rect.height,
      right: rect.left + rect.width
    }),
    querySelector: () => null,
    querySelectorAll: () => []
  };
  for (const child of children) {
    child.parentElement = node;
    node.children.push(child);
  }
  Object.defineProperty(node, 'textContent', {
    get: () => (text !== null ? text : node.children.map((c) => c.textContent).join(''))
  });
  return node;
}

function rows(count, height = 72) {
  return Array.from({ length: count }, (_, i) =>
    el({
      rect: { top: i * height, left: 0, width: 380, height },
      attrs: { title: `Contato ${i}` },
      text: `Contato ${i} 10:0${i} última mensagem`
    })
  );
}

describe('strategies/scoreCandidate pane', () => {
  const lista = el({
    rect: { top: 60, left: 0, width: 380, height: 740 },
    attrs: { 'aria-label': 'Lista de conversas' },
    children: rows(6),
    scrollHeight: 2000,
    clientHeight: 740
  });

  const cabecalho = el({
    rect: { top: 0, left: 0, width: 1280, height: 60 },
    children: rows(3, 40),
    text: 'cabeçalho'
  });

  const painelDireito = el({
    rect: { top: 0, left: 400, width: 880, height: 800 },
    children: rows(4, 100)
  });

  const escondido = el({ rect: { top: 0, left: 0, width: 0, height: 0 } });

  it('a lista lateral vence o cabeçalho largo', () => {
    expect(scoreCandidate(lista, 'pane')).toBeGreaterThan(scoreCandidate(cabecalho, 'pane'));
  });

  it('a lista lateral vence o painel da direita', () => {
    expect(scoreCandidate(lista, 'pane')).toBeGreaterThan(scoreCandidate(painelDireito, 'pane'));
  });

  it('elemento sem área pontua zero', () => {
    expect(scoreCandidate(escondido, 'pane')).toBe(0);
    expect(isVisible(escondido)).toBeFalsy();
  });

  it('a ordenação por score escolhe o candidato certo', () => {
    const escolhido = [cabecalho, painelDireito, lista, escondido]
      .map((node) => ({ node, score: scoreCandidate(node, 'pane') }))
      .sort((a, b) => b.score - a.score)[0].node;
    expect(escolhido).toBe(lista);
  });

  it('rolagem e filhos de altura parecida somam pontos', () => {
    const semRolagem = el({
      rect: { top: 60, left: 0, width: 380, height: 740 },
      children: rows(6)
    });
    expect(scoreCandidate(lista, 'pane')).toBeGreaterThan(scoreCandidate(semRolagem, 'pane'));
  });

  it('score fica sempre entre 0 e 100', () => {
    for (const node of [lista, cabecalho, painelDireito, escondido]) {
      const score = scoreCandidate(node, 'pane');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('null/lixo não quebra', () => {
    expect(scoreCandidate(null, 'pane')).toBe(0);
    expect(scoreCandidate({}, 'row')).toBe(0);
  });
});

describe('strategies/scoreCandidate row', () => {
  const linha = el({
    rect: { top: 0, left: 0, width: 380, height: 72 },
    attrs: { title: 'João Silva' },
    text: 'João Silva 10:03 Oi, tudo bem?'
  });
  const bloco = el({
    rect: { top: 0, left: 0, width: 380, height: 400 },
    text: 'muito texto '.repeat(40)
  });
  const separador = el({ rect: { top: 0, left: 0, width: 380, height: 8 }, text: '' });

  it('linha de conversa vence bloco alto e separador fino', () => {
    const scoreLinha = scoreCandidate(linha, 'row');
    expect(scoreLinha).toBeGreaterThan(scoreCandidate(bloco, 'row'));
    expect(scoreLinha).toBeGreaterThan(scoreCandidate(separador, 'row'));
  });

  it('linha sem title ainda pontua acima do separador', () => {
    const semTitle = el({
      rect: { top: 0, left: 0, width: 380, height: 72 },
      text: 'Maria 09:12 bom dia'
    });
    expect(scoreCandidate(semTitle, 'row')).toBeGreaterThan(scoreCandidate(separador, 'row'));
  });

  it('ter irmãos parecidos ajuda', () => {
    const pai = el({ rect: { top: 0, left: 0, width: 380, height: 300 }, children: rows(4) });
    const solitaria = el({
      rect: { top: 0, left: 0, width: 380, height: 72 },
      attrs: { title: 'Contato 0' },
      text: 'Contato 0 10:00 última mensagem'
    });
    expect(scoreCandidate(pai.children[0], 'row')).toBeGreaterThan(scoreCandidate(solitaria, 'row'));
  });
});

describe('strategies/similarHeightChildren', () => {
  it('conta filhos com altura parecida', () => {
    const pai = el({ rect: { top: 0, left: 0, width: 380, height: 400 }, children: rows(5) });
    const resultado = similarHeightChildren(pai);
    expect(resultado.count).toBe(5);
    expect(resultado.median).toBe(72);
  });

  it('ignora quando as alturas são muito diferentes', () => {
    const pai = el({
      rect: { top: 0, left: 0, width: 380, height: 400 },
      children: [
        el({ rect: { top: 0, left: 0, width: 380, height: 10 } }),
        el({ rect: { top: 0, left: 0, width: 380, height: 200 } }),
        el({ rect: { top: 0, left: 0, width: 380, height: 400 } })
      ]
    });
    expect(similarHeightChildren(pai).count).toBe(1);
  });
});

describe('strategies/dedupeRows', () => {
  it('descarta linhas aninhadas dentro de outra já aceita', () => {
    const interna = el({ rect: { top: 0, left: 0, width: 300, height: 60 } });
    const externa = el({ rect: { top: 0, left: 0, width: 380, height: 72 }, children: [interna] });
    const irma = el({ rect: { top: 72, left: 0, width: 380, height: 72 } });
    const out = dedupeRows([externa, interna, irma]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(externa);
    expect(out[1]).toBe(irma);
  });

  it('remove duplicatas e respeita o limite', () => {
    const lista = rows(10);
    expect(dedupeRows([...lista, ...lista])).toHaveLength(10);
    expect(dedupeRows(lista, 4)).toHaveLength(4);
  });
});

describe('strategies/catálogo', () => {
  it('as estratégias estão ordenadas do mais forte ao mais fraco', () => {
    const pesosPane = PANE_STRATEGIES.map((s) => s.weight);
    const pesosRow = ROW_STRATEGIES.map((s) => s.weight);
    expect(pesosPane).toEqual([...pesosPane].sort((a, b) => b - a));
    expect(pesosRow).toEqual([...pesosRow].sort((a, b) => b - a));
  });

  it('toda estratégia tem id, weight e find', () => {
    for (const strategy of [...PANE_STRATEGIES, ...ROW_STRATEGIES]) {
      expect(typeof strategy.id).toBe('string');
      expect(typeof strategy.weight).toBe('number');
      expect(typeof strategy.find).toBe('function');
    }
  });

  it('find nunca lança com raiz inválida', () => {
    for (const strategy of [...PANE_STRATEGIES, ...ROW_STRATEGIES]) {
      const out = strategy.find({});
      expect(Array.isArray(out)).toBeTruthy();
    }
  });
});
