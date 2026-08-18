// Adapter do WhatsApp Web: le a lista de conversas sem depender de um seletor
// magico. Cadeia de estrategias pontuadas + auto-recuperacao + degradacao
// explicita. Nunca lanca: erro vira health.lastError e lista vazia.

import {
  SCAN_LIMITS,
  NOISE_EXACT,
  NOISE_INCLUDES,
  UNREAD_HINTS,
  PINNED_HINTS,
  MUTED_HINTS,
  TIME_LABEL_RE,
  GROUP_JID_RE,
  QUALITY_FLOOR
} from '../core/constants.js';
import { normalizeText, normalizeForMatch, extractJid, nameIdFor, clamp } from '../core/utils.js';
import {
  PANE_STRATEGIES,
  ROW_STRATEGIES,
  scoreCandidate,
  dedupeRows,
  rectOf,
  isVisible,
  elementChildren
} from './strategies.js';

const NOISE_SET = new Set(NOISE_EXACT);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'CANVAS', 'NOSCRIPT', 'TEMPLATE']);
const PROBE_TTL_MS = 8000;
const UNREAD_SUFFIX_RE =
  /[,\s-]*\b\d+\s*(?:mensagens?|mensagem|messages?)?\s*n[aã]o\s*lidas?\b.*$|[,\s-]*\b\d+\s*unread\b.*$/i;

/** Texto de sistema / cabecalho que nunca e nome de contato. */
export function isNoiseText(text) {
  const value = normalizeForMatch(text);
  if (!value) return true;
  if (NOISE_SET.has(value)) return true;
  return NOISE_INCLUDES.some((needle) => value.includes(needle));
}

export function isTimeLabel(text) {
  // sem acento: o WhatsApp escreve "sábado", "terça-feira"…
  return TIME_LABEL_RE.test(normalizeForMatch(text));
}

export function isUnreadLabel(text) {
  const value = normalizeForMatch(text);
  return UNREAD_HINTS.some((hint) => value.includes(hint));
}

function isPureNumber(text) {
  return /^\d{1,4}$/.test(normalizeText(text));
}

/** Remove o sufixo "3 mensagens nao lidas" que o WhatsApp cola no aria-label. */
export function stripUnreadSuffix(text) {
  return normalizeText(String(text ?? '').replace(UNREAD_SUFFIX_RE, ''));
}

/** Candidato pode virar nome de contato? */
function usableName(text) {
  const value = normalizeText(text);
  if (value.length < 1 || value.length > 120) return false;
  if (isNoiseText(value)) return false;
  if (isTimeLabel(value)) return false;
  if (isUnreadLabel(value)) return false;
  if (isPureNumber(value)) return false;
  return true;
}

/** Candidato pode virar previa da ultima mensagem? */
function usablePreview(text) {
  const value = normalizeText(text);
  if (!value || value.length > 240) return false;
  if (isNoiseText(value)) return false;
  if (isTimeLabel(value)) return false;
  if (isUnreadLabel(value)) return false;
  if (isPureNumber(value)) return false;
  return true;
}

/* -------------------------------------------------------------------------- *
 * Extracao de nome por PONTUACAO DE CANDIDATOS.
 *
 * Regra que causou o defeito antigo: "o primeiro [title]/[aria-label] vence".
 * Bastava o WhatsApp renderizar um `<button aria-label="Menu de contexto da
 * conversa">` antes do nome para todos os contatos virarem o rotulo do botao.
 * Agora cada texto candidato e pontuado por: origem, posicao na linha visual,
 * formato do texto, e se o rotulo corresponde a algum texto realmente visivel.
 * Alem disso, um texto que se repete na maioria das linhas e tratado como
 * moldura da interface (boilerplate) e cai para o fim da fila.
 * -------------------------------------------------------------------------- */

/** Roles que nunca carregam nome de contato: sao controles ou icones. */
const DECORATIVE_ROLES = new Set([
  'button', 'img', 'progressbar', 'checkbox', 'switch', 'radio',
  'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'toolbar', 'separator'
]);
const DECORATIVE_TAGS = new Set(['BUTTON', 'SVG', 'PATH']);

/** Penalidade de um texto que aparece igual na maioria das linhas. */
export const BOILERPLATE_PENALTY = 70;
/** Abaixo disto o nome escolhido e considerado suspeito (entra na qualidade). */
export const SUSPECT_SCORE_FLOOR = 30;

function isDecorativeNode(el) {
  if (!el || el.nodeType !== 1) return false;
  if (DECORATIVE_TAGS.has(el.tagName)) return true;
  if (typeof el.getAttribute !== 'function') return false;
  if (el.getAttribute('data-icon') != null) return true;
  return DECORATIVE_ROLES.has(String(el.getAttribute('role') || '').toLowerCase());
}

/**
 * Uma unica varredura por linha coleta rotulos (`title`/`aria-label`) e
 * fragmentos de texto, na mesma ordem de documento. Rotulos que moram dentro
 * de botao/icone ficam marcados como decorativos; texto visivel nunca e
 * decorativo (uma linha inteira pode ser um `<button>`).
 */
export function scanRowNodes(row, options = {}) {
  const maxFragments = options.maxFragments ?? SCAN_LIMITS.maxTextFragmentsPerRow;
  const maxNodes = options.maxNodes ?? SCAN_LIMITS.maxNodesPerRow;
  const labels = [];
  const fragments = [];
  let order = 0;
  let visited = 0;

  const pushLabel = (el, attr, decorative) => {
    const text = normalizeText(el?.getAttribute?.(attr));
    if (!text) return;
    labels.push({ text, el, attr, decorative, order });
    order += 1;
  };

  pushLabel(row, 'title', false);
  pushLabel(row, 'aria-label', false);

  const walk = (node, depth, decorative) => {
    if (depth > 12 || visited >= maxNodes) return;
    const children = node?.childNodes;
    if (!children) return;
    for (let i = 0; i < children.length; i += 1) {
      if (visited >= maxNodes) return;
      const child = children[i];
      if (child.nodeType === 3) {
        if (fragments.length >= maxFragments) continue;
        const text = normalizeText(child.nodeValue);
        if (!text) continue;
        const last = fragments[fragments.length - 1];
        if (last && last.text === text) continue;
        fragments.push({ text, el: node, order, decorative: false });
        order += 1;
        continue;
      }
      if (child.nodeType !== 1 || SKIP_TAGS.has(child.tagName)) continue;
      visited += 1;
      const dec = decorative || isDecorativeNode(child);
      pushLabel(child, 'title', dec);
      pushLabel(child, 'aria-label', dec);
      walk(child, depth + 1, dec);
    }
  };
  walk(row, 0, false);
  return { labels, fragments };
}

/** Formato do texto: iniciais de avatar e frases longas nao sao nome. */
function textShapeScore(text) {
  let score = 0;
  const words = text.split(' ').filter(Boolean);
  if (/^[\p{Lu}\p{N}]{1,3}$/u.test(text)) score -= 30;
  if (text.length > 60) score -= 18;
  if (text.length > 100) score -= 12;
  if (/[.!?…]$/.test(text)) score -= 6;
  if (words.length >= 2 && words.length <= 6) score += 6;
  if (/^[\p{Lu}\p{N}+]/u.test(text)) score += 4;
  return score;
}

/** Nome vive na primeira linha visual; previa e horario, embaixo. */
function verticalScore(el, rowRect) {
  if (!rowRect || rowRect.height <= 0) return 0;
  const rect = rectOf(el);
  if (rect.height <= 0) return 0;
  const center = rect.top + rect.height / 2 - rowRect.top;
  return center / rowRect.height <= 0.5 ? 14 : -14;
}

/**
 * @returns {Array<{text,key,kind,score,el,order,decorative}>} candidatos a nome
 */
export function buildNameCandidates(row, scan) {
  const rowRect = rectOf(row);
  const fragmentKeys = new Set(scan.fragments.map((f) => normalizeForMatch(f.text)));
  const byKey = new Map();

  const push = (item, kind) => {
    const text = stripUnreadSuffix(item.text);
    if (!usableName(text)) return;
    const key = normalizeForMatch(text);
    let score = 50 + textShapeScore(text) + verticalScore(item.el, rowRect);
    score -= Math.min(6, item.order * 0.25);
    if (kind === 'title') score += 10;
    else if (kind === 'aria') score += 6;
    // rotulo que nao corresponde a nenhum texto visivel da linha e suspeito
    if (kind !== 'text') score += fragmentKeys.has(key) ? 12 : -28;
    const candidate = {
      text,
      key,
      kind,
      score: Math.round(score),
      el: item.el,
      order: item.order,
      decorative: item.decorative === true
    };
    const previous = byKey.get(key);
    if (!previous || candidate.score > previous.score) byKey.set(key, candidate);
  };

  for (const label of scan.labels) push(label, label.attr === 'title' ? 'title' : 'aria');
  for (const fragment of scan.fragments) push(fragment, 'text');

  // Rotulo de controle e descartado, ponto. Se a linha inteira for um
  // `<button>`, o nome ainda chega pelos fragmentos de texto (que nunca sao
  // decorativos) e pelo rotulo da propria linha (idem).
  return [...byKey.values()].filter((c) => !c.decorative);
}

/**
 * Texto que se repete na maioria das linhas e moldura da interface, nao nome.
 * E a defesa contra o rotulo concorrente que ninguem previu.
 * @param {Array<Array<object>>} candidateLists
 * @returns {Map<string, number>}
 */
export function boilerplatePenalties(candidateLists) {
  const total = candidateLists.length;
  const out = new Map();
  if (total < 3) return out;
  const counts = new Map();
  for (const list of candidateLists) {
    const seen = new Set();
    for (const candidate of list) {
      if (seen.has(candidate.key)) continue;
      seen.add(candidate.key);
      counts.set(candidate.key, (counts.get(candidate.key) || 0) + 1);
    }
  }
  for (const [key, count] of counts) {
    if (count >= 3 && count >= total * 0.5) out.set(key, BOILERPLATE_PENALTY);
  }
  return out;
}

/** @returns {{text,score,penalty,suspect}|null} */
export function pickNameCandidate(candidates, penalties) {
  let best = null;
  let bestRaw = null;
  for (const candidate of candidates || []) {
    const penalty = (penalties && penalties.get(candidate.key)) || 0;
    const score = candidate.score - penalty;
    if (!best || score > best.score) best = { ...candidate, score, penalty };
    if (!bestRaw || candidate.score > bestRaw.score) bestRaw = candidate;
  }
  if (!best) return null;
  // Se o boilerplate trocou o vencedor, a linha foi "salva" — mas alguma coisa
  // no layout mudou e o usuario precisa saber (entra na qualidade).
  best.suspect =
    best.penalty > 0
    || best.score < SUSPECT_SCORE_FLOOR
    || Boolean(bestRaw && bestRaw.key !== best.key);
  return best;
}

function pickPreview(labels, fragments, name) {
  const source = fragments.length > 1 ? fragments : labels.filter((l) => !l.decorative);
  const pool = source
    .map((item) => normalizeText(item.text))
    .filter(usablePreview)
    .filter((text) => text !== name);
  if (pool.length === 0) return '';
  return pool[pool.length - 1];
}

function pickTimeLabel(labels, fragments) {
  for (const item of fragments) {
    if (isTimeLabel(item.text)) return normalizeText(item.text);
  }
  for (const item of labels) {
    if (item.decorative) continue;
    if (isTimeLabel(item.text)) return normalizeText(item.text);
  }
  return '';
}

function readUnread(labels, fragments) {
  let hinted = false;
  for (const item of labels) {
    if (!isUnreadLabel(item.text)) continue;
    hinted = true;
    const match = normalizeText(item.text).match(/\d+/);
    if (match) return Number(match[0]) || 0;
  }
  // badge numerico pequeno (<= 40x40)
  for (const item of fragments) {
    if (!isPureNumber(item.text)) continue;
    const rect = rectOf(item.el);
    if (rect.width > 0 && rect.width <= 40 && rect.height > 0 && rect.height <= 40) {
      return Number(item.text) || 0;
    }
    // sem layout (harness/stub) o proprio formato ja e um sinal
    if (rect.width === 0 && rect.height === 0 && Number(item.text) > 0) return Number(item.text);
  }
  return hinted ? 1 : 0;
}

function readIcons(row) {
  let nodes = [];
  try {
    nodes = Array.prototype.slice.call(row.querySelectorAll('[data-icon]'));
  } catch {
    nodes = [];
  }
  const icons = nodes.map((el) => String(el.getAttribute('data-icon') || '').toLowerCase());
  return {
    pinned: icons.some((i) => i.includes('pin')),
    muted: icons.some((i) => i.includes('mute')),
    group: icons.some((i) => i.includes('group'))
  };
}

function readAvatar(row) {
  let img = null;
  try {
    img = row.querySelector('img');
  } catch {
    img = null;
  }
  if (!img) return '';
  const src = normalizeText(img.currentSrc || img.getAttribute?.('src') || img.src);
  return src && src !== 'undefined' ? src : '';
}

/** Identidade em camadas: jid > data-* estavel > hash do nome. */
function resolveIdentity(row, name) {
  const attrs = ['data-id', 'data-jid', 'data-chatid'];
  for (const attr of attrs) {
    let value = row.getAttribute?.(attr) || '';
    if (!value) {
      let holder = null;
      try {
        holder = row.querySelector(`[${attr}]`);
      } catch {
        holder = null;
      }
      value = holder?.getAttribute?.(attr) || '';
    }
    const jid = extractJid(value);
    if (jid) return { id: jid, idKind: 'jid' };
  }
  // id de DOM so serve se for realmente unico por linha
  for (const attr of ['data-testid', 'data-chat-id', 'id']) {
    const value = normalizeText(row.getAttribute?.(attr));
    if (value && value.length >= 6 && /\d/.test(value) && !/^cell-|^chat-list$/i.test(value)) {
      return { id: `dom:${value}`, idKind: 'dom' };
    }
  }
  return { id: nameIdFor(name), idKind: 'name' };
}

/**
 * @param {{logger?: object, doc?: Document, win?: Window}} [options]
 */
export function createWhatsAppAdapter(options = {}) {
  const logger = options.logger || null;
  const doc = options.doc || (typeof document !== 'undefined' ? document : null);
  const win = options.win || doc?.defaultView || (typeof window !== 'undefined' ? window : null);

  let pane = null;
  let paneStrategy = null;
  let rowStrategy = null;
  let paneScore = 0;
  let paneFloor = 0; // indice inicial da cadeia (avanca na auto-recuperacao)
  let emptyStreak = 0;
  let recoveries = 0;
  let lastTried = [];
  let lastListMs = 0;
  /** Qualidade da ultima extracao (null = ainda nao houve leitura). */
  let quality = null;
  const paneChangeListeners = new Set();

  const health = {
    ok: false,
    strategy: null,
    confidence: 0,
    rowsFound: 0,
    lastProbeAt: 0,
    lastError: null,
    degraded: false,
    quality: null
  };

  /** Elementos vivos da ultima leitura, para o composer clicar. */
  let rowIndex = new Map();

  function log(level, ...args) {
    if (logger && typeof logger[level] === 'function') logger[level](...args);
  }

  function root() {
    return doc || null;
  }

  /**
   * Confianca = "consigo ler" x "li certo". O segundo fator vem do conteudo
   * extraido (ver measureQuality); sem ele a extensao reportava "Leitura ok"
   * com 100% dos nomes errados.
   */
  function computeConfidence(rowsFound) {
    if (!pane || !paneStrategy || !rowStrategy) return 0;
    const paneWeight = paneStrategy.weight ?? 0.5;
    const rowWeight = rowStrategy.weight ?? 0.5;
    const strategyScore = (paneScore / 100) * paneWeight * 0.5 + rowWeight * 0.5;
    const volume = Math.min(1, rowsFound / 8);
    const base = 55 * strategyScore + 20 * volume + 25;
    const factor = quality == null ? 0.8 : 0.1 + 0.9 * quality.value;
    return Math.max(0, Math.min(100, Math.round(base * factor)));
  }

  /** Degradado mede o RESULTADO: estrategia fraca com leitura perfeita nao e. */
  function refreshDegraded() {
    health.quality = quality ? Number(quality.value.toFixed(3)) : null;
    health.degraded =
      !health.ok || (quality != null && quality.value < QUALITY_FLOOR) || health.confidence < 45;
  }

  function replacePane(nextPane) {
    const previous = pane;
    pane = nextPane || null;
    if (pane === previous) return;
    for (const listener of [...paneChangeListeners]) {
      queueMicrotask(() => {
        try {
          listener(pane, previous);
        } catch (error) {
          log('error', 'listener de troca do painel falhou', error);
        }
      });
    }
  }

  function findRows(candidatePane) {
    for (const strategy of ROW_STRATEGIES) {
      let found = [];
      try {
        found = strategy.find(candidatePane) || [];
      } catch (error) {
        health.lastError = `row:${strategy.id}: ${error?.message || error}`;
        found = [];
      }
      const rows = dedupeRows(found.filter((el) => el && el.nodeType === 1));
      if (rows.length > 0) return { rows, strategy };
    }
    return { rows: [], strategy: null };
  }

  function fullProbe() {
    const scope = root();
    const tried = [];
    if (!scope) return { ok: false, tried };
    let fallback = null;
    const total = PANE_STRATEGIES.length;

    for (let step = 0; step < total; step += 1) {
      const index = (paneFloor + step) % total;
      const strategy = PANE_STRATEGIES[index];
      let candidates = [];
      try {
        candidates = strategy.find(scope) || [];
      } catch (error) {
        health.lastError = `pane:${strategy.id}: ${error?.message || error}`;
        candidates = [];
      }
      const scored = candidates
        .filter((el) => el && el.nodeType === 1 && isVisible(el))
        .map((el) => ({ el, score: scoreCandidate(el, 'pane') }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      tried.push({ strategy: strategy.id, candidates: candidates.length, bestScore: scored[0]?.score ?? 0 });

      for (const candidate of scored) {
        const found = findRows(candidate.el);
        if (found.rows.length > 0) {
          return {
            ok: true,
            pane: candidate.el,
            paneScore: candidate.score,
            paneStrategy: strategy,
            rowStrategy: found.strategy,
            rows: found.rows,
            tried
          };
        }
        if (!fallback || candidate.score > fallback.paneScore) {
          fallback = {
            ok: false,
            pane: candidate.el,
            paneScore: candidate.score,
            paneStrategy: strategy,
            rowStrategy: null,
            rows: [],
            tried
          };
        }
      }
    }
    return fallback || { ok: false, pane: null, paneScore: 0, paneStrategy: null, rowStrategy: null, rows: [], tried };
  }

  function snapshot() {
    return {
      ok: health.ok,
      pane,
      strategy: health.strategy,
      confidence: health.confidence,
      rowsFound: health.rowsFound,
      at: health.lastProbeAt
    };
  }

  /** @param {boolean} force ignora o cache e refaz a busca do painel */
  function probe(force = false) {
    const at = Date.now();
    try {
      const stillValid =
        !force && pane && pane.isConnected !== false && at - health.lastProbeAt < PROBE_TTL_MS && health.ok;
      if (stillValid) return snapshot();

      const result = fullProbe();
      lastTried = result.tried || [];
      replacePane(result.pane || null);
      paneStrategy = result.paneStrategy || null;
      rowStrategy = result.rowStrategy || null;
      paneScore = result.paneScore || 0;
      health.ok = Boolean(result.ok);
      health.rowsFound = result.rows?.length || 0;
      health.strategy = paneStrategy
        ? `${paneStrategy.id}/${rowStrategy ? rowStrategy.id : 'nenhuma'}`
        : null;
      health.confidence = computeConfidence(health.rowsFound);
      health.lastProbeAt = at;
      refreshDegraded();
      if (!health.ok) {
        health.lastError = health.lastError || 'Lista de conversas não encontrada.';
      } else {
        health.lastError = null;
      }
      return snapshot();
    } catch (error) {
      health.ok = false;
      health.lastError = String(error?.message || error);
      health.lastProbeAt = at;
      health.degraded = true;
      log('error', 'probe falhou', error);
      return snapshot();
    }
  }

  /** Desce um degrau na cadeia de estrategias e refaz o probe. */
  function recover() {
    paneFloor = (paneFloor + 1) % PANE_STRATEGIES.length;
    recoveries += 1;
    health.degraded = true;
    log('warn', 'lista vazia duas vezes seguidas; descendo de estratégia', { paneFloor });
    return probe(true);
  }

  function scanRow(row) {
    const scan = scanRowNodes(row);
    return { row, scan, candidates: buildNameCandidates(row, scan) };
  }

  function buildChat(scanned, index, usedIds, penalties) {
    const { row, scan } = scanned;
    const labels = scan.labels;
    const fragments = scan.fragments;
    const best = pickNameCandidate(scanned.candidates, penalties);
    const name = best ? best.text : '';
    if (!name) return null;

    const identity = resolveIdentity(row, name);
    let id = identity.id;
    let idKind = identity.idKind;
    // dois nos com o mesmo id (data-testid generico) nao podem virar um so card
    if (usedIds.has(id)) {
      const alternative = nameIdFor(`${name}#${index}`);
      if (idKind !== 'jid') {
        id = alternative;
        idKind = 'name';
      } else {
        return null;
      }
    }
    usedIds.add(id);

    const icons = readIcons(row);
    return {
      id,
      idKind,
      name,
      avatarUrl: readAvatar(row),
      preview: pickPreview(labels, fragments, name),
      unread: readUnread(labels, fragments),
      isGroup: GROUP_JID_RE.test(id) || icons.group,
      muted: icons.muted || labels.some((l) => MUTED_HINTS.some((h) => normalizeForMatch(l.text).includes(h))),
      pinned: icons.pinned || labels.some((l) => PINNED_HINTS.some((h) => normalizeForMatch(l.text).includes(h))),
      timeLabel: pickTimeLabel(labels, fragments),
      inboxOrder: index
    };
  }

  function mapRows(rows) {
    const usedIds = new Set();
    const chats = [];
    const index = new Map();
    const scanned = [];
    const limit = Math.min(rows.length, SCAN_LIMITS.maxRows);

    for (let i = 0; i < limit; i += 1) {
      try {
        scanned.push(scanRow(rows[i]));
      } catch (error) {
        health.lastError = `row:${error?.message || error}`;
      }
    }
    const penalties = boilerplatePenalties(scanned.map((s) => s.candidates));

    let suspects = 0;
    for (const item of scanned) {
      let chat = null;
      try {
        const best = pickNameCandidate(item.candidates, penalties);
        chat = buildChat(item, chats.length, usedIds, penalties);
        if (chat && best && best.suspect) suspects += 1;
      } catch (error) {
        health.lastError = `row:${error?.message || error}`;
        chat = null;
      }
      if (!chat) continue;
      chats.push(chat);
      index.set(chat.id, item.row);
      const nameKey = normalizeForMatch(chat.name);
      if (nameKey && !index.has(nameKey)) index.set(nameKey, item.row);
    }
    rowIndex = index;
    quality = measureQuality(scanned.length, chats, suspects);
    return chats;
  }

  /**
   * Qualidade do RESULTADO (0..1), nao da estrategia usada. Nomes repetidos
   * entre linhas sao o sinal mais forte de rotulo envenenado; linhas que nao
   * viraram conversa e nomes escolhidos com pontuacao baixa tambem contam.
   */
  function measureQuality(rowsSeen, chats, suspects) {
    if (rowsSeen <= 0) return { value: 0, rowsSeen: 0, mapped: 0, duplicates: 0, suspects: 0 };
    const mapped = chats.length;
    const names = chats.map((c) => normalizeForMatch(c.name)).filter(Boolean);
    const unique = new Set(names).size;
    const duplicates = names.length - unique;
    const dup = mapped > 0 ? duplicates / mapped : 1;
    const miss = 1 - mapped / rowsSeen;
    const suspect = mapped > 0 ? suspects / mapped : 1;
    const value = clamp(1 - (dup + 0.6 * miss + 0.5 * suspect), 0, 1);
    return { value, rowsSeen, mapped, duplicates, suspects };
  }

  /** @returns {Array} lista de Chat; nunca lanca. */
  function listChats() {
    const started = Date.now();
    try {
      if (!pane || pane.isConnected === false) probe(true);
      if (!pane) {
        emptyStreak += 1;
        if (emptyStreak >= 2) recover();
        return [];
      }

      let found = findRows(pane);
      if (found.rows.length === 0) {
        emptyStreak += 1;
        if (emptyStreak >= 2) {
          recover();
          found = pane ? findRows(pane) : { rows: [], strategy: null };
        }
      }
      if (found.strategy) rowStrategy = found.strategy;

      const chats = mapRows(found.rows);
      if (chats.length > 0) {
        emptyStreak = 0;
        // deu certo: o proximo ciclo de falhas recomeca pela estrategia mais forte
        paneFloor = 0;
        health.ok = true;
        health.lastError = null;
      } else {
        emptyStreak += 1;
        health.ok = false;
      }
      health.rowsFound = chats.length;
      health.strategy = paneStrategy
        ? `${paneStrategy.id}/${rowStrategy ? rowStrategy.id : 'nenhuma'}`
        : null;
      health.confidence = computeConfidence(chats.length);
      refreshDegraded();
      lastListMs = Date.now() - started;
      return chats;
    } catch (error) {
      health.ok = false;
      health.lastError = String(error?.message || error);
      health.degraded = true;
      health.quality = 0;
      lastListMs = Date.now() - started;
      log('error', 'listChats falhou', error);
      return [];
    }
  }

  /** Elemento vivo da linha (usado pelo composer). */
  function getRowElement(idOrName) {
    if (!idOrName) return null;
    const direct = rowIndex.get(idOrName);
    if (direct && direct.isConnected !== false) return direct;
    const byName = rowIndex.get(normalizeForMatch(idOrName));
    return byName && byName.isConnected !== false ? byName : null;
  }

  /**
   * Observer escopado no painel, com throttle >= 400 ms.
   * @returns {() => void} stop
   */
  function observe(cb) {
    if (typeof cb !== 'function') return () => {};
    let stopped = false;
    let observer = null;
    let timer = null;
    let idleHandle = null;
    let retryTimer = null;
    let watchdogTimer = null;
    let lastRun = 0;
    let observedPane = null;
    let parentObserver = null;

    const runCallback = () => {
      idleHandle = null;
      timer = null;
      if (stopped) return;
      lastRun = Date.now();
      try {
        cb();
      } catch (error) {
        log('error', 'callback do observer falhou', error);
      }
    };

    const schedule = () => {
      if (stopped || timer || idleHandle) return;
      const wait = Math.max(SCAN_LIMITS.observeThrottleMs - (Date.now() - lastRun), 0);
      timer = setTimeout(() => {
        timer = null;
        if (stopped) return;
        if (win && typeof win.requestIdleCallback === 'function') {
          idleHandle = win.requestIdleCallback(runCallback, { timeout: SCAN_LIMITS.observeIdleTimeoutMs });
        } else if (win && typeof win.requestAnimationFrame === 'function') {
          idleHandle = win.requestAnimationFrame(runCallback);
        } else {
          runCallback();
        }
      }, wait || SCAN_LIMITS.observeThrottleMs);
    };

    const attach = () => {
      if (stopped) return;
      if (!pane || pane.isConnected === false) probe(true);
      if (!pane) {
        // sem painel: tenta de novo mais tarde em vez de observar o body inteiro
        retryTimer = setTimeout(attach, 2000);
        return;
      }
      if (observer && observedPane === pane) return;
      detachObserver();
      const Observer = win?.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
      if (!Observer) return;
      observedPane = pane;
      observer = new Observer(() => {
        if (stopped) return;
        if (pane && pane.isConnected === false) {
          detachObserver();
          probe(true);
          attach();
        }
        schedule();
      });
      try {
        observer.observe(pane, { childList: true, subtree: true });
      } catch (error) {
        log('warn', 'nao foi possivel observar o painel', error);
      }
      // O painel sendo REMOVIDO e uma mutacao do pai, nao dele mesmo. Sem este
      // observador (childList, sem subtree) a troca so seria notada pelo
      // watchdog, segundos depois. Nunca escala para body/documentElement.
      const parent = pane.parentElement;
      const doc2 = doc || null;
      const tooBroad = !parent || parent === doc2?.body || parent === doc2?.documentElement;
      if (!tooBroad) {
        try {
          parentObserver = new Observer(() => {
            if (stopped) return;
            if (observedPane && observedPane.isConnected === false) {
              detachObserver();
              probe(true);
              attach();
            }
            schedule();
          });
          parentObserver.observe(parent, { childList: true });
        } catch (error) {
          log('warn', 'nao foi possivel observar o container do painel', error);
        }
      }
      schedule();
    };

    function detachObserver() {
      if (observer) {
        try {
          observer.disconnect();
        } catch {
          /* ja desconectado */
        }
        observer = null;
      }
      if (parentObserver) {
        try {
          parentObserver.disconnect();
        } catch {
          /* ja desconectado */
        }
        parentObserver = null;
      }
      observedPane = null;
    }

    const onPaneChange = () => {
      if (stopped) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      attach();
      schedule();
    };

    paneChangeListeners.add(onPaneChange);

    attach();

    const checkObservedPane = () => {
      watchdogTimer = null;
      if (stopped) return;
      if (observedPane && observedPane.isConnected === false) {
        detachObserver();
        probe(true);
        attach();
        schedule();
      }
      watchdogTimer = setTimeout(checkObservedPane, 2000);
    };
    watchdogTimer = setTimeout(checkObservedPane, 2000);

    return function stop() {
      stopped = true;
      paneChangeListeners.delete(onPaneChange);
      detachObserver();
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (idleHandle && win) {
        if (typeof win.cancelIdleCallback === 'function') win.cancelIdleCallback(idleHandle);
        else if (typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(idleHandle);
      }
      timer = null;
      retryTimer = null;
      watchdogTimer = null;
      idleHandle = null;
    };
  }

  function parseRgb(value) {
    const match = String(value || '').match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1].split(',').map((n) => parseFloat(n.trim()));
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }

  /** Tema do WhatsApp: classe/atributo primeiro, luminancia como confirmacao. */
  function getTheme() {
    try {
      const el = doc?.documentElement;
      const body = doc?.body;
      const tokens = `${el?.className || ''} ${body?.className || ''} ${el?.getAttribute?.('data-theme') || ''}`.toLowerCase();
      if (/\bdark\b/.test(tokens)) return 'dark';
      if (/\blight\b/.test(tokens)) return 'light';
      const style = win && typeof win.getComputedStyle === 'function' && body ? win.getComputedStyle(body) : null;
      const rgb = parseRgb(style?.backgroundColor);
      if (rgb) {
        const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
        return luminance < 0.5 ? 'dark' : 'light';
      }
      if (win?.matchMedia) {
        return win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
    } catch (error) {
      log('warn', 'getTheme falhou', error);
    }
    return 'light';
  }

  function describeElement(el) {
    if (!el) return null;
    const rect = rectOf(el);
    return {
      tag: el.tagName,
      id: el.id || null,
      role: el.getAttribute?.('role') || null,
      ariaLabel: el.getAttribute?.('aria-label') || null,
      children: elementChildren(el).length,
      rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) }
    };
  }

  function diagnostics() {
    return {
      health: { ...health },
      paneStrategy: paneStrategy?.id || null,
      rowStrategy: rowStrategy?.id || null,
      paneScore,
      paneFloor,
      recoveries,
      emptyStreak,
      lastListMs,
      quality: quality
        ? {
          valor: Number(quality.value.toFixed(3)),
          linhasLidas: quality.rowsSeen,
          conversas: quality.mapped,
          nomesDuplicados: quality.duplicates,
          nomesSuspeitos: quality.suspects
        }
        : null,
      triedStrategies: lastTried,
      pane: describeElement(pane),
      theme: getTheme(),
      strategies: {
        pane: PANE_STRATEGIES.map((s) => ({ id: s.id, weight: s.weight })),
        row: ROW_STRATEGIES.map((s) => ({ id: s.id, weight: s.weight }))
      }
    };
  }

  /** Zera o aprendizado (usado pelo botao "rediagnosticar"). */
  function reset() {
    paneFloor = 0;
    emptyStreak = 0;
    recoveries = 0;
    quality = null;
    health.quality = null;
    replacePane(null);
    return probe(true);
  }

  return {
    probe,
    listChats,
    observe,
    getTheme,
    getRowElement,
    diagnostics,
    reset,
    get health() {
      return { ...health };
    },
    get pane() {
      return pane;
    }
  };
}
