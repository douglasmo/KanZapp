/**
 * Mini-DOM para os testes em Node — no espírito do stub que já existia em
 * `tests/unit/strategies.test.mjs`, só que compartilhado e com seletores
 * suficientes para rodar `wa/adapter.js` e `wa/composer.js` de verdade.
 *
 * Suporta: tag, #id, .classe e [attr], [attr="valor"] (inclusive combinados no
 * mesmo compound) separados por vírgula. Nada de combinadores descendentes —
 * o código de produção não usa nenhum.
 */

const VIEW = { innerWidth: 1280, innerHeight: 800 };

function parseCompound(selector) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  let i = 0;
  const sel = selector.trim();
  while (i < sel.length) {
    const char = sel[i];
    if (char === '[') {
      const end = sel.indexOf(']', i);
      const body = sel.slice(i + 1, end);
      const match = body.match(/^([\w:-]+)(?:=?"?([^"\]]*)"?)?$/);
      const hasValue = body.includes('=');
      out.attrs.push({ name: match[1], value: hasValue ? match[2] : null });
      i = end + 1;
      continue;
    }
    if (char === '#' || char === '.') {
      let j = i + 1;
      while (j < sel.length && /[\w-]/.test(sel[j])) j += 1;
      const value = sel.slice(i + 1, j);
      if (char === '#') out.id = value;
      else out.classes.push(value);
      i = j;
      continue;
    }
    let j = i;
    while (j < sel.length && /[\w-]/.test(sel[j])) j += 1;
    if (j === i) {
      i += 1;
      continue;
    }
    out.tag = sel.slice(i, j).toUpperCase();
    i = j;
  }
  return out;
}

function matchesCompound(node, compound) {
  if (compound.tag && node.tagName !== compound.tag) return false;
  if (compound.id && node.id !== compound.id) return false;
  for (const cls of compound.classes) {
    if (!String(node.className || '').split(/\s+/).includes(cls)) return false;
  }
  for (const attr of compound.attrs) {
    const value = node.getAttribute(attr.name);
    if (value == null) return false;
    if (attr.value !== null && value !== attr.value) return false;
  }
  return true;
}

function compile(selector) {
  return String(selector)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseCompound);
}

export function text(value) {
  return { nodeType: 3, nodeValue: String(value) };
}

/**
 * @param {string} tag
 * @param {object} [props] atributos + `rect`, `scrollHeight`, `clientHeight`
 * @param {Array} [children] nós de elemento ou de texto
 */
export function el(tag, props = {}, children = []) {
  const { rect, scrollHeight = 0, clientHeight = 0, ...attrs } = props;
  const box = rect || { top: 0, left: 0, width: 0, height: 0 };
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    attrs: { ...attrs },
    children: [],
    childNodes: [],
    parentElement: null,
    isConnected: true,
    scrollHeight,
    clientHeight,
    ownerDocument: null,
    get id() {
      return node.attrs.id || '';
    },
    get className() {
      return node.attrs.class || '';
    },
    getAttribute: (name) => (name in node.attrs ? String(node.attrs[name]) : null),
    hasAttribute: (name) => name in node.attrs,
    setAttribute: (name, value) => {
      node.attrs[name] = String(value);
    },
    getBoundingClientRect: () => ({
      top: box.top,
      left: box.left,
      width: box.width,
      height: box.height,
      bottom: box.top + box.height,
      right: box.left + box.width
    }),
    querySelectorAll(selector) {
      const compounds = compile(selector);
      const out = [];
      const walk = (parent) => {
        for (const child of parent.children) {
          if (compounds.some((c) => matchesCompound(child, c))) out.push(child);
          walk(child);
        }
      };
      walk(node);
      return out;
    },
    querySelector(selector) {
      return node.querySelectorAll(selector)[0] || null;
    },
    appendChild(child) {
      node.childNodes.push(child);
      if (child.nodeType === 1) {
        node.children.push(child);
        child.parentElement = node;
        child.ownerDocument = node.ownerDocument;
      }
      return child;
    },
    contains(other) {
      let cursor = other;
      while (cursor) {
        if (cursor === node) return true;
        cursor = cursor.parentElement;
      }
      return false;
    },
    closest(selector) {
      const compounds = compile(selector);
      let cursor = node;
      while (cursor) {
        if (compounds.some((c) => matchesCompound(cursor, c))) return cursor;
        cursor = cursor.parentElement;
      }
      return null;
    }
  };
  Object.defineProperty(node, 'textContent', {
    get: () =>
      node.childNodes
        .map((child) => (child.nodeType === 3 ? child.nodeValue : child.textContent))
        .join('')
  });
  for (const child of children) {
    if (!child) continue;
    node.appendChild(child);
  }
  return node;
}

/** Documento mínimo com `getElementById` e a viewport padrão de 1280x800. */
export function makeDocument(root) {
  const doc = {
    defaultView: VIEW,
    documentElement: root,
    body: root,
    getElementById(id) {
      if (root.id === id) return root;
      return root.querySelectorAll(`#${id}`)[0] || null;
    },
    querySelector: (selector) => (matchesRoot(root, selector) ? root : root.querySelector(selector)),
    querySelectorAll: (selector) => {
      const out = matchesRoot(root, selector) ? [root] : [];
      return out.concat(root.querySelectorAll(selector));
    }
  };
  const attach = (node) => {
    node.ownerDocument = doc;
    for (const child of node.children) attach(child);
  };
  attach(root);
  return doc;
}

function matchesRoot(root, selector) {
  return compile(selector).some((c) => matchesCompound(root, c));
}
