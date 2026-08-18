import { describe, it, expect } from '../run.mjs';
import { createComposer } from '../../src/wa/composer.js';
import { el, text, makeDocument } from '../dom-stub.mjs';

/** Cabeçalho do painel principal, no formato que o WhatsApp usa hoje. */
function makeHeader(name, { menuFirst = false, extraTexts = [] } = {}) {
  const children = [];
  if (menuFirst) {
    // markup real do WhatsApp: controles antes do nome
    children.push(el('button', { 'aria-label': 'Voltar', rect: { top: 0, left: 0, width: 32, height: 32 } }));
    children.push(el('div', {
      role: 'button',
      'aria-label': `Foto do perfil de ${name}`,
      rect: { top: 0, left: 40, width: 40, height: 40 }
    }));
  }
  if (name) {
    children.push(el('span', { title: name, rect: { top: 8, left: 90, width: 200, height: 20 } }, [text(name)]));
  }
  for (const extra of extraTexts) {
    children.push(el('span', { rect: { top: 30, left: 90, width: 260, height: 16 } }, [text(extra)]));
  }
  const header = el('header', { rect: { top: 0, left: 380, width: 900, height: 60 } }, children);
  makeDocument(header);
  return header;
}

function fixture(headerName = '', options = {}) {
  const composerEl = {
    textContent: '',
    getAttribute: () => null,
    closest: () => null
  };
  const header = makeHeader(headerName, options);
  const main = {
    querySelector: (selector) => selector === 'header' ? header : null,
    querySelectorAll: (selector) => selector.includes('contenteditable') ? [composerEl] : []
  };
  const row = {
    firstElementChild: null,
    querySelector: () => null,
    dispatchEvent() {},
    scrollIntoView() {}
  };
  const doc = {
    body: null,
    querySelector: (selector) => selector === '#main' ? main : null
  };
  const adapter = {
    pane: null,
    getRowElement: () => row,
    listChats: () => []
  };
  return createComposer({ adapter, doc, win: {}, waitTimeout: 12, waitInterval: 2 });
}

function searchFixture(resultName = 'Mariana', resultId = 'mariana@c.us', exposeResultRow = false) {
  let enterEvents = 0;
  let rowClicks = 0;
  const composerEl = {
    textContent: '',
    getAttribute: () => null,
    closest: () => null,
    dispatchEvent(event) {
      if (event?.key === 'Enter') enterEvents += 1;
    }
  };
  const header = makeHeader(resultName);
  const main = {
    querySelector: (selector) => selector === 'header' ? header : null,
    querySelectorAll: (selector) => selector.includes('contenteditable') ? [composerEl] : []
  };
  const searchBox = {
    tagName: 'INPUT',
    value: '',
    placeholder: 'Pesquisar',
    getAttribute: (name) => name === 'aria-label' ? 'Pesquisar' : null,
    dispatchEvent() {}
  };
  const sidePane = {
    parentElement: null,
    contains: () => false,
    querySelectorAll: (selector) => selector.startsWith('input') ? [searchBox] : []
  };
  const row = {
    firstElementChild: null,
    querySelector: () => null,
    scrollIntoView() {},
    dispatchEvent(event) {
      if (event?.type === 'click') rowClicks += 1;
    }
  };
  class FakeMouseEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  }
  const doc = {
    body: null,
    querySelector: (selector) => selector === '#main' ? main : null
  };
  const adapter = {
    pane: sidePane,
    getRowElement: (key) => exposeResultRow && (key === resultId || key === resultName) ? row : null,
    listChats: () => [{ id: resultId, name: resultName }]
  };
  return {
    composer: createComposer({ adapter, doc, win: { MouseEvent: FakeMouseEvent }, waitTimeout: 12, waitInterval: 2 }),
    enterEvents: () => enterEvents,
    rowClicks: () => rowClicks
  };
}

describe('composer/confirmação de conversa', () => {
  it('não aceita composer existente quando o cabeçalho está vazio', async () => {
    const result = await fixture('').openChat({ id: 'ana@c.us', name: 'Ana' });
    expect(result.ok).toBe(false);
  });

  it('não confunde nome alvo com substring de outra conversa', async () => {
    const result = await fixture('Mariana').openChat({ id: 'ana@c.us', name: 'Ana' });
    expect(result.ok).toBe(false);
  });

  it('confirma quando o nome normalizado do cabeçalho é exatamente o alvo', async () => {
    const result = await fixture('Ána').openChat({ id: 'ana@c.us', name: 'Ana' });
    expect(result.ok).toBe(true);
    expect(result.via).toBe('row');
  });

  // AUDIT-01 #10: "Voltar" e "Foto do perfil de X" vinham antes do nome e o
  // composer, que lia labelled[0], reportava falha mesmo com a conversa aberta.
  it('rótulo de botão antes do nome não impede a confirmação', async () => {
    const composer = fixture('Beatriz Antunes', { menuFirst: true });
    expect(composer.currentChatName()).toBe('Beatriz Antunes');
    const result = await composer.openChat({ id: 'bea@c.us', name: 'Beatriz Antunes' });
    expect(result.ok).toBe(true);
    expect(result.via).toBe('row');
  });

  // ROADMAP §2: o cabeçalho real vem decorado; exigir igualdade exata contra o
  // candidato inteiro era falso-negativo ("Não foi possível abrir a conversa"
  // com a conversa aberta na tela).
  it('nome decorado no cabeçalho ainda confirma a abertura', async () => {
    const composer = fixture('Ana Almeida (você)', { menuFirst: true });
    const result = await composer.openChat({ id: 'ana@c.us', name: 'Ana Almeida' });
    expect(result.ok).toBe(true);
    expect(result.via).toBe('row');
    expect(composer.headerMatch('Ana Almeida').via).toBe('trecho');
  });

  it('igualdade exata continua sendo o caminho preferido', async () => {
    const composer = fixture('Ana Almeida');
    expect(composer.headerMatch('Ana Almeida').via).toBe('exato');
  });

  // O contra-exemplo que impede trocar a igualdade por substring crua.
  it('lista de participantes de grupo não confirma um contato solto', async () => {
    const composer = fixture('Equipe Comercial', {
      extraTexts: ['Ana Almeida, Bruno Barros, Carla Cardoso, Diego Duarte']
    });
    const result = await composer.openChat({ id: 'ana@c.us', name: 'Ana Almeida' });
    expect(result.ok).toBe(false);
  });

  it('trilha de diagnóstico registra linha e busca', async () => {
    const result = await fixture('Mariana').openChat({ id: 'ana@c.us', name: 'Ana' });
    expect(result.ok).toBe(false);
    expect(result.steps[0]).toContain('linha:falhou');
    expect(result.steps.length).toBeGreaterThan(1, 'só reporta falha depois de tentar a busca também');
  });

  it('cabeçalho só com rótulos de controle não confirma conversa nenhuma', async () => {
    const composer = fixture('', { menuFirst: true });
    expect(composer.currentChatName()).toBe('');
    expect((await composer.openChat({ id: 'ana@c.us', name: 'Ana' })).ok).toBe(false);
  });

  it('busca de Ana nunca seleciona nem envia para Mariana', async () => {
    const test = searchFixture();
    const chat = { id: 'ana@c.us', name: 'Ana' };

    expect((await test.composer.openChat(chat)).ok).toBe(false);
    expect(await test.composer.sendMessage(chat, 'Mensagem privada')).toBe(false);
    expect(test.enterEvents()).toBe(0);
  });

  it('id forte ausente não cai para homônimo por nome', async () => {
    const test = searchFixture('Ana', 'outro@c.us', true);
    const target = { id: 'ana@c.us', idKind: 'jid', name: 'Ana' };
    expect((await test.composer.openChat(target)).ok).toBe(false);
    expect(await test.composer.sendMessage(target, 'Segredo')).toBe(false);
    expect(test.rowClicks()).toBe(0);
    expect(test.enterEvents()).toBe(0);
  });
});
