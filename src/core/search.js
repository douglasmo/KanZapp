// Busca do quadro: parser puro + casamento. Sem DOM, roda em Node.
//
// O campo de busca aceita texto livre e prefixos combináveis:
//   ana proposta        → nome, prévia, nota e tags
//   tag:vip             → só cards com uma tag que comece por "vip"
//   nota:orçamento      → só cards cuja nota interna contenha "orçamento"
//   coluna:negociação   → só cards na coluna cujo título contenha "negociação"
//   tag:vip ana         → combina prefixo e texto livre
// Prefixo desconhecido (`foo:bar`) é texto literal — o usuário não precisa
// decorar a lista, e escrever "http://" na busca não vira filtro fantasma.

import { normalizeForMatch } from './utils.js';

/** Prefixo digitado → campo. Aliases em pt-BR e en para não punir o usuário. */
const PREFIX_FIELD = Object.freeze({
  tag: 'tags',
  tags: 'tags',
  etiqueta: 'tags',
  etiquetas: 'tags',
  nota: 'notes',
  notas: 'notes',
  note: 'notes',
  notes: 'notes',
  coluna: 'columns',
  colunas: 'columns',
  column: 'columns'
});

/** Tokens: `campo:"valor com espaço"`, `"texto entre aspas"` ou palavra solta. */
const TOKEN_RE = /[^\s"]+:"[^"]*"|"[^"]*"|\S+/g;

function unquote(value) {
  const str = String(value ?? '');
  if (str.length >= 2 && str.startsWith('"') && str.endsWith('"')) return str.slice(1, -1);
  return str;
}

/**
 * @param {string} input
 * @returns {{raw: string, terms: string[], tags: string[], notes: string[],
 *            columns: string[], text: string, isEmpty: boolean}}
 */
export function parseSearchQuery(input) {
  const raw = String(input ?? '');
  const query = { raw, terms: [], tags: [], notes: [], columns: [], text: '', isEmpty: true };
  const tokens = raw.match(TOKEN_RE) || [];

  for (const token of tokens) {
    const at = token.indexOf(':');
    if (at > 0) {
      const field = PREFIX_FIELD[normalizeForMatch(token.slice(0, at))];
      const value = normalizeForMatch(unquote(token.slice(at + 1)));
      if (field && value) {
        query[field].push(value);
        continue;
      }
    }
    const term = normalizeForMatch(unquote(token));
    if (term) query.terms.push(term);
  }

  query.text = query.terms.join(' ');
  query.isEmpty = query.terms.length === 0
    && query.tags.length === 0
    && query.notes.length === 0
    && query.columns.length === 0;
  return query;
}

/** Casa por trecho do texto já normalizado (prefixo é o caso mais comum). */
function hit(haystack, needle) {
  return Boolean(haystack) && haystack.includes(needle);
}

function tagNamesOf(tags) {
  const out = [];
  for (const tag of tags || []) {
    const name = typeof tag === 'string' ? tag : tag && tag.name;
    const key = normalizeForMatch(name);
    if (key) out.push(key);
  }
  return out;
}

/**
 * @param {ReturnType<typeof parseSearchQuery>} query
 * @param {{name?: string, preview?: string, note?: string,
 *          tags?: Array<{name: string}|string>, column?: string}} target
 * @returns {boolean}
 */
export function matchesSearchQuery(query, target) {
  if (!query || query.isEmpty) return true;
  const note = normalizeForMatch(target?.note);
  const column = normalizeForMatch(target?.column);
  const tags = tagNamesOf(target?.tags);

  for (const term of query.notes) {
    if (!hit(note, term)) return false;
  }
  for (const term of query.columns) {
    if (!hit(column, term)) return false;
  }
  for (const term of query.tags) {
    if (!tags.some((name) => hit(name, term))) return false;
  }
  if (query.terms.length === 0) return true;

  // texto livre varre nome + prévia + nota + nomes das tags
  const haystack = [
    normalizeForMatch(target?.name),
    normalizeForMatch(target?.preview),
    note,
    tags.join(' ')
  ].join(' ');
  return query.terms.every((term) => haystack.includes(term));
}

/** Atalho para quem só tem a string crua em mãos. */
export function matchesSearch(input, target) {
  return matchesSearchQuery(parseSearchQuery(input), target);
}
