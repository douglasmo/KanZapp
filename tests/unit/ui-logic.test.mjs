/**
 * Testes dirigidos aos defeitos de UI que escaparam da auditoria 01 (#15).
 *
 * A camada visual não roda em Node, mas as DECISÕES que estavam erradas são
 * puras e foram extraídas exatamente por isso:
 *   #4  `pickColumnAt`      — soltar fora das colunas movia o card assim mesmo
 *   #6  `boardEmptyModel`   — o texto do estado vazio nunca era atualizado
 *   #3  `resolveEscapeTarget` — Esc fechava o quadro em vez do topo da pilha
 * O comportamento no DOM real é coberto em `tests/ui-harness.html`
 * (checkDrag, checkEscape, checkEmptyState, checkOverflow).
 */
import { describe, it, expect } from '../run.mjs';
import { pickColumnAt, DROP_TOLERANCE } from '../../src/ui/dnd.js';
import { boardEmptyModel, sweepOutcome } from '../../src/ui/board.js';
import { resolveEscapeTarget } from '../../src/ui/app-root.js';

/** Quadro típico: cabeçalho de 0 a 120, colunas de 120 a 700. */
function colunas() {
  return [
    { columnId: 'todo', rect: { top: 120, bottom: 700, left: 16, right: 296 } },
    { columnId: 'doing', rect: { top: 120, bottom: 700, left: 312, right: 592 } },
    { columnId: 'nego', rect: { top: 120, bottom: 700, left: 608, right: 888 } }
  ];
}

describe('dnd/pickColumnAt', () => {
  it('ponto dentro da coluna devolve a coluna', () => {
    expect(pickColumnAt(colunas(), 400, 300).columnId).toBe('doing');
    expect(pickColumnAt(colunas(), 20, 690).columnId).toBe('todo');
  });

  // AUDIT-01 #4: (700, 20) é o cabeçalho do quadro; antes virava "nego"
  it('soltar no cabeçalho do quadro não escolhe coluna nenhuma', () => {
    expect(pickColumnAt(colunas(), 700, 20)).toBeNull();
  });

  it('soltar abaixo do rodapé das colunas também não escolhe nada', () => {
    expect(pickColumnAt(colunas(), 400, 900)).toBeNull();
  });

  it('a tolerância vertical de 40 px continua valendo', () => {
    expect(pickColumnAt(colunas(), 400, 120 - DROP_TOLERANCE + 1).columnId).toBe('doing');
    expect(pickColumnAt(colunas(), 400, 700 + DROP_TOLERANCE - 1).columnId).toBe('doing');
    expect(pickColumnAt(colunas(), 400, 700 + DROP_TOLERANCE + 5)).toBeNull();
  });

  it('no vão entre colunas, escolhe a mais próxima em x (mesma faixa vertical)', () => {
    expect(pickColumnAt(colunas(), 300, 300).columnId).toBe('todo');
    expect(pickColumnAt(colunas(), 306, 300).columnId).toBe('doing');
  });

  it('sem colunas visíveis devolve null', () => {
    expect(pickColumnAt([], 100, 300)).toBeNull();
    expect(pickColumnAt(null, 100, 300)).toBeNull();
  });
});

describe('board/boardEmptyModel', () => {
  it('sem contatos e com o WhatsApp lido, pede para rolar a lista', () => {
    const model = boardEmptyModel({ hasContacts: false, totalVisible: 0, filtering: false, down: false });
    expect(model.needs).toBeTruthy();
    expect(model.kind).toBe('empty');
    expect(model.title).toBe('Nenhuma conversa capturada ainda');
  });

  // AUDIT-01 #6: arranque a frio — o nó já existia com o texto genérico e o
  // diagnóstico só chegava depois; o texto tem de mudar junto
  it('quando o adapter cai, o texto passa a ser "WhatsApp não detectado"', () => {
    const antes = boardEmptyModel({ hasContacts: false, totalVisible: 0, filtering: false, down: false });
    const depois = boardEmptyModel({ hasContacts: false, totalVisible: 0, filtering: false, down: true });
    expect(depois.kind).not.toBe(antes.kind);
    expect(depois.title).toBe('WhatsApp não detectado');
    expect(depois.icon).toBe('warning');
  });

  it('com cards visíveis não mostra estado vazio', () => {
    expect(boardEmptyModel({ hasContacts: true, totalVisible: 12, filtering: false, down: false }).needs).toBeFalsy();
  });

  it('busca sem resultado não vira "nenhuma conversa capturada"', () => {
    expect(boardEmptyModel({ hasContacts: true, totalVisible: 0, filtering: true, down: false }).needs).toBeFalsy();
  });
});

describe('board/sweepOutcome', () => {
  it('varredura completa vira mensagem de sucesso com o total', () => {
    const out = sweepOutcome({ ok: true, found: 312, batches: 20, stopped: false, reason: 'fim-da-lista' });
    expect(out.type).toBe('success');
    expect(out.message).toContain('312 conversas');
  });

  it('singular sem "s" pendurado', () => {
    expect(sweepOutcome({ ok: true, found: 1, reason: 'sem-novos' }).message).toContain('1 conversa.');
  });

  it('sem scroller manda o usuário para o diagnóstico', () => {
    const out = sweepOutcome({ ok: false, found: 0, reason: 'sem-scroller' });
    expect(out.type).toBe('error');
    expect(out.diagnose).toBe(true);
  });

  it('cancelamento e tetos avisam sem parecer erro', () => {
    expect(sweepOutcome({ ok: true, found: 40, stopped: true, reason: 'cancelado' }).type).toBe('warn');
    expect(sweepOutcome({ ok: true, found: 40, stopped: true, reason: 'teto-passos' }).type).toBe('warn');
    expect(sweepOutcome({ ok: true, found: 40, stopped: true, reason: 'teto-tempo' }).message)
      .toContain('limite de segurança');
  });

  it('zero conversas não é comemorado como sucesso', () => {
    expect(sweepOutcome({ ok: true, found: 0, reason: 'sem-novos' }).type).toBe('warn');
  });

  it('resultado ausente é tratado como falha de leitura', () => {
    expect(sweepOutcome(null).type).toBe('error');
  });
});

describe('app-root/resolveEscapeTarget', () => {
  const base = { open: true, hasDialog: false, boardHandled: false };

  it('diálogo aberto tem prioridade sobre tudo', () => {
    expect(resolveEscapeTarget({ ...base, hasDialog: true, boardHandled: true })).toBe('dialog');
  });

  // AUDIT-01 #3: grab de teclado, arraste, rename inline e busca preenchida
  // fechavam o quadro inteiro
  it('camada interna do quadro (grab, arraste, rename, busca) é desfeita antes do quadro', () => {
    expect(resolveEscapeTarget({ ...base, boardHandled: true })).toBe('board-layer');
  });

  it('sem nada por cima, Esc fecha o quadro', () => {
    expect(resolveEscapeTarget(base)).toBe('board');
  });

  it('com o quadro fechado, Esc não faz nada', () => {
    expect(resolveEscapeTarget({ ...base, open: false })).toBe('none');
  });
});
