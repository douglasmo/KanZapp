import { describe, it, expect } from '../run.mjs';
import {
  hashString,
  normalizeText,
  normalizeForMatch,
  relativeTime,
  debounce,
  throttle,
  clamp,
  shallowEqual,
  groupBy,
  escapeForRegExp,
  deepFreeze,
  deepClone,
  moveInArray,
  waitFor,
  nextId,
  initialsOf,
  extractJid,
  nameIdFor,
  idKindOf
} from '../../src/core/utils.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('utils/hashString', () => {
  it('é estável entre chamadas', () => {
    expect(hashString('João Silva')).toBe(hashString('João Silva'));
  });

  it('difere para entradas diferentes', () => {
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  it('devolve base36 sem caracteres estranhos', () => {
    expect(/^[0-9a-z]+$/.test(hashString('qualquer coisa'))).toBeTruthy();
  });

  it('não quebra com vazio/null', () => {
    expect(typeof hashString('')).toBe('string');
    expect(typeof hashString(null)).toBe('string');
  });

  it('valores conhecidos (regressão: mudar o hash órfãria ids "name:" salvos)', () => {
    expect(hashString('kanzapp')).toBe('oaxdrw');
    expect(hashString('a')).toBe('1r9wi7g');
    expect(hashString('joao silva')).toBe('1qcdhl7');
    expect(nameIdFor('João Silva')).toBe('name:1qcdhl7');
  });
});

describe('utils/normalize', () => {
  it('normalizeText colapsa espaços', () => {
    expect(normalizeText('  a   b \n c ')).toBe('a b c');
  });

  it('normalizeForMatch remove acento e caixa', () => {
    expect(normalizeForMatch('JOÃO Ação ÊNFASE')).toBe('joao acao enfase');
  });

  it('normalizeForMatch tolera null', () => {
    expect(normalizeForMatch(null)).toBe('');
  });
});

describe('utils/relativeTime', () => {
  const base = new Date(2026, 2, 12, 15, 0, 0).getTime(); // 12/03/2026 15:00

  it('menos de 1 minuto = agora', () => {
    expect(relativeTime(base - 30000, base)).toBe('agora');
  });

  it('timestamp futuro não é apresentado como agora', () => {
    expect(relativeTime(base + 30000, base)).toBe('em instantes');
    expect(relativeTime(base + 3 * 3600000, base)).toBe('em 3 h');
  });

  it('minutos', () => {
    expect(relativeTime(base - 5 * 60000, base)).toBe('há 5 min');
  });

  it('horas no mesmo dia', () => {
    expect(relativeTime(base - 3 * 3600000, base)).toBe('há 3 h');
  });

  it('ontem', () => {
    const ontem = new Date(2026, 2, 11, 22, 0, 0).getTime();
    expect(relativeTime(ontem, base)).toBe('ontem');
  });

  it('data curta para mais antigo', () => {
    const antigo = new Date(2026, 2, 3, 10, 0, 0).getTime();
    expect(relativeTime(antigo, base)).toBe('03/03');
  });

  it('vazio para timestamp inválido', () => {
    expect(relativeTime(null, base)).toBe('');
    expect(relativeTime(0, base)).toBe('');
  });
});

describe('utils/debounce', () => {
  it('executa uma vez só depois da pausa', async () => {
    let calls = 0;
    const fn = debounce(() => {
      calls += 1;
    }, 20);
    fn();
    fn();
    fn();
    expect(calls).toBe(0);
    await sleep(60);
    expect(calls).toBe(1);
  });

  it('cancel impede a execução', async () => {
    let calls = 0;
    const fn = debounce(() => {
      calls += 1;
    }, 20);
    fn();
    fn.cancel();
    await sleep(50);
    expect(calls).toBe(0);
  });
});

describe('utils/throttle', () => {
  it('dispara na borda inicial e agrupa o resto', async () => {
    let calls = 0;
    const fn = throttle(() => {
      calls += 1;
    }, 40);
    fn();
    fn();
    fn();
    expect(calls).toBe(1);
    await sleep(90);
    expect(calls).toBe(2);
    fn.cancel();
  });
});

describe('utils/diversos', () => {
  it('clamp respeita limites', () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp('x', 2, 10)).toBe(2);
  });

  it('shallowEqual compara um nível', () => {
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBeTruthy();
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBeFalsy();
    expect(shallowEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBeFalsy();
  });

  it('groupBy agrupa por função', () => {
    const out = groupBy([1, 2, 3, 4], (n) => (n % 2 ? 'impar' : 'par'));
    expect(out.par).toEqual([2, 4]);
    expect(out.impar).toEqual([1, 3]);
  });

  it('escapeForRegExp neutraliza metacaracteres', () => {
    const re = new RegExp(escapeForRegExp('a+b(c)'));
    expect(re.test('a+b(c)')).toBeTruthy();
  });

  it('deepFreeze congela em profundidade', () => {
    const obj = deepFreeze({ a: { b: 1 } });
    expect(Object.isFrozen(obj.a)).toBeTruthy();
  });

  it('deepClone desacopla', () => {
    const src = { a: { b: 1 } };
    const copy = deepClone(src);
    copy.a.b = 2;
    expect(src.a.b).toBe(1);
  });

  it('moveInArray reordena sem mutar', () => {
    const src = ['a', 'b', 'c'];
    expect(moveInArray(src, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(src).toEqual(['a', 'b', 'c']);
  });

  it('nextId gera ids diferentes', () => {
    expect(nextId('x')).not.toBe(nextId('x'));
  });

  it('initialsOf pega primeira e última', () => {
    expect(initialsOf('joão da silva')).toBe('JS');
    expect(initialsOf('')).toBe('?');
  });
});

describe('utils/identidade', () => {
  it('extractJid reconhece jid puro', () => {
    expect(extractJid('5511999998888@c.us')).toBe('5511999998888@c.us');
  });

  it('extractJid extrai jid embutido', () => {
    expect(extractJid('true_5511999998888@c.us_3EB0')).toBe('5511999998888@c.us');
  });

  it('extractJid devolve vazio quando não há', () => {
    expect(extractJid('cell-frame-container')).toBe('');
  });

  it('nameIdFor é estável e prefixado', () => {
    expect(nameIdFor('João')).toBe(nameIdFor('joão '));
    expect(nameIdFor('João').startsWith('name:')).toBeTruthy();
  });

  it('idKindOf classifica', () => {
    expect(idKindOf('5511@c.us')).toBe('jid');
    expect(idKindOf('name:abc')).toBe('name');
    expect(idKindOf('dom:cell-42')).toBe('dom');
  });
});

describe('utils/waitFor', () => {
  it('resolve quando o predicado vira verdadeiro', async () => {
    let flag = null;
    setTimeout(() => {
      flag = 'pronto';
    }, 30);
    const result = await waitFor(() => flag, { timeout: 500, interval: 10 });
    expect(result).toBe('pronto');
  });

  it('resolve null no timeout, sem lançar', async () => {
    const result = await waitFor(() => null, { timeout: 40, interval: 10 });
    expect(result).toBeNull();
  });

  it('predicado que lança não quebra a espera', async () => {
    const result = await waitFor(
      () => {
        throw new Error('boom');
      },
      { timeout: 40, interval: 10 }
    );
    expect(result).toBeNull();
  });
});
