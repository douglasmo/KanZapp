import { describe, it, expect } from '../run.mjs';
import { createSweeper } from '../../src/wa/sweeper.js';

/**
 * Scroller falso: `scrollTop`/`scrollHeight`/`clientHeight` de verdade e uma
 * fonte de linhas que depende da faixa de scroll, como a lista virtualizada do
 * WhatsApp. `win` vazio de propósito: sem `getComputedStyle`, sem
 * `MutationObserver` e sem `requestAnimationFrame`, o sweeper cai no teto de
 * tempo por passo (1 ms nos testes).
 */
function makeList({ rows = 100, perView = 20, rowHeight = 30, viewport = perView * rowHeight, scrollTop = 0 } = {}) {
  const scroller = {
    nodeType: 1,
    children: [],
    parentElement: null,
    scrollTop,
    clientHeight: viewport,
    scrollHeight: Math.max(viewport + 100, rows * rowHeight)
  };
  const calls = { list: 0 };
  const adapter = {
    pane: scroller,
    probe: () => ({ ok: true }),
    listChats() {
      calls.list += 1;
      const first = Math.floor(scroller.scrollTop / rowHeight);
      const out = [];
      for (let i = first; i < Math.min(rows, first + perView); i += 1) {
        out.push({ id: `c${i}@c.us`, name: `Contato ${i}`, inboxOrder: i - first });
      }
      return out;
    }
  };
  return { scroller, adapter, calls };
}

const fastOptions = { win: {}, stepTimeoutMs: 1 };

describe('sweeper/varredura', () => {
  it('captura a lista inteira e para no fim', async () => {
    const { scroller, adapter } = makeList({ rows: 100 });
    const sweeper = createSweeper({ adapter, ...fastOptions });
    const result = await sweeper.run({});
    expect(result.ok).toBe(true);
    expect(result.found).toBe(100);
    expect(result.stopped).toBe(false);
    expect(['fim-da-lista', 'sem-novos']).toContain(result.reason);
    expect(scroller.scrollTop).toBe(0);
  });

  it('emite progresso crescente e um evento final com done', async () => {
    const { adapter } = makeList({ rows: 60 });
    const sweeper = createSweeper({ adapter, ...fastOptions });
    const seen = [];
    const result = await sweeper.run({ onProgress: (p) => seen.push({ ...p }) });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1].done).toBe(true);
    expect(seen[seen.length - 1].found).toBe(result.found);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i].found).toBeGreaterThanOrEqual(seen[i - 1].found);
    }
  });

  it('entrega lotes com inboxOrder global crescente', async () => {
    const { adapter } = makeList({ rows: 45, perView: 10 });
    const lotes = [];
    const sweeper = createSweeper({
      adapter,
      onBatch: (chats) => {
        lotes.push(chats);
      },
      ...fastOptions
    });
    await sweeper.run({});
    expect(lotes.length).toBeGreaterThan(1);
    const posicoes = new Map();
    for (const lote of lotes) {
      for (const chat of lote) {
        if (posicoes.has(chat.id)) {
          expect(posicoes.get(chat.id)).toBe(chat.inboxOrder, 'inboxOrder mudou entre lotes');
        }
        posicoes.set(chat.id, chat.inboxOrder);
      }
    }
    expect(posicoes.size).toBe(45);
    expect(Math.max(...posicoes.values())).toBe(44);
  });

  it('restaura o scrollTop original mesmo tendo começado do topo', async () => {
    const { scroller, adapter } = makeList({ rows: 100, scrollTop: 777 });
    const sweeper = createSweeper({ adapter, ...fastOptions });
    const result = await sweeper.run({});
    expect(result.found).toBe(100, 'varredura precisa subir para o topo antes de começar');
    expect(scroller.scrollTop).toBe(777);
  });

  it('para no teto de passos sem varrer a lista inteira', async () => {
    const { scroller, adapter } = makeList({ rows: 100000, viewport: 300, rowHeight: 30 });
    const sweeper = createSweeper({ adapter, maxSteps: 3, ...fastOptions });
    const result = await sweeper.run({});
    expect(result.reason).toBe('teto-passos');
    expect(result.stopped).toBe(true);
    expect(result.batches).toBe(3);
    expect(scroller.scrollTop).toBe(0);
  });

  it('para no teto de tempo', async () => {
    const { adapter } = makeList({ rows: 100000, viewport: 300, rowHeight: 30 });
    let clock = 0;
    const sweeper = createSweeper({
      adapter,
      maxMs: 50,
      now: () => {
        clock += 20;
        return clock;
      },
      ...fastOptions
    });
    const result = await sweeper.run({});
    expect(result.reason).toBe('teto-tempo');
    expect(result.stopped).toBe(true);
  });

  it('para depois de 3 passos sem id novo', async () => {
    const scroller = {
      nodeType: 1,
      children: [],
      parentElement: null,
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 100000
    };
    const adapter = {
      pane: scroller,
      // lista que rola mas nunca entrega nada novo (linhas presas/fantasma)
      listChats: () => [{ id: 'a@c.us', name: 'A' }, { id: 'b@c.us', name: 'B' }]
    };
    const sweeper = createSweeper({ adapter, ...fastOptions });
    const result = await sweeper.run({});
    expect(result.reason).toBe('sem-novos');
    expect(result.found).toBe(2);
    expect(result.batches).toBe(4, 'primeiro lote traz novidade; os 3 seguintes, não');
  });

  it('cancela pelo signal e restaura a rolagem', async () => {
    const { scroller, adapter } = makeList({ rows: 100000, scrollTop: 240, viewport: 300, rowHeight: 30 });
    const signal = { aborted: false };
    const sweeper = createSweeper({ adapter, ...fastOptions });
    const result = await sweeper.run({
      signal,
      onProgress: (p) => {
        if (p.step >= 2) signal.aborted = true;
      }
    });
    expect(result.reason).toBe('cancelado');
    expect(result.stopped).toBe(true);
    expect(result.found).toBeGreaterThan(0);
    expect(scroller.scrollTop).toBe(240);
  });

  it('onProgress que lança não deixa a lista em outro lugar', async () => {
    const { scroller, adapter } = makeList({ rows: 100, scrollTop: 512 });
    const sweeper = createSweeper({ adapter, ...fastOptions });
    const result = await sweeper.run({
      onProgress: () => {
        throw new Error('UI quebrada');
      }
    });
    expect(result.reason).toBe('erro-progresso');
    expect(result.stopped).toBe(true);
    expect(scroller.scrollTop).toBe(512, 'scrollTop tem de voltar mesmo com o consumidor quebrado');
  });

  it('listChats que lança não propaga e restaura a rolagem', async () => {
    const scroller = {
      nodeType: 1,
      children: [],
      parentElement: null,
      scrollTop: 300,
      clientHeight: 400,
      scrollHeight: 9000
    };
    const adapter = {
      pane: scroller,
      listChats: () => {
        throw new Error('DOM sumiu no meio da leitura');
      }
    };
    const sweeper = createSweeper({ adapter, ...fastOptions });
    const result = await sweeper.run({});
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('erro');
    expect(scroller.scrollTop).toBe(300);
  });

  it('onBatch que lança não interrompe a varredura nem perde a rolagem', async () => {
    const { scroller, adapter } = makeList({ rows: 40, scrollTop: 90 });
    const sweeper = createSweeper({
      adapter,
      onBatch: () => {
        throw new Error('store fora do ar');
      },
      ...fastOptions
    });
    const result = await sweeper.run({});
    expect(result.found).toBe(40);
    expect(scroller.scrollTop).toBe(90);
  });

  it('sem pane devolve sem-scroller sem lançar', async () => {
    const sweeper = createSweeper({ adapter: { pane: null, listChats: () => [] }, ...fastOptions });
    const result = await sweeper.run({});
    expect(result).toEqual({ ok: false, found: 0, batches: 0, stopped: true, reason: 'sem-scroller' });
  });

  it('pane sem rolagem própria devolve sem-scroller', async () => {
    const pane = {
      nodeType: 1,
      children: [],
      parentElement: null,
      scrollTop: 0,
      clientHeight: 500,
      scrollHeight: 500
    };
    const sweeper = createSweeper({ adapter: { pane, listChats: () => [] }, ...fastOptions });
    const result = await sweeper.run({});
    expect(result.reason).toBe('sem-scroller');
  });

  it('acha o rolável em um descendente do pane', async () => {
    const inner = {
      nodeType: 1,
      children: [],
      parentElement: null,
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 4000
    };
    const pane = {
      nodeType: 1,
      children: [inner],
      parentElement: null,
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 400
    };
    inner.parentElement = pane;
    const adapter = {
      pane,
      listChats() {
        const first = Math.floor(inner.scrollTop / 40);
        return [{ id: `d${first}@c.us`, name: `D${first}` }];
      }
    };
    const sweeper = createSweeper({ adapter, ...fastOptions });
    expect(sweeper.findScroller()).toBe(inner);
    const result = await sweeper.run({});
    expect(result.ok).toBe(true);
    expect(result.found).toBeGreaterThan(1);
  });

  it('suspende e religa o auto-refresh, inclusive quando dá erro', async () => {
    const eventos = [];
    const { adapter } = makeList({ rows: 20 });
    const sweeper = createSweeper({
      adapter,
      suspendRefresh: () => {
        eventos.push('suspenso');
        return () => eventos.push('religado');
      },
      ...fastOptions
    });
    await sweeper.run({});
    expect(eventos).toEqual(['suspenso', 'religado']);

    const quebrado = createSweeper({
      adapter: {
        pane: { nodeType: 1, children: [], scrollTop: 0, clientHeight: 100, scrollHeight: 9000 },
        listChats: () => {
          throw new Error('falhou');
        }
      },
      suspendRefresh: () => {
        eventos.push('suspenso2');
        return () => eventos.push('religado2');
      },
      ...fastOptions
    });
    await quebrado.run({});
    expect(eventos).toEqual(['suspenso', 'religado', 'suspenso2', 'religado2']);
  });

  it('recusa duas varreduras simultâneas', async () => {
    const { adapter } = makeList({ rows: 60 });
    const sweeper = createSweeper({ adapter, ...fastOptions });
    const primeira = sweeper.run({});
    const segunda = await sweeper.run({});
    expect(segunda.reason).toBe('em-andamento');
    await primeira;
    expect(sweeper.isRunning()).toBe(false);
  });
});
