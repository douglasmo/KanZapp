// Abrir conversa, escrever rascunho e enviar — sempre verificando o resultado.
// Nada aqui usa alert/confirm: quem chama decide como avisar o usuario.

import { normalizeText, normalizeForMatch, idKindOf, waitFor, sleep } from '../core/utils.js';
import { scanRowNodes, buildNameCandidates, pickNameCandidate } from './adapter.js';

const CLICK_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
const COMPOSER_HINT_RE = /mensagem|message|escreva|type a message/i;

function dispatchClick(el, win) {
  if (!el || typeof el.dispatchEvent !== 'function') return;
  for (const type of CLICK_EVENTS) {
    let event;
    try {
      if (type.startsWith('pointer') && typeof win?.PointerEvent === 'function') {
        event = new win.PointerEvent(type, { bubbles: true, cancelable: true, view: win, isPrimary: true, buttons: 1 });
      } else if (typeof win?.MouseEvent === 'function') {
        event = new win.MouseEvent(type.replace('pointer', 'mouse'), {
          bubbles: true,
          cancelable: true,
          view: win,
          buttons: 1
        });
      }
    } catch {
      event = null;
    }
    if (event) {
      try {
        el.dispatchEvent(event);
      } catch {
        /* elemento saiu do DOM no meio do clique */
      }
    }
  }
}

/**
 * @param {{adapter: object, logger?: object, doc?: Document, win?: Window}} options
 */
export function createComposer(options = {}) {
  const adapter = options.adapter || null;
  const logger = options.logger || null;
  const doc = options.doc || (typeof document !== 'undefined' ? document : null);
  const win = options.win || doc?.defaultView || (typeof window !== 'undefined' ? window : null);
  const waitTimeout = Number.isFinite(options.waitTimeout) ? Math.max(1, options.waitTimeout) : 4000;
  const waitInterval = Number.isFinite(options.waitInterval) ? Math.max(1, options.waitInterval) : 120;

  function log(level, ...args) {
    if (logger && typeof logger[level] === 'function') logger[level](...args);
  }

  function qs(selector, root = doc) {
    try {
      return root?.querySelector(selector) || null;
    } catch {
      return null;
    }
  }

  function qsa(selector, root = doc) {
    try {
      return Array.prototype.slice.call(root?.querySelectorAll(selector) || []);
    } catch {
      return [];
    }
  }

  function pane() {
    return adapter?.pane || null;
  }

  function mainPanel() {
    return qs('#main') || qs('[data-testid="conversation-panel-wrapper"]') || qs('main') || doc?.body || null;
  }

  /** Composer = contenteditable do painel principal (nunca o da busca lateral). */
  function findComposer() {
    const main = mainPanel();
    if (!main) return null;
    const sidePane = pane();
    const candidates = qsa('[contenteditable="true"],[contenteditable=""]', main).filter((el) => {
      if (sidePane && sidePane.contains?.(el)) return false;
      if (el.closest?.('#kanzapp-root')) return false;
      return true;
    });
    if (candidates.length === 0) return null;
    const labelled = candidates.find((el) => {
      const hint = `${el.getAttribute('aria-placeholder') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-tab') || ''}`;
      return COMPOSER_HINT_RE.test(hint);
    });
    // o composer fica no rodape: o ultimo candidato e a aposta mais segura
    return labelled || candidates[candidates.length - 1];
  }

  /** Campo de busca da lista lateral. */
  function findSearchBox() {
    const sidePane = pane();
    const scopes = [sidePane?.parentElement, sidePane, doc?.body].filter(Boolean);
    for (const scope of scopes) {
      const editable = qsa('[contenteditable="true"][role="textbox"],[contenteditable="true"]', scope).find((el) => {
        const hint = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('aria-placeholder') || ''} ${el.getAttribute('title') || ''}`;
        return /pesquis|search|busca/i.test(hint);
      });
      if (editable) return editable;
      const input = qsa('input[type="text"],input[type="search"]', scope).find((el) => {
        const hint = `${el.getAttribute('aria-label') || ''} ${el.placeholder || ''} ${el.getAttribute('title') || ''}`;
        return /pesquis|search|busca/i.test(hint) || scope === sidePane;
      });
      if (input) return input;
    }
    return null;
  }

  /**
   * Candidatos a nome da conversa aberta, pelo MESMO critério do adapter:
   * rótulo de botão ("Foto do perfil de X", "Voltar") nunca vence o texto
   * visível do cabeçalho. Pegar `labelled[0]` fazia o composer achar que a
   * conversa não tinha aberto mesmo tendo aberto.
   */
  function chatNameCandidates() {
    const main = mainPanel();
    if (!main) return [];
    const header = qs('header', main);
    if (!header) return [];
    try {
      const scan = scanRowNodes(header, { maxNodes: 200, maxFragments: 20 });
      return buildNameCandidates(header, scan);
    } catch (error) {
      log('warn', 'não foi possível ler o cabeçalho da conversa', error);
      return [];
    }
  }

  function currentChatName() {
    const best = pickNameCandidate(chatNameCandidates(), null);
    return best ? best.text : '';
  }

  /**
   * `needle` aparece em `haystack` como sequência inteira de palavras?
   * Substring crua não serve: "ana" está dentro de "mariana" e o composer
   * confirmaria a conversa errada. Aqui as bordas precisam ser não-alfanuméricas.
   */
  function containsWholeWords(haystack, needle) {
    if (!haystack || !needle) return false;
    const isWordChar = (char) => Boolean(char) && /[\p{L}\p{N}]/u.test(char);
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) return false;
      const before = at > 0 ? haystack[at - 1] : '';
      const after = haystack[at + needle.length] || '';
      if (!isWordChar(before) && !isWordChar(after)) return true;
      from = at + 1;
    }
  }

  /** Quanto de decoração ("(você)", "· online") um candidato pode ter a mais. */
  const HEADER_SLACK = 24;

  /**
   * O nome esperado aparece no cabeçalho da conversa aberta?
   *
   * Igualdade exata é o sinal forte, mas exigir SÓ igualdade era falso-negativo
   * garantido: o cabeçalho real vem decorado ("Ana Almeida (você)",
   * "Ana Almeida · online"). Então também vale o nome aparecer como sequência
   * de palavras dentro de um candidato de tamanho parecido — o limite de folga
   * impede que uma lista de participantes de grupo confirme um contato solto.
   * @returns {{ok: boolean, via: string, texto: string}}
   */
  function headerMatch(name) {
    const expected = normalizeForMatch(name || '');
    if (!expected) return { ok: false, via: 'sem-nome', texto: '' };
    const candidates = chatNameCandidates();
    for (const candidate of candidates) {
      if (candidate.key === expected) return { ok: true, via: 'exato', texto: candidate.text };
    }
    for (const candidate of candidates) {
      if (candidate.key.length > expected.length + HEADER_SLACK) continue;
      if (containsWholeWords(candidate.key, expected)) {
        return { ok: true, via: 'trecho', texto: candidate.text };
      }
    }
    return { ok: false, via: candidates.length ? 'outro-contato' : 'cabecalho-vazio', texto: '' };
  }


  /** Escreve em `<input>` respeitando o setter nativo (React/Lexical percebem). */
  function setNativeValue(el, value) {
    try {
      const proto = Object.getPrototypeOf(el);
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor?.set) descriptor.set.call(el, value);
      else el.value = value;
    } catch {
      el.value = value;
    }
    fire(el, 'input', { inputType: 'insertText', data: value });
    fire(el, 'change');
  }

  function fire(el, type, init = {}) {
    try {
      let event;
      if (type === 'input' || type === 'beforeinput') {
        const Ctor = win?.InputEvent || (typeof InputEvent !== 'undefined' ? InputEvent : null);
        event = Ctor
          ? new Ctor(type, { bubbles: true, cancelable: true, ...init })
          : new (win?.Event || Event)(type, { bubbles: true, cancelable: true });
      } else {
        event = new (win?.Event || Event)(type, { bubbles: true, cancelable: true });
      }
      el.dispatchEvent(event);
      return true;
    } catch (error) {
      log('warn', `nao foi possivel disparar ${type}`, error);
      return false;
    }
  }

  function composerText(el) {
    return normalizeText(el?.textContent || el?.value || '');
  }

  function selectAllIn(el) {
    try {
      el.focus();
      const selection = win?.getSelection?.();
      if (!selection || !doc?.createRange) return;
      const range = doc.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      /* sem selection API */
    }
  }

  /** Tatica 2: evento `paste` com DataTransfer — o caminho que o Lexical entende. */
  function pasteInto(el, text) {
    try {
      const DT = win?.DataTransfer || (typeof DataTransfer !== 'undefined' ? DataTransfer : null);
      const CE = win?.ClipboardEvent || (typeof ClipboardEvent !== 'undefined' ? ClipboardEvent : null);
      if (!DT || !CE) return false;
      const data = new DT();
      data.setData('text/plain', text);
      const event = new CE('paste', { bubbles: true, cancelable: true, clipboardData: data });
      el.dispatchEvent(event);
      return true;
    } catch (error) {
      log('warn', 'paste sintetico falhou', error);
      return false;
    }
  }

  /**
   * Insere o texto no composer sem enviar. Verifica lendo o textContent.
   * @returns {Promise<boolean>}
   */
  async function insertDraft(text) {
    const value = String(text ?? '');
    if (!value) return false;
    const el = findComposer();
    if (!el) {
      log('warn', 'composer não encontrado');
      return false;
    }
    try {
      el.focus();
    } catch {
      /* elemento pode recusar foco */
    }

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      setNativeValue(el, value);
      return normalizeText(el.value).includes(normalizeText(value));
    }

    const target = normalizeText(value);
    const contains = () => composerText(el).includes(target);

    // 1) execCommand
    try {
      if (doc?.execCommand) {
        doc.execCommand('insertText', false, value);
        fire(el, 'input', { inputType: 'insertText', data: value });
      }
    } catch {
      /* execCommand indisponivel */
    }
    if (contains()) return true;

    // 2) paste com DataTransfer (editor Lexical)
    if (pasteInto(el, value)) {
      await sleep(30);
      if (contains()) return true;
    }

    // 3) beforeinput + input
    fire(el, 'beforeinput', { inputType: 'insertText', data: value });
    fire(el, 'input', { inputType: 'insertText', data: value });
    await sleep(30);
    if (contains()) return true;

    log('warn', 'nenhuma tática de inserção funcionou');
    return false;
  }

  async function clearComposer() {
    const el = findComposer();
    if (!el) return false;
    selectAllIn(el);
    try {
      if (doc?.execCommand) doc.execCommand('delete', false, null);
    } catch {
      /* ignora */
    }
    fire(el, 'input', { inputType: 'deleteContentBackward' });
    return composerText(el) === '';
  }

  async function clearSearch(box) {
    if (!box) return;
    if (box.tagName === 'INPUT') {
      setNativeValue(box, '');
      return;
    }
    selectAllIn(box);
    try {
      if (doc?.execCommand) doc.execCommand('delete', false, null);
    } catch {
      /* ignora */
    }
    fire(box, 'input', { inputType: 'deleteContentBackward' });
  }

  function writeInSearch(box, name) {
    if (!box) return false;
    if (box.tagName === 'INPUT') {
      setNativeValue(box, name);
      return true;
    }
    try {
      box.focus();
      selectAllIn(box);
      if (doc?.execCommand) doc.execCommand('insertText', false, name);
      fire(box, 'input', { inputType: 'insertText', data: name });
      if (normalizeText(box.textContent).length === 0) {
        pasteInto(box, name);
      }
      return true;
    } catch (error) {
      log('warn', 'não foi possível escrever na busca', error);
      return false;
    }
  }

  function findLiveRow(chat) {
    if (!adapter) return null;
    const direct = adapter.getRowElement?.(chat?.id);
    if (direct) return direct;
    // Um id forte nunca pode cair para outro contato homônimo. Nome é apenas
    // identidade de último recurso (id ausente ou derivado do nome).
    const id = String(chat?.id || '');
    const kind = chat?.idKind || idKindOf(id);
    if (chat?.id && kind !== 'name') return null;
    return adapter.getRowElement?.(chat?.name) || null;
  }

  async function clickRow(row, chat) {
    try {
      row.scrollIntoView?.({ block: 'center' });
    } catch {
      /* ignora */
    }
    const targets = [
      row.querySelector?.('[role="gridcell"]'),
      row.querySelector?.('[title]'),
      row.firstElementChild,
      row
    ].filter(Boolean);
    for (const target of targets.slice(0, 2)) dispatchClick(target, win);
    if (targets.length > 2) dispatchClick(row, win);

    const expected = normalizeText(chat?.name || '');
    let match = { ok: false, via: 'sem-nome', texto: '' };
    const opened = await waitFor(
      () => {
        const composer = findComposer();
        if (!composer) return null;
        if (!expected) return null;
        // A confirmação é "composer no ar E o cabeçalho fala do contato certo".
        match = headerMatch(expected);
        return match.ok ? composer : null;
      },
      { timeout: waitTimeout, interval: waitInterval }
    );
    return { ok: Boolean(opened), confirmacao: match.via, cabecalho: match.texto };
  }

  /**
   * Abre a conversa. Nunca lanca; devolve `{ ok, via, reason, steps }`.
   * `steps` é a trilha de diagnóstico: só se reporta falha depois de esgotar a
   * linha viva E a busca, e é preciso saber em qual das duas parou.
   * @returns {Promise<{ok: boolean, via?: 'row'|'search', reason?: string, steps: string[]}>}
   */
  async function openChat(chat) {
    const steps = [];
    if (!chat || (!chat.id && !chat.name)) return { ok: false, reason: 'Contato inválido.', steps };
    try {
      // 1) linha viva na lista lateral
      let row = findLiveRow(chat);
      if (!row && adapter?.listChats) {
        adapter.listChats();
        row = findLiveRow(chat);
      }
      if (row) {
        const clicked = await clickRow(row, chat);
        steps.push(`linha:${clicked.ok ? `ok(${clicked.confirmacao})` : `falhou(${clicked.confirmacao})`}`);
        if (clicked.ok) {
          log('debug', 'conversa aberta pela linha viva', { id: chat.id, confirmacao: clicked.confirmacao });
          return { ok: true, via: 'row', steps };
        }
      } else {
        steps.push('linha:ausente');
      }

      // 2) fallback pela busca
      const box = findSearchBox();
      if (!box) {
        steps.push('busca:sem-campo');
        return { ok: false, reason: 'Campo de busca do WhatsApp não encontrado.', steps };
      }
      const name = normalizeText(chat.name);
      if (!name) {
        steps.push('busca:sem-nome');
        return { ok: false, reason: 'Contato sem nome para buscar.', steps };
      }
      writeInSearch(box, name);

      const target = normalizeForMatch(name);
      const foundRow = await waitFor(
        () => {
          if (!adapter?.listChats) return null;
          const chats = adapter.listChats();
           const byId = chats.find((c) => chat.id && c.id === chat.id);
           const id = String(chat?.id || '');
           const kind = chat?.idKind || idKindOf(id);
           const byName = (!chat?.id || kind === 'name')
             ? chats.find((c) => normalizeForMatch(c.name) === target)
             : null;
           const match = byId || byName;
          return match ? adapter.getRowElement(match.id) : null;
        },
        { timeout: waitTimeout, interval: Math.max(waitInterval, 250) }
      );

      if (!foundRow) {
        await clearSearch(box);
        steps.push('busca:sem-resultado');
        return { ok: false, reason: `Não encontrei "${name}" na lista de conversas.`, steps };
      }
      const opened = await clickRow(foundRow, chat);
      await clearSearch(box);
      steps.push(`busca:${opened.ok ? `ok(${opened.confirmacao})` : `falhou(${opened.confirmacao})`}`);
      if (opened.ok) return { ok: true, via: 'search', steps };
      log('warn', 'a conversa não confirmou abertura', { id: chat.id, name: chat.name, steps });
      return { ok: false, reason: 'A conversa não abriu a tempo.', steps };
    } catch (error) {
      log('error', 'openChat falhou', error);
      steps.push('erro');
      return { ok: false, reason: 'Erro inesperado ao abrir a conversa.', steps };
    }
  }

  function pressEnter(el) {
    const KeyCtor = win?.KeyboardEvent || (typeof KeyboardEvent !== 'undefined' ? KeyboardEvent : null);
    if (!KeyCtor) return false;
    const init = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
    for (const type of ['keydown', 'keypress', 'keyup']) {
      try {
        el.dispatchEvent(new KeyCtor(type, init));
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * Abre a conversa, insere o texto e envia com Enter.
   * @returns {Promise<boolean>}
   */
  async function sendMessage(chat, text) {
    const opened = await openChat(chat);
    if (!opened.ok) return false;
    const inserted = await insertDraft(text);
    if (!inserted) return false;
    const el = findComposer();
    if (!el) return false;
    if (!pressEnter(el)) return false;
    const emptied = await waitFor(() => composerText(el) === '' || null, { timeout: 2000, interval: 100 });
    return Boolean(emptied);
  }

  return {
    openChat,
    insertDraft,
    sendMessage,
    clearComposer,
    findComposer,
    findSearchBox,
    currentChatName,
    chatNameCandidates,
    headerMatch
  };
}
