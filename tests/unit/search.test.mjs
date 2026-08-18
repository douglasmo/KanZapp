import { describe, it, expect } from '../run.mjs';
import { parseSearchQuery, matchesSearchQuery, matchesSearch } from '../../src/core/search.js';

const alvo = {
  name: 'Ana Almeida',
  preview: 'Consegue mandar a proposta hoje?',
  note: 'Cliente pediu orçamento revisado até sexta.',
  tags: [{ name: 'VIP' }, { name: 'Lead frio' }],
  column: 'Negociação'
};

describe('search/parseSearchQuery', () => {
  it('texto simples vira termos livres', () => {
    const q = parseSearchQuery('Ana Proposta');
    expect(q.terms).toEqual(['ana', 'proposta']);
    expect(q.tags).toHaveLength(0);
    expect(q.isEmpty).toBe(false);
  });

  it('entrada vazia é consulta vazia', () => {
    expect(parseSearchQuery('').isEmpty).toBe(true);
    expect(parseSearchQuery('   ').isEmpty).toBe(true);
    expect(parseSearchQuery(null).isEmpty).toBe(true);
  });

  it('prefixo isolado não deixa resto de texto', () => {
    const q = parseSearchQuery('tag:vip');
    expect(q.tags).toEqual(['vip']);
    expect(q.terms).toHaveLength(0);
  });

  it('prefixo e texto livre convivem', () => {
    const q = parseSearchQuery('tag:vip ana');
    expect(q.tags).toEqual(['vip']);
    expect(q.terms).toEqual(['ana']);
  });

  it('reconhece nota e coluna, com acento e caixa normalizados', () => {
    const q = parseSearchQuery('NOTA:Orçamento Coluna:Negociação');
    expect(q.notes).toEqual(['orcamento']);
    expect(q.columns).toEqual(['negociacao']);
  });

  it('prefixo desconhecido é texto literal', () => {
    const q = parseSearchQuery('foo:bar');
    expect(q.terms).toEqual(['foo:bar']);
    expect(q.tags).toHaveLength(0);
    expect(q.notes).toHaveLength(0);
  });

  it('prefixo sem valor também é texto literal', () => {
    expect(parseSearchQuery('tag:').terms).toEqual(['tag:']);
  });

  it('aspas mantêm o valor com espaço inteiro', () => {
    const q = parseSearchQuery('nota:"orçamento revisado" "Ana Almeida"');
    expect(q.notes).toEqual(['orcamento revisado']);
    expect(q.terms).toEqual(['ana almeida']);
  });

  it('acumula vários prefixos do mesmo campo', () => {
    expect(parseSearchQuery('tag:vip tag:frio').tags).toEqual(['vip', 'frio']);
  });
});

describe('search/matchesSearchQuery', () => {
  const casa = (input) => matchesSearch(input, alvo);

  it('consulta vazia casa com tudo', () => {
    expect(matchesSearchQuery(parseSearchQuery(''), alvo)).toBe(true);
  });

  it('texto livre acha pelo nome, pela prévia, pela nota e pela tag', () => {
    expect(casa('almeida')).toBe(true);
    expect(casa('proposta')).toBe(true);
    expect(casa('orçamento')).toBe(true, 'nota entra na busca livre (ROADMAP §3)');
    expect(casa('lead')).toBe(true, 'nome da tag entra na busca livre (ROADMAP §3)');
    expect(casa('bruno')).toBe(false);
  });

  it('vários termos livres exigem todos', () => {
    expect(casa('ana proposta')).toBe(true);
    expect(casa('ana bruno')).toBe(false);
  });

  it('tag casa por prefixo do nome', () => {
    expect(casa('tag:vi')).toBe(true);
    expect(casa('tag:VIP')).toBe(true);
    expect(casa('tag:premium')).toBe(false);
  });

  it('dois prefixos de tag exigem as duas tags', () => {
    expect(casa('tag:vip tag:lead')).toBe(true);
    expect(casa('tag:vip tag:premium')).toBe(false);
  });

  it('nota: procura só na nota', () => {
    expect(casa('nota:orcamento')).toBe(true);
    expect(casa('nota:proposta')).toBe(false, '"proposta" está na prévia, não na nota');
  });

  it('coluna: procura só no título da coluna', () => {
    expect(casa('coluna:negocia')).toBe(true);
    expect(casa('coluna:entrada')).toBe(false);
  });

  it('prefixo combinado com texto livre é conjunção', () => {
    expect(casa('tag:vip ana')).toBe(true);
    expect(casa('tag:vip bruno')).toBe(false);
  });

  it('alvo sem nota/tag não quebra', () => {
    const magro = { name: 'Bruno', preview: '', note: '', tags: [], column: 'Entrada' };
    expect(matchesSearch('bruno', magro)).toBe(true);
    expect(matchesSearch('tag:vip', magro)).toBe(false);
    expect(matchesSearch('nota:x', magro)).toBe(false);
  });

  it('aceita tags como strings simples', () => {
    expect(matchesSearch('tag:vip', { name: 'X', tags: ['VIP'] })).toBe(true);
  });
});
