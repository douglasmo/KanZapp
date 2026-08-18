/**
 * h.js — construção de DOM segura (hyperscript).
 *
 * Regra estrutural: nenhum caminho deste módulo aceita HTML como string.
 * Todo filho string vira `document.createTextNode`, portanto é impossível
 * injetar markup por aqui (P1 do contrato). Chaves de props que tentem
 * escrever HTML (`innerHTML`, `outerHTML`, `html`, `dangerouslySetInnerHTML`)
 * lançam erro em vez de serem ignoradas silenciosamente.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

// Props que carregam URL: sempre passam pelo saneamento, mesmo quando o
// atributo poderia ser escrito como propriedade do elemento.
const URL_PROPS = new Set(['src', 'href', 'action', 'formaction', 'poster', 'data', 'xlink:href']);

// Bloqueia esquemas executáveis. `blob:`, `https:` e `data:image/*` (avatares
// do WhatsApp) continuam válidos.
const DANGEROUS_URL = /^\s*(javascript|vbscript)\s*:/i;
const DANGEROUS_DATA = /^\s*data:(?!image\/)/i;

const FORBIDDEN_PROPS = new Set(['innerHTML', 'outerHTML', 'html', 'dangerouslySetInnerHTML', 'srcdoc']);

function sanitizeUrl(value) {
  const str = String(value);
  if (DANGEROUS_URL.test(str) || DANGEROUS_DATA.test(str)) return '';
  return str;
}

function classToString(value) {
  if (value == null || value === false) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(classToString).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return Object.keys(value).filter((k) => value[k]).join(' ');
  }
  return String(value);
}

function applyStyle(el, style) {
  if (!style) return;
  if (typeof style !== 'object') {
    throw new TypeError('h(): a prop "style" aceita apenas objeto, não string.');
  }
  for (const key of Object.keys(style)) {
    const value = style[key];
    if (value == null || value === false) {
      el.style.removeProperty(key);
      continue;
    }
    if (key.startsWith('--') || key.includes('-')) el.style.setProperty(key, String(value));
    else el.style[key] = String(value);
  }
}

function eventNameOf(key) {
  // onClick -> click ; onPointerDownCapture -> pointerdown (capture)
  let name = key.slice(2);
  let capture = false;
  if (name.endsWith('Capture')) {
    name = name.slice(0, -'Capture'.length);
    capture = true;
  }
  return { name: name.toLowerCase(), capture };
}

function setAttr(el, key, value) {
  if (value == null || value === false) {
    el.removeAttribute(key);
    return;
  }
  el.setAttribute(key, value === true ? '' : String(value));
}

function applyProps(el, props, isSvg) {
  if (!props) return;
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (FORBIDDEN_PROPS.has(key)) {
      throw new TypeError(`h(): a prop "${key}" é proibida — use filhos de texto ou nós.`);
    }
    if (value === undefined) continue;

    if (key === 'class' || key === 'className') {
      const cls = classToString(value);
      if (cls) setAttr(el, 'class', cls);
      else el.removeAttribute('class');
      continue;
    }
    if (key === 'style') {
      applyStyle(el, value);
      continue;
    }
    if (key === 'dataset') {
      for (const dk of Object.keys(value || {})) {
        const dv = value[dk];
        if (dv == null || dv === false) delete el.dataset[dk];
        else el.dataset[dk] = String(dv);
      }
      continue;
    }
    if (key === 'attrs') {
      for (const ak of Object.keys(value || {})) {
        if (/^on/i.test(ak)) {
          throw new TypeError(`h(): atributo de evento "${ak}" não é permitido em attrs — use on${ak.slice(2)}.`);
        }
        setAttr(el, ak, URL_PROPS.has(ak.toLowerCase()) ? sanitizeUrl(value[ak]) : value[ak]);
      }
      continue;
    }
    if (key === 'ref') {
      if (typeof value === 'function') value(el);
      else if (value && typeof value === 'object') value.current = el;
      continue;
    }
    if (key.length > 2 && key.startsWith('on') && key[2] === key[2].toUpperCase() && typeof value === 'function') {
      const { name, capture } = eventNameOf(key);
      el.addEventListener(name, value, capture ? { capture: true } : false);
      continue;
    }
    if (URL_PROPS.has(key.toLowerCase())) {
      setAttr(el, key, sanitizeUrl(value));
      continue;
    }
    if (!isSvg && typeof value !== 'object' && key in el && key !== 'list' && key !== 'form') {
      // Propriedades reais (value, checked, disabled, textContent, tabIndex…)
      try {
        el[key] = value;
        continue;
      } catch {
        /* cai para setAttribute */
      }
    }
    setAttr(el, key, value);
  }
}

function append(parent, children) {
  for (const child of children) {
    if (child == null || child === false || child === true || child === '') continue;
    if (Array.isArray(child)) {
      append(parent, child);
      continue;
    }
    if (child instanceof Node) {
      parent.appendChild(child);
      continue;
    }
    // Qualquer outra coisa vira texto. É aqui que o XSS morre.
    parent.appendChild(document.createTextNode(String(child)));
  }
}

function isProps(value) {
  return value != null
    && typeof value === 'object'
    && !Array.isArray(value)
    && !(value instanceof Node);
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (isProps(props)) applyProps(el, props, false);
  else if (props != null) children.unshift(props);
  append(el, children);
  return el;
}

export function svg(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (isProps(props)) applyProps(el, props, true);
  else if (props != null) children.unshift(props);
  append(el, children);
  return el;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Atualiza texto só quando muda — evita invalidar layout à toa no diff. */
export function setText(node, value) {
  const next = value == null ? '' : String(value);
  if (node && node.textContent !== next) node.textContent = next;
  return node;
}

/* ------------------------------------------------------------------ *
 * Ícones: SVG inline, traçado `currentColor`. Nada de emoji em botão.
 * Cada ícone é uma lista de primitivas estáticas (sem dado dinâmico).
 * ------------------------------------------------------------------ */
const ICONS = {
  search: [['path', 'M11 3.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z'], ['path', 'M20.5 20.5 16.4 16.4']],
  close: [['path', 'M6 6l12 12'], ['path', 'M18 6 6 18']],
  plus: [['path', 'M12 5v14'], ['path', 'M5 12h14']],
  minus: [['path', 'M5 12h14']],
  refresh: [['path', 'M20.5 12a8.5 8.5 0 1 1-2.5-6'], ['path', 'M20.5 3.5V9H15']],
  tag: [['path', 'M20.6 13.4 12.9 21a1.5 1.5 0 0 1-2.1 0l-7.3-7.3A1.5 1.5 0 0 1 3 12.6V4.5A1.5 1.5 0 0 1 4.5 3h8.1c.4 0 .8.2 1 .4l7 7a1.5 1.5 0 0 1 0 2z'], ['circle', 7.6, 7.6, 1.4]],
  message: [['path', 'M21 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-5 4V5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5z']],
  bell: [['path', 'M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 7-2.5 8.5h17c0-1.5-2.5-2-2.5-8.5z'], ['path', 'M13.8 20.5a2 2 0 0 1-3.6 0']],
  note: [['path', 'M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z'], ['path', 'M14 3v5h5'], ['path', 'M8.5 13h7'], ['path', 'M8.5 16.5h4.5']],
  settings: [['circle', 12, 12, 3.2], ['path', 'M19.2 14.6a1.4 1.4 0 0 0 .3 1.6l.1.1a1.8 1.8 0 1 1-2.5 2.5l-.1-.1a1.4 1.4 0 0 0-2.4 1v.2a1.8 1.8 0 1 1-3.6 0v-.1a1.4 1.4 0 0 0-2.4-1l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.4 1.4 0 0 0-1-2.4H5a1.8 1.8 0 1 1 0-3.6h.1a1.4 1.4 0 0 0 1-2.4l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.4 1.4 0 0 0 2.4-1V4a1.8 1.8 0 1 1 3.6 0v.1a1.4 1.4 0 0 0 2.4 1l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.4 1.4 0 0 0 1 2.4h.2a1.8 1.8 0 1 1 0 3.6H20a1.4 1.4 0 0 0-1.3.9z']],
  trash: [['path', 'M4 6.5h16'], ['path', 'M9.5 6.5v-2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2'], ['path', 'M6.5 6.5v13a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-13'], ['path', 'M10 10.5v6'], ['path', 'M14 10.5v6']],
  edit: [['path', 'M12.5 20.5H21'], ['path', 'M16.2 3.8a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z']],
  chevronDown: [['path', 'M6 9.5 12 15l6-5.5']],
  chevronRight: [['path', 'M9.5 5.5 15.5 12l-6 6.5']],
  chevronLeft: [['path', 'M14.5 5.5 8.5 12l6 6.5']],
  warning: [['path', 'M10.3 3.9 2 18.1A2 2 0 0 0 3.7 21h16.6a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0z'], ['path', 'M12 9v4.5'], ['path', 'M12 17.2h.01']],
  check: [['path', 'M20 6.5 9.5 17 4 11.5']],
  download: [['path', 'M21 15.5v3A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5v-3'], ['path', 'M7.5 10.5 12 15l4.5-4.5'], ['path', 'M12 3v12']],
  upload: [['path', 'M21 15.5v3A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5v-3'], ['path', 'M7.5 7.5 12 3l4.5 4.5'], ['path', 'M12 3v12']],
  grip: [['circle', 9, 6, 1.3], ['circle', 15, 6, 1.3], ['circle', 9, 12, 1.3], ['circle', 15, 12, 1.3], ['circle', 9, 18, 1.3], ['circle', 15, 18, 1.3]],
  filter: [['path', 'M3 5h18l-7 8.2V20l-4 1.5v-8.3z']],
  clock: [['circle', 12, 12, 8.5], ['path', 'M12 7.5V12l3 2']],
  copy: [['path', 'M9.5 9.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z'], ['path', 'M5.5 14.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1']],
  inbox: [['path', 'M21.5 12.5H16l-1.8 3h-4.4l-1.8-3H2.5'], ['path', 'M6 4.5h12l3.5 8v6a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18.5v-6z']],
  archive: [['path', 'M4 3.5h16a1 1 0 0 1 1 1v3H3v-3a1 1 0 0 1 1-1z'], ['path', 'M5 7.5v11a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-11'], ['path', 'M10 12h4']],
  user: [['circle', 12, 8, 4], ['path', 'M4.5 20.5a7.5 7.5 0 0 1 15 0']],
  pulse: [['path', 'M2.5 12H7l2.5-7 5 14L17 12h4.5']],
  sun: [['circle', 12, 12, 4], ['path', 'M12 2.5V5'], ['path', 'M12 19v2.5'], ['path', 'M2.5 12H5'], ['path', 'M19 12h2.5'], ['path', 'M5.3 5.3 7 7'], ['path', 'M17 17l1.7 1.7'], ['path', 'M18.7 5.3 17 7'], ['path', 'M7 17l-1.7 1.7']],
  moon: [['path', 'M21 13.2A8.5 8.5 0 1 1 10.8 3a6.8 6.8 0 0 0 10.2 10.2z']],
  columns: [['path', 'M4 4.5h5.5v15H4z'], ['path', 'M14.5 4.5H20v15h-5.5z']],
  external: [['path', 'M14 4.5h5.5V10'], ['path', 'M19.5 4.5 12 12'], ['path', 'M19 14v5.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-11A1.5 1.5 0 0 1 6.5 7H12']]
};

export function icon(name, { size = 16, className = '' } = {}) {
  const shapes = ICONS[name] || ICONS.warning;
  const node = svg('svg', {
    class: className ? `kz-icon ${className}` : 'kz-icon',
    attrs: {
      viewBox: '0 0 24 24',
      width: String(size),
      height: String(size),
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.7',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false'
    }
  });
  for (const shape of shapes) {
    if (shape[0] === 'circle') {
      node.appendChild(svg('circle', { attrs: { cx: String(shape[1]), cy: String(shape[2]), r: String(shape[3]) } }));
    } else {
      node.appendChild(svg('path', { attrs: { d: shape[1] } }));
    }
  }
  return node;
}

/**
 * Marca do KanZapp: tres colunas ascendentes — o card avancando pelo funil.
 *
 * E preenchida, nao tracada, e por isso nao vive no registro de `icon()`: em
 * 16px um traco de 1.7px praticamente some, e um logo precisa de peso nesse
 * tamanho, que e onde ele mais aparece (barra do navegador, botao flutuante).
 * Uma letra solta dentro de um circulo tambem nao resolve — fica pequena,
 * desalinhada oticamente e sem identidade.
 */
export function brandMark({ size = 20, className = '' } = {}) {
  const node = svg('svg', {
    class: className ? `kz-mark ${className}` : 'kz-mark',
    attrs: {
      viewBox: '0 0 24 24',
      width: String(size),
      height: String(size),
      fill: 'currentColor',
      'aria-hidden': 'true',
      focusable: 'false'
    }
  });
  // mesma linha de base (20.5): a progressao aparece so na altura
  const bars = [
    { x: 3, y: 13.5, height: 7, opacity: '0.5' },
    { x: 9.5, y: 8.75, height: 11.75, opacity: '0.75' },
    { x: 16, y: 4, height: 16.5, opacity: '1' }
  ];
  for (const bar of bars) {
    node.appendChild(svg('rect', {
      attrs: {
        x: String(bar.x),
        y: String(bar.y),
        width: '5',
        height: String(bar.height),
        rx: '2.5',
        opacity: bar.opacity
      }
    }));
  }
  return node;
}

export const iconNames = Object.keys(ICONS);
