// Estrategias pontuadas para achar a lista de conversas e as linhas dentro dela.
// Regra do contrato: nenhum nome de classe ofuscado do WhatsApp pode ser sinal
// primario. Classes so entram como dica de peso baixo (ver CLASS_HINTS).

import { SCAN_LIMITS, JID_ANY_RE } from '../core/constants.js';

const ZERO_RECT = Object.freeze({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 });

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'CANVAS', 'NOSCRIPT', 'TEMPLATE']);

/** Dica fraca: classes historicamente usadas pela lista lateral. Peso minimo. */
const CLASS_HINTS = ['_ak8t', '_ak9y', '_ak72', 'x1n2onr6'];

const PANE_LABEL_RE = /chat list|lista de conversas|lista de chats|conversas|chats|mensagens|caixa de entrada/i;

export function rectOf(el) {
  try {
    const rect = el?.getBoundingClientRect?.();
    if (!rect) return ZERO_RECT;
    return {
      top: rect.top || 0,
      left: rect.left || 0,
      width: rect.width || 0,
      height: rect.height || 0,
      bottom: rect.bottom ?? (rect.top || 0) + (rect.height || 0),
      right: rect.right ?? (rect.left || 0) + (rect.width || 0)
    };
  } catch {
    return ZERO_RECT;
  }
}

export function viewportOf(el) {
  const doc = el?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
  return {
    width: win?.innerWidth || doc?.documentElement?.clientWidth || 1280,
    height: win?.innerHeight || doc?.documentElement?.clientHeight || 800
  };
}

export function styleOf(el) {
  try {
    const win = el?.ownerDocument?.defaultView;
    if (win && typeof win.getComputedStyle === 'function') return win.getComputedStyle(el);
  } catch {
    /* stub sem getComputedStyle */
  }
  return null;
}

export function isVisible(el) {
  if (!el || el.nodeType !== 1) return false;
  const rect = rectOf(el);
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = styleOf(el);
  if (style && (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')) {
    return false;
  }
  return true;
}

export function elementChildren(el) {
  const children = el?.children;
  if (!children) return [];
  return Array.prototype.slice.call(children);
}

/** Sinal estrutural: elemento rola verticalmente. */
export function isScrollable(el) {
  const style = styleOf(el);
  if (style) {
    const overflow = `${style.overflowY || ''} ${style.overflow || ''}`;
    if (/auto|scroll|overlay/.test(overflow)) return true;
  }
  const scrollHeight = Number(el?.scrollHeight) || 0;
  const clientHeight = Number(el?.clientHeight) || 0;
  return scrollHeight > clientHeight + 40;
}

/** Quantos filhos diretos tem altura parecida (+-20%) com a mediana. */
export function similarHeightChildren(el) {
  const children = elementChildren(el);
  if (children.length < 2) return { count: children.length, median: 0, total: children.length };
  const heights = children.map((child) => rectOf(child).height).filter((h) => h > 0);
  if (heights.length < 2) return { count: 0, median: 0, total: children.length };
  const sorted = [...heights].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!median) return { count: 0, median: 0, total: children.length };
  const count = heights.filter((h) => Math.abs(h - median) <= median * 0.2).length;
  return { count, median, total: children.length };
}

function textLengthOf(el) {
  const text = el?.textContent;
  return typeof text === 'string' ? text.trim().length : 0;
}

function hasLabel(el) {
  if (!el || typeof el.getAttribute !== 'function') return false;
  return Boolean(el.getAttribute('title') || el.getAttribute('aria-label'));
}

function classHintScore(el) {
  const cls = typeof el?.className === 'string' ? el.className : '';
  return CLASS_HINTS.some((hint) => cls.includes(hint)) ? 3 : 0;
}

/**
 * Pontua um candidato de 0 a 100.
 * @param {Element} el
 * @param {'pane'|'row'} kind
 */
export function scoreCandidate(el, kind = 'pane') {
  if (!el || el.nodeType !== 1) return 0;
  const rect = rectOf(el);
  const viewport = viewportOf(el);

  if (kind === 'row') {
    if (rect.width <= 0 || rect.height <= 0) return 0;
    let score = 12;
    const h = rect.height;
    if (h >= 44 && h <= 120) score += 28;
    else if (h >= SCAN_LIMITS.minRowHeight && h <= SCAN_LIMITS.maxRowHeight) score += 14;
    else return Math.max(0, score - 10);

    if (hasLabel(el)) score += 16;
    const len = textLengthOf(el);
    if (len >= 2 && len <= 240) score += 16;
    else if (len > 240) score += 4;

    const kids = elementChildren(el).length;
    if (kids >= 1 && kids <= 12) score += 10;
    const siblings = elementChildren(el.parentElement).length;
    if (siblings >= 3) score += 10;
    if (typeof el.querySelector === 'function') {
      try {
        if (el.querySelector('img')) score += 5;
      } catch {
        /* stub sem querySelector */
      }
    }
    score += classHintScore(el);
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // --- pane ---------------------------------------------------------------
  if (rect.width <= 0 || rect.height <= 0) return 0;
  let score = 8;

  const heightRatio = rect.height / (viewport.height || 1);
  if (heightRatio >= 0.5) score += 20;
  else score += Math.round(heightRatio * 40);

  // a lista de conversas vive no terco esquerdo e nao ocupa a tela toda
  if (rect.left <= viewport.width / 3) score += 12;
  if (rect.width <= viewport.width * 0.6) score += 8;

  if (isScrollable(el)) score += 16;

  const similar = similarHeightChildren(el);
  if (similar.count >= 3) {
    score += Math.min(24, Math.round((similar.count / 12) * 24) + 6);
  } else if (similar.total >= 3) {
    score += 4;
  }

  const len = textLengthOf(el);
  if (len >= 20) score += Math.min(8, Math.round(len / 200));
  if (hasLabel(el)) score += 4;
  score += classHintScore(el);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function qsa(root, selector) {
  try {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    return Array.prototype.slice.call(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function qs(root, selector) {
  try {
    if (!root || typeof root.querySelector !== 'function') return null;
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

/**
 * Varredura estrutural com orcamento de nos: coleta containers que parecem
 * uma lista (varios filhos de altura parecida) sem nunca fazer
 * querySelectorAll('div') na pagina inteira.
 */
export function collectStructuralCandidates(root, { maxNodes = SCAN_LIMITS.maxProbeNodes, maxDepth = 14 } = {}) {
  const start = root?.documentElement || root?.body || root;
  if (!start || start.nodeType !== 1) return [];
  const out = [];
  // busca em LARGURA: a lista de conversas fica em um nivel raso da arvore,
  // entao o orcamento de nos e gasto onde ela realmente esta.
  const queue = [{ el: start, depth: 0 }];
  let cursor = 0;
  let visited = 0;

  while (cursor < queue.length && visited < maxNodes) {
    const { el, depth } = queue[cursor];
    cursor += 1;
    visited += 1;
    const children = elementChildren(el);
    if (children.length >= 3) {
      const rect = rectOf(el);
      const viewport = viewportOf(el);
      if (rect.height >= viewport.height * 0.3 && rect.width > 120) out.push(el);
    }
    if (depth >= maxDepth) continue;
    for (const child of children) {
      if (SKIP_TAGS.has(child.tagName)) continue;
      // nao podar por altura do pai: um filho `position:fixed` deixa o pai
      // com altura zero e a lista ficaria inalcancavel.
      const rect = rectOf(child);
      if (rect.width === 0 && rect.height === 0 && elementChildren(child).length === 0) continue;
      queue.push({ el: child, depth: depth + 1 });
    }
  }
  return out;
}

/** Estrategias para achar o painel da lista de conversas. */
export const PANE_STRATEGIES = [
  {
    id: 'pane-side',
    weight: 1,
    find(root) {
      const doc = root?.ownerDocument || root;
      const el = (typeof doc?.getElementById === 'function' && doc.getElementById('pane-side')) || qs(root, '#pane-side');
      return el ? [el] : [];
    }
  },
  {
    id: 'aria-label',
    weight: 0.9,
    find(root) {
      return qsa(root, '[aria-label]').filter((el) => {
        const label = el.getAttribute('aria-label') || '';
        return PANE_LABEL_RE.test(label) && elementChildren(el).length >= 1;
      });
    }
  },
  {
    id: 'role-list',
    weight: 0.75,
    find(root) {
      return qsa(root, '[role="grid"],[role="list"],[role="listbox"],[role="tree"],[role="tabpanel"]').filter(
        (el) => elementChildren(el).length >= 1
      );
    }
  },
  {
    id: 'structural',
    weight: 0.5,
    find(root) {
      return collectStructuralCandidates(root);
    }
  }
];

/** Agrupa elementos por elemento pai. */
function groupByParent(elements) {
  const map = new Map();
  for (const el of elements) {
    const parent = el.parentElement;
    if (!parent) continue;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(el);
  }
  return map;
}

/**
 * Acha o maior "cluster" de irmaos com altura de linha de conversa.
 * E o unico caminho que funciona quando nao ha role, title nem data-id.
 */
export function findRowCluster(pane, { maxDepth = 6 } = {}) {
  const candidates = [];
  const stack = [{ el: pane, depth: 0 }];
  let visited = 0;
  while (stack.length > 0 && visited < SCAN_LIMITS.maxProbeNodes) {
    const { el, depth } = stack.pop();
    visited += 1;
    const children = elementChildren(el);
    if (children.length >= 3) {
      const rows = children.filter((child) => {
        const rect = rectOf(child);
        return (
          rect.height >= SCAN_LIMITS.minRowHeight &&
          rect.height <= SCAN_LIMITS.maxRowHeight &&
          textLengthOf(child) >= 1
        );
      });
      if (rows.length >= 3) candidates.push(rows);
    }
    if (depth >= maxDepth) continue;
    for (const child of children) {
      if (SKIP_TAGS.has(child.tagName)) continue;
      stack.push({ el: child, depth: depth + 1 });
    }
  }
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

/** Estrategias para achar as linhas dentro do painel. */
export const ROW_STRATEGIES = [
  {
    id: 'role-row',
    weight: 1,
    find(pane) {
      return qsa(pane, '[role="row"],[role="listitem"],[role="treeitem"],[role="option"],[role="gridcell"]').filter(
        (el) => !qs(el, '[role="row"],[role="listitem"],[role="treeitem"],[role="option"]')
      );
    }
  },
  {
    id: 'data-id',
    weight: 0.85,
    find(pane) {
      const seen = new Set();
      const out = [];
      for (const el of qsa(pane, '[data-id],[data-jid],[data-chatid]')) {
        const value =
          el.getAttribute('data-id') || el.getAttribute('data-jid') || el.getAttribute('data-chatid') || '';
        if (!JID_ANY_RE.test(value)) continue;
        // sobe ate a linha inteira (o data-id pode estar num filho)
        let node = el;
        for (let i = 0; i < 4 && node && node !== pane; i += 1) {
          const rect = rectOf(node);
          if (rect.height >= SCAN_LIMITS.minRowHeight && rect.height <= SCAN_LIMITS.maxRowHeight) break;
          node = node.parentElement;
        }
        const row = node && node !== pane ? node : el;
        if (seen.has(row)) continue;
        seen.add(row);
        out.push(row);
      }
      return out;
    }
  },
  {
    id: 'cluster',
    weight: 0.55,
    find(pane) {
      return findRowCluster(pane);
    }
  }
];

/**
 * Remove duplicatas e linhas aninhadas dentro de outra linha.
 * Usa um Set de ancestrais (O(n)) em vez de comparar todos contra todos.
 */
export function dedupeRows(rows, max = SCAN_LIMITS.maxRows) {
  const out = [];
  const accepted = new Set();
  for (const row of rows) {
    if (!row || accepted.has(row)) continue;
    let ancestor = row.parentElement;
    let nested = false;
    for (let i = 0; i < 8 && ancestor; i += 1) {
      if (accepted.has(ancestor)) {
        nested = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (nested) continue;
    accepted.add(row);
    out.push(row);
    if (out.length >= max) break;
  }
  return out;
}

export { groupByParent, qs, qsa, SKIP_TAGS };
