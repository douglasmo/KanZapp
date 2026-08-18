/**
 * board.js — o quadro Kanban.
 *
 * Render por diff de verdade: colunas e cards são reaproveitados por
 * `data-column-id` / `data-card-id`. Um update só cria o que é novo, remove o
 * que sumiu, reordena com `insertBefore` e atualiza campos in-place. Nada de
 * `clear(container)` no caminho de atualização — isso mataria foco, scroll e
 * o drag em andamento.
 */
import { h, icon, setText, clear, brandMark } from './h.js';
// `core/search.js` é puro (sem DOM, sem chrome): a ordem de camadas do contrato
// é core → wa → ui, então a UI pode depender dele. O parser mora lá porque o
// `store.select` é quem filtra de verdade; aqui ele só serve ao plano B.
import { parseSearchQuery, matchesSearchQuery } from '../core/search.js';
import { createDnd } from './dnd.js';
import { createCard } from './card.js';
import { createUndoStack, moveEntry, archiveEntry, bulkMoveEntry, bulkTagEntry } from './undo.js';
import { openTagsManager, openTagPicker } from './views/tags.js';
import { openTemplatesManager, openTemplatePicker } from './views/templates.js';
import { openFollowupsList, openFollowupScheduler } from './views/followups.js';
import { openNoteEditor } from './views/notes.js';
import { openSettings } from './views/settings.js';

const PAGE_SIZE = 60;
/** Tempo máximo que um arraste pode segurar o repaint do quadro. */
const MAX_PENDING_MS = 4000;
const COLUMN_COLORS = ['#00a884', '#0b6bcb', '#7c5cd6', '#c2410c', '#b3261e', '#0f766e', '#6b7280'];

/**
 * Estado vazio do quadro inteiro. Função pura (testável em Node): decide SE
 * aparece e QUAL texto mostrar. O nó é reaproveitado, mas o texto tem de
 * acompanhar o diagnóstico — "Nenhuma conversa capturada" e "WhatsApp não
 * detectado" pedem ações diferentes do usuário.
 */
export function boardEmptyModel({ hasContacts, totalVisible, filtering, down }) {
  const needs = !hasContacts || (totalVisible === 0 && !filtering);
  if (!needs) return { needs: false, kind: 'none' };
  if (down) {
    return {
      needs: true,
      kind: 'down',
      icon: 'warning',
      title: 'WhatsApp não detectado',
      text: 'Abra o WhatsApp Web, espere a lista de conversas aparecer e clique em Atualizar.'
    };
  }
  return {
    needs: true,
    kind: 'empty',
    icon: 'inbox',
    title: 'Nenhuma conversa capturada ainda',
    text: 'Role a lista lateral do WhatsApp para que as conversas sejam lidas e clique em Atualizar.'
  };
}

/** Plural enxuto para as mensagens da varredura. */
function conversas(n) {
  return `${n} conversa${n === 1 ? '' : 's'}`;
}

/**
 * Mensagem final da varredura. Pura de propósito (testável em Node): é ela que
 * traduz o `reason` técnico do sweeper para o que o usuário precisa fazer em
 * seguida.
 * @returns {{type: 'success'|'warn'|'error', message: string, diagnose?: boolean}}
 */
export function sweepOutcome(result) {
  const found = (result && result.found) || 0;
  const reason = (result && result.reason) || '';
  if (!result || reason === 'sem-scroller') {
    return {
      type: 'error',
      diagnose: true,
      message: 'Não localizei a lista de conversas do WhatsApp. Abra o painel de Diagnóstico em Configurações para ver o que a extensão está enxergando.'
    };
  }
  if (reason === 'em-andamento') {
    return { type: 'warn', message: 'A captura já está em andamento.' };
  }
  if (result.ok === false) {
    return {
      type: 'error',
      diagnose: true,
      message: found > 0
        ? `A captura falhou no meio do caminho. ${conversas(found)} foram salvas.`
        : 'A captura falhou. Confira o painel de Diagnóstico em Configurações.'
    };
  }
  if (reason === 'cancelado') {
    return { type: 'warn', message: `Captura interrompida. ${conversas(found)} capturada${found === 1 ? '' : 's'}.` };
  }
  if (reason === 'teto-passos' || reason === 'teto-tempo') {
    return {
      type: 'warn',
      message: `Captura interrompida no limite de segurança com ${conversas(found)}. Rode de novo para continuar de onde parou.`
    };
  }
  if (reason === 'erro-progresso') {
    return { type: 'warn', message: `Captura encerrada por falha na tela. ${conversas(found)} capturada${found === 1 ? '' : 's'}.` };
  }
  if (found === 0) {
    return { type: 'warn', message: 'Nenhuma conversa foi lida. A lista lateral do WhatsApp está carregada?' };
  }
  return { type: 'success', message: `Captura concluída: ${conversas(found)}.` };
}

function isSkippable(node) {
  return Boolean(node && node.classList
    && (node.classList.contains('kz-placeholder')
      || node.classList.contains('kz-empty')
      || node.classList.contains('is-dragging')));
}

export function createBoard(ctx) {
  const { store, adapter, composer, sweeper, dialogs, toast, logger, messenger, onClose, onRefresh } = ctx;
  const log = logger || { warn() {}, info() {}, debug() {} };

  // Pilha de desfazer da sessão: não persiste, não vai para o backup.
  const history = createUndoStack({ logger: log });

  const viewCtx = { store, adapter, composer, dialogs, toast, logger: log, messenger, history };

  const filters = {
    search: '',
    tagId: '',
    onlyUnread: false,
    hideGroups: false,
    showArchived: false,
    sort: 'manual'
  };
  const columnViews = new Map();
  // Registro de cards do QUADRO, não da coluna: um arraste entre colunas
  // re-parenteia o nó, então um registro por coluna faria o destino criar um
  // segundo nó e a origem falhar em remover o primeiro (card duplicado).
  const cardViews = new Map();
  let lastState = null;
  let pendingState = null;
  let searchTimer = 0;
  let pendingTimer = 0;
  let selectWarned = false;
  let sortWarned = false;
  let columnDrag = null;
  let emptyBoardEl = null;
  let emptyBoardKind = '';
  let pendingSince = 0;
  let renameSession = null;
  let sweepSession = null;

  /* ------------------------------- header ------------------------------ */

  const SEARCH_HINT = 'Busca em nome, prévia, nota e tags. Prefixos: tag:vip, nota:orçamento, coluna:negociação. Use aspas para valores com espaço.';

  const searchInput = h('input', {
    class: 'kz-input kz-search__input',
    type: 'search',
    placeholder: 'Buscar (nome, nota, tag…)',
    attrs: { 'aria-label': 'Buscar contato, nota ou tag', title: SEARCH_HINT },
    onInput: () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        filters.search = searchInput.value.trim();
        onFiltersChanged();
        if (lastState) paint(lastState);
      }, 130);
    },
    onKeyDown: (event) => {
      if (event.key === 'Escape' && searchInput.value) {
        event.stopPropagation();
        searchInput.value = '';
        filters.search = '';
        if (lastState) paint(lastState);
      }
    }
  });

  const tagFilter = h('select', {
    class: 'kz-select',
    attrs: { 'aria-label': 'Filtrar por tag' },
    style: { width: 'auto', minWidth: '150px' },
    onChange: () => {
      filters.tagId = tagFilter.value;
      onFiltersChanged();
      if (lastState) paint(lastState);
    }
  }, h('option', { value: '' }, 'Todas as tags'));

  /** Alternância de filtro de EXIBIÇÃO: nada é apagado, só deixa de aparecer. */
  function filterToggle(key, settingKey) {
    const input = h('input', {
      type: 'checkbox',
      onChange: () => {
        filters[key] = input.checked;
        onFiltersChanged();
        Promise.resolve(store.actions.updateSettings({ [settingKey]: input.checked }))
          .catch((error) => log.warn(`[board] updateSettings(${settingKey}) falhou`, error));
        if (lastState) paint(lastState);
      }
    });
    return input;
  }

  const unreadToggle = filterToggle('onlyUnread', 'onlyUnread');
  const groupsToggle = filterToggle('hideGroups', 'hideGroups');
  const archivedToggle = filterToggle('showArchived', 'showArchived');

  const sortSelect = h('select', {
    class: 'kz-select',
    attrs: { 'aria-label': 'Ordenação dos cards' },
    style: { width: 'auto' },
    onChange: () => {
      filters.sort = sortSelect.value;
      store.actions.updateSettings({ sort: sortSelect.value });
      if (lastState) paint(lastState);
    }
  },
  h('option', { value: 'manual' }, 'Ordem manual'),
  h('option', { value: 'inbox' }, 'Ordem da caixa'),
  h('option', { value: 'recent' }, 'Mais recentes'),
  h('option', { value: 'name' }, 'Nome (A–Z)'));

  const countEl = h('span', { class: 'kz-count' });

  const healthDot = h('span', { class: 'kz-health__dot' });
  const healthText = h('span', {}, 'Verificando…');
  const healthBtn = h('button', {
    class: 'kz-health',
    type: 'button',
    dataset: { state: 'ok' },
    attrs: { 'aria-label': 'Estado da leitura do WhatsApp' },
    onClick: () => openSettings(viewCtx, { tab: 'diagnostico' })
  }, healthDot, healthText);

  const banner = h('div', { class: 'kz-banner', hidden: true, attrs: { role: 'status' } },
    icon('warning', { size: 16 }),
    h('div', {},
      h('strong', {}, 'Leitura degradada'),
      h('span', { class: 'kz-banner__text' }, '')));

  function headerButton(name, label, handler, { primary = false } = {}) {
    return h('button', {
      class: primary ? 'kz-btn kz-btn--primary' : 'kz-btn',
      type: 'button',
      attrs: { title: label, 'aria-label': label },
      onClick: handler
    }, icon(name, { size: 15 }), h('span', { class: 'kz-btn__label' }, label));
  }

  const sweepButton = headerButton('download', 'Capturar conversas', () => runSweep());

  const header = h('header', { class: 'kz-header' },
    h('div', { class: 'kz-header__row' },
      h('div', { class: 'kz-brand' },
        h('span', { class: 'kz-brand__mark' }, brandMark({ size: 18 })),
        h('span', {},
          h('span', { class: 'kz-brand__name' }, 'KanZapp'),
          h('span', { class: 'kz-brand__sub' }, ' CRM para WhatsApp'))),
      h('div', { class: 'kz-search' }, icon('search', { size: 15 }), searchInput),
      h('div', { class: 'kz-spacer' }),
      countEl,
      healthBtn,
      h('button', {
        class: 'kz-iconbtn',
        type: 'button',
        attrs: { 'aria-label': 'Fechar o quadro', title: 'Fechar (Esc)' },
        onClick: () => onClose && onClose()
      }, icon('close', { size: 18 }))),
    h('div', { class: 'kz-header__row kz-header__row--filters' },
      tagFilter,
      h('label', { class: 'kz-switch', attrs: { title: 'Mostra só quem tem mensagem não lida' } },
        unreadToggle, 'Só não lidas'),
      h('label', { class: 'kz-switch', attrs: { title: 'Esconde os cards de grupos (nada é apagado)' } },
        groupsToggle, 'Sem grupos'),
      h('label', { class: 'kz-switch', attrs: { title: 'Mostra também os cards arquivados, esmaecidos' } },
        archivedToggle, 'Ver arquivados'),
      sortSelect,
      h('div', { class: 'kz-spacer' }),
      headerButton('refresh', 'Atualizar', () => onRefresh && onRefresh()),
      sweepButton,
      headerButton('tag', 'Tags', () => openTagsManager(viewCtx)),
      headerButton('message', 'Modelos', () => openTemplatesManager(viewCtx)),
      headerButton('bell', 'Follow-ups', () => openFollowupsList(viewCtx)),
      headerButton('plus', 'Nova coluna', addColumn),
      headerButton('settings', 'Configurações', () => openSettings(viewCtx))),
    banner);

  /* ------------------------------ colunas ------------------------------ */

  const columnsEl = h('div', {
    class: 'kz-columns',
    attrs: { role: 'group', 'aria-label': 'Colunas do funil' }
  });

  const liveRegion = h('div', { class: 'kz-sr', attrs: { role: 'status', 'aria-live': 'polite' } });

  const boardEl = h('section', {
    class: 'kz-board',
    attrs: { role: 'region', 'aria-label': 'Quadro KanZapp' }
  }, header, columnsEl, liveRegion);

  const dnd = createDnd({
    scroller: columnsEl,
    getColumns: () => Array.from(columnViews.values()).map((view) => ({
      columnId: view.columnId,
      colEl: view.colEl,
      listEl: view.listEl,
      collapsed: view.collapsed,
      title: view.title
    })),
    announce: (message) => setText(liveRegion, message),
    onDrop: (contactId, intent) => commitMove(contactId, intent)
  });

  /* --------------------------- ações do store -------------------------- */

  function commitMove(contactId, intent) {
    const state = lastState || store.getState();
    const columnId = intent.columnId;
    const ordered = orderedIdsOf(state, columnId).filter((id) => id !== contactId);
    let index = ordered.length;
    if (intent.beforeId) {
      const at = ordered.indexOf(intent.beforeId);
      if (at >= 0) index = at;
    }
    if (filters.sort !== 'manual' && !sortWarned) {
      sortWarned = true;
      toast('A ordenação não é manual, então a posição dentro da coluna pode ser reorganizada na tela.', { type: 'warn' });
    }
    // origem capturada ANTES da mutação: é o que a pilha de desfazer precisa
    const card = (state.cards || {})[contactId];
    const from = card ? card.columnId : null;
    const fromIndex = from ? orderedIdsOf(state, from).indexOf(contactId) : 0;
    const nome = nameOf(state, contactId);
    const destino = (state.columns || []).find((c) => c.id === columnId);

    Promise.resolve(store.actions.moveCard(contactId, columnId, index)).then(() => {
      if (!from || from === columnId) return;
      history.push(moveEntry(
        [{ contactId, from, to: columnId, fromIndex: Math.max(0, fromIndex), toIndex: index }],
        `Mover ${nome} para ${destino ? destino.title : 'outra coluna'}`
      ));
      toast(`${nome} → ${destino ? destino.title : 'outra coluna'}`, {
        duration: 4000,
        action: { label: 'Desfazer', onClick: () => undoTop() }
      });
    }).catch((error) => {
      log.warn('[board] moveCard falhou', error);
      toast('Não foi possível mover o card.', { type: 'error' });
    });
  }

  function nameOf(state, contactId) {
    const contact = (state.contacts || {})[contactId];
    return (contact && contact.name) || 'Contato';
  }

  /* ---------------------------- desfazer ------------------------------ */

  function currentState() {
    try {
      return (typeof store.getState === 'function' ? store.getState() : null) || lastState || {};
    } catch {
      return lastState || {};
    }
  }

  async function applyHistory(direction) {
    const result = direction === 'redo'
      ? await history.redo(currentState(), store.actions)
      : await history.undo(currentState(), store.actions);
    if (result.ok) {
      const verbo = direction === 'redo' ? 'Refeito' : 'Desfeito';
      toast(`${verbo}: ${result.label}`, { type: 'success', duration: 3000 });
      setText(liveRegion, `${verbo}: ${result.label}`);
      return true;
    }
    if (result.reason === 'vazio') {
      toast(direction === 'redo' ? 'Nada para refazer.' : 'Nada para desfazer.', { duration: 2500 });
      return false;
    }
    if (result.reason === 'estado-mudou') {
      toast('Não deu para desfazer: o card mudou depois dessa ação. A ação foi descartada da pilha.', { type: 'warn' });
      return false;
    }
    toast('Não foi possível concluir a operação.', { type: 'error' });
    return false;
  }

  const undoTop = () => applyHistory('undo');
  const redoTop = () => applyHistory('redo');

  function orderedIdsOf(state, columnId) {
    const cards = state.cards || {};
    return Object.keys(cards)
      .filter((id) => cards[id] && cards[id].columnId === columnId)
      .sort((a, b) => (cards[a].order || 0) - (cards[b].order || 0));
  }

  async function addColumn() {
    const title = await dialogs.promptDialog('Nome da coluna', '', { title: 'Nova coluna', placeholder: 'Ex.: Proposta enviada' });
    if (!title) return;
    try {
      await store.actions.addColumn(title);
      toast('Coluna criada.', { type: 'success' });
    } catch (error) {
      log.warn('[board] addColumn falhou', error);
      toast('Não foi possível criar a coluna.', { type: 'error' });
    }
  }

  /* --------------------- varredura da lista lateral -------------------- */

  async function runSweep() {
    if (!sweeper || typeof sweeper.run !== 'function') {
      toast('A captura de conversas não está disponível nesta tela.', { type: 'warn' });
      return null;
    }
    if (sweepSession) {
      toast('A captura já está em andamento.', { type: 'warn' });
      return null;
    }

    const signal = { aborted: false };
    const foundEl = h('strong', { class: 'kz-sweep__count' }, '0');
    const stepEl = h('span', { class: 'kz-sweep__step' }, 'iniciando…');
    sweepSession = { signal };
    sweepButton.disabled = true;

    const dialog = dialogs.openDialog({
      title: 'Capturar conversas',
      dismissable: false,
      body: (hh) => hh('div', {
        class: 'kz-sweep',
        // o diálogo não é dismissable (fechar no meio deixaria a varredura
        // órfã), então Esc aqui significa "parar", não "fechar"
        onKeyDown: (event) => {
          if (event.key === 'Escape') signal.aborted = true;
        }
      },
        hh('p', { class: 'kz-dialog__text' },
          'A lista do WhatsApp só mantém algumas conversas na tela por vez. A captura rola a lista até o fim para trazer todas para o funil e devolve a rolagem para onde estava.'),
        hh('div', { class: 'kz-sweep__stats' },
          hh('span', {}, 'Conversas encontradas: '), foundEl,
          hh('span', { class: 'kz-sweep__sep' }, ' · '), stepEl),
        hh('p', { class: 'kz-hint' },
          'Deixe esta aba do WhatsApp visível até o fim: o navegador congela páginas em segundo plano e a captura para no meio.')),
      actions: [
        {
          id: 'stop',
          label: 'Parar',
          variant: 'ghost',
          onClick: () => {
            signal.aborted = true;
            return false; // mantém o diálogo aberto até o sweeper devolver
          }
        }
      ]
    });

    let result = null;
    try {
      result = await sweeper.run({
        signal,
        onProgress: ({ found, step, done }) => {
          setText(foundEl, String(found));
          setText(stepEl, done ? 'finalizando…' : `passo ${step}`);
        }
      });
    } catch (error) {
      log.warn('[board] varredura falhou', error);
      result = { ok: false, found: 0, reason: 'erro' };
    } finally {
      sweepSession = null;
      sweepButton.disabled = false;
      if (typeof dialog.close === 'function') dialog.close(null);
    }

    const outcome = sweepOutcome(result);
    toast(outcome.message, {
      type: outcome.type,
      duration: outcome.type === 'success' ? 5000 : 9000,
      action: outcome.diagnose
        ? { label: 'Diagnóstico', onClick: () => openSettings(viewCtx, { tab: 'diagnostico' }) }
        : null
    });
    setText(liveRegion, outcome.message);
    if (lastState) paint(store.getState ? store.getState() : lastState);
    return result;
  }

  async function removeColumn(column, state) {
    if ((state.columns || []).length <= 1) {
      toast('É preciso manter pelo menos uma coluna.', { type: 'warn' });
      return;
    }
    const ok = await dialogs.confirmDialog(
      `Excluir a coluna "${column.title}"? Os cards vão para a primeira coluna restante.`,
      { title: 'Excluir coluna', confirmLabel: 'Excluir', danger: true }
    );
    if (!ok) return;
    try {
      await store.actions.removeColumn(column.id);
    } catch (error) {
      log.warn('[board] removeColumn falhou', error);
      toast('Não foi possível excluir a coluna.', { type: 'error' });
    }
  }

  /** Cor + limite WIP da coluna (o badge do cabeçalho depende dos dois). */
  async function editColumn(column) {
    let color = column.color || COLUMN_COLORS[0];
    let wipInput = null;

    const result = await dialogs.openDialog({
      title: `Coluna "${column.title}"`,
      body: (hh) => {
        const swatches = COLUMN_COLORS.map((value) => {
          const button = hh('button', {
            class: 'kz-btn kz-btn--icon',
            type: 'button',
            attrs: {
              'aria-label': `Cor ${value}`,
              title: value,
              'aria-pressed': String(value === color)
            },
            onClick: () => {
              color = value;
              for (const other of swatches) {
                other.setAttribute('aria-pressed', String(other.dataset.color === value));
                other.classList.toggle('is-on', other.dataset.color === value);
              }
            }
          });
          button.dataset.color = value;
          button.classList.toggle('is-on', value === color);
          button.style.background = value;
          button.style.borderColor = value;
          return button;
        });

        wipInput = hh('input', {
          class: 'kz-input',
          type: 'number',
          value: column.wipLimit ? String(column.wipLimit) : '',
          placeholder: 'sem limite',
          attrs: { min: '0', step: '1', 'aria-label': 'Limite WIP da coluna' }
        });

        return hh('div', {},
          hh('div', { class: 'kz-section' },
            hh('div', { class: 'kz-section__title' }, 'Cor'),
            hh('div', { class: 'kz-row' }, ...swatches)),
          hh('div', { class: 'kz-section' },
            hh('div', { class: 'kz-section__title' }, 'Limite WIP'),
            hh('div', { class: 'kz-field' },
              hh('label', {}, 'Máximo de cards nesta coluna'),
              wipInput,
              hh('span', { class: 'kz-hint' },
                'Deixe em branco para não ter limite. Ao estourar, o contador do cabeçalho fica em destaque.'))));
      },
      actions: [
        { id: 'cancel', label: 'Cancelar', variant: 'ghost', value: null },
        {
          id: 'save',
          label: 'Salvar',
          variant: 'primary',
          onClick: () => ({ color, wipLimit: wipInput ? wipInput.value.trim() : '' })
        }
      ]
    });
    if (!result) return;

    try {
      if (result.color && result.color !== column.color) {
        await store.actions.setColumnColor(column.id, result.color);
      }
      if (typeof store.actions.setColumnWipLimit === 'function') {
        const raw = Number(result.wipLimit);
        const next = result.wipLimit === '' || !Number.isFinite(raw) || raw <= 0 ? null : Math.floor(raw);
        if (next !== (column.wipLimit ?? null)) {
          await store.actions.setColumnWipLimit(column.id, next);
        }
      }
    } catch (error) {
      log.warn('[board] edição da coluna falhou', error);
      toast('Não foi possível salvar a coluna.', { type: 'error' });
    }
  }

  async function renameColumn(view, column) {
    const title = await dialogs.promptDialog('Novo nome', column.title, { title: 'Renomear coluna' });
    if (!title || title === column.title) return;
    try {
      await store.actions.renameColumn(column.id, title);
    } catch (error) {
      log.warn('[board] renameColumn falhou', error);
      toast('Não foi possível renomear a coluna.', { type: 'error' });
    }
    void view;
  }

  function startInlineRename(view, column) {
    if (view.editing) return;
    view.editing = true;
    let done = false;

    function finish(commit) {
      if (done) return;
      done = true;
      if (renameSession && renameSession.view === view) renameSession = null;
      const value = input.value.trim();
      input.replaceWith(view.titleEl);
      view.editing = false;
      view.titleEl.focus();
      if (commit && value && value !== column.title) {
        Promise.resolve(store.actions.renameColumn(column.id, value)).catch((error) => {
          log.warn('[board] renameColumn falhou', error);
          toast('Não foi possível renomear a coluna.', { type: 'error' });
        });
      }
    }

    const input = h('input', {
      class: 'kz-input',
      value: column.title,
      attrs: { 'aria-label': 'Nome da coluna' },
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      },
      onBlur: () => finish(true)
    });

    // registrada na pilha do Esc: se o evento não chegar ao input (foco em
    // outro lugar), o app-root ainda consegue cancelar a edição
    renameSession = { view, cancel: () => finish(false) };
    view.titleEl.replaceWith(input);
    input.focus();
    input.select();
  }

  function moveColumn(state, columnId, delta) {
    const ids = (state.columns || []).map((c) => c.id);
    const from = ids.indexOf(columnId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    Promise.resolve(store.actions.reorderColumns(ids)).catch((error) => {
      log.warn('[board] reorderColumns falhou', error);
    });
  }

  /* ---------------------- arraste de colunas (header) ------------------ */

  function onColumnPointerDown(event, view) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (event.target.closest('button') || event.target.closest('input')) return;
    columnDrag = { view, startX: event.clientX, started: false };
  }

  function onColumnPointerMove(event) {
    if (!columnDrag) return;
    if (!columnDrag.started) {
      if (Math.abs(event.clientX - columnDrag.startX) < 8) return;
      columnDrag.started = true;
      columnDrag.view.colEl.classList.add('is-col-dragging');
    }
    const views = Array.from(columnViews.values());
    for (const other of views) {
      if (other === columnDrag.view) continue;
      const rect = other.colEl.getBoundingClientRect();
      if (event.clientX > rect.left && event.clientX < rect.right) {
        const middle = rect.left + rect.width / 2;
        const before = event.clientX < middle;
        columnsEl.insertBefore(columnDrag.view.colEl, before ? other.colEl : other.colEl.nextSibling);
        break;
      }
    }
  }

  function onColumnPointerUp() {
    if (!columnDrag) return;
    const { view, started } = columnDrag;
    columnDrag = null;
    view.colEl.classList.remove('is-col-dragging');
    if (!started) return;
    const ids = Array.from(columnsEl.children)
      .map((node) => node.dataset && node.dataset.columnId)
      .filter(Boolean);
    Promise.resolve(store.actions.reorderColumns(ids)).catch((error) => {
      log.warn('[board] reorderColumns falhou', error);
    });
  }

  window.addEventListener('pointermove', onColumnPointerMove);
  window.addEventListener('pointerup', onColumnPointerUp);

  /* --------------------------- seleção de cards ------------------------ */

  function filterPayload() {
    return {
      search: filters.search,
      tagIds: filters.tagId ? [filters.tagId] : [],
      onlyUnread: filters.onlyUnread,
      hideGroups: filters.hideGroups,
      showArchived: filters.showArchived,
      sort: filters.sort
    };
  }

  /* --------------------------- seleção em lote ------------------------- */

  /** Seleção é estado de SESSÃO: não persiste e morre com o filtro. */
  const selection = new Set();
  let anchorId = null;

  /** Mudou filtro: a seleção da §4 é de sessão e não sobrevive a isso. */
  function onFiltersChanged() {
    clearSelection();
  }

  function clearSelection(repaint = true) {
    if (!selection.size) {
      renderSelectionBar();
      return false;
    }
    selection.clear();
    anchorId = null;
    if (repaint && lastState) paint(lastState);
    else renderSelectionBar();
    return true;
  }

  /** Ids visíveis da coluna, na ordem em que estão pintados. */
  function visibleIdsOf(columnId) {
    const view = columnViews.get(columnId);
    if (!view) return [];
    return Array.from(view.listEl.querySelectorAll('.kz-card'))
      .map((node) => node.dataset.cardId)
      .filter(Boolean);
  }

  function columnOfCard(contactId) {
    const state = currentState();
    const card = (state.cards || {})[contactId];
    return card ? card.columnId : null;
  }

  /**
   * Clique no card: sem modificador abre a conversa; com Ctrl/Cmd alterna a
   * seleção; com Shift seleciona o intervalo dentro da MESMA coluna.
   */
  function onCardClick(contactId, event) {
    const toggle = event && (event.ctrlKey || event.metaKey);
    const range = event && event.shiftKey;
    if (!toggle && !range) {
      if (selection.size) {
        // com seleção ativa, clique simples troca o alvo em vez de abrir
        selection.clear();
        selection.add(contactId);
        anchorId = contactId;
        if (lastState) paint(lastState);
        return;
      }
      openChat(contactId);
      return;
    }
    if (range && anchorId && columnOfCard(anchorId) === columnOfCard(contactId)) {
      const ids = visibleIdsOf(columnOfCard(contactId));
      const from = ids.indexOf(anchorId);
      const to = ids.indexOf(contactId);
      if (from >= 0 && to >= 0) {
        const [start, end] = from <= to ? [from, to] : [to, from];
        for (let i = start; i <= end; i += 1) selection.add(ids[i]);
      }
    } else if (selection.has(contactId)) {
      selection.delete(contactId);
      if (anchorId === contactId) anchorId = null;
    } else {
      selection.add(contactId);
      anchorId = contactId;
    }
    if (lastState) paint(lastState);
  }

  const selectionCount = h('strong', { class: 'kz-bulk__count' }, '0');

  function bulkButton(name, label, handler) {
    return h('button', {
      class: 'kz-btn kz-btn--sm',
      type: 'button',
      attrs: { title: label },
      onClick: handler
    }, icon(name, { size: 14 }), h('span', {}, label));
  }

  const selectionBar = h('div', {
    class: 'kz-bulk',
    hidden: true,
    attrs: { role: 'toolbar', 'aria-label': 'Ações para os cards selecionados' }
  },
  h('span', { class: 'kz-bulk__label' }, selectionCount, h('span', {}, ' selecionados')),
  bulkButton('columns', 'Mover para…', () => bulkMove()),
  bulkButton('tag', 'Aplicar tag…', () => bulkTag(true)),
  bulkButton('minus', 'Remover tag…', () => bulkTag(false)),
  bulkButton('archive', 'Arquivar', () => bulkArchive()),
  bulkButton('close', 'Limpar seleção', () => clearSelection()));

  // a barra nasce depois de `boardEl` (ordem de inicialização), então entra aqui
  boardEl.insertBefore(selectionBar, liveRegion);

  function renderSelectionBar() {
    const total = selection.size;
    selectionBar.hidden = total === 0;
    setText(selectionCount, String(total));
    if (total > 0) setText(liveRegion, `${total} card${total === 1 ? '' : 's'} selecionado${total === 1 ? '' : 's'}.`);
  }

  function selectedIds() {
    return [...selection];
  }

  async function bulkMove() {
    const state = currentState();
    const ids = selectedIds();
    if (!ids.length) return;
    const columns = state.columns || [];
    const alvo = await dialogs.openDialog({
      title: `Mover ${ids.length} card(s)`,
      body: (hh) => hh('p', { class: 'kz-dialog__text' }, 'Escolha a coluna de destino.'),
      actions: [
        { id: 'cancel', label: 'Cancelar', variant: 'ghost', value: null },
        ...columns.map((column) => ({ id: column.id, label: column.title, value: column.id }))
      ]
    });
    if (!alvo) return;
    const moves = ids
      .map((contactId) => ({ contactId, from: ((state.cards || {})[contactId] || {}).columnId }))
      .filter((m) => m.from && m.from !== alvo);
    if (!moves.length) {
      toast('Os cards já estão nessa coluna.', { duration: 3000 });
      return;
    }
    try {
      await store.actions.moveCards(moves.map((m) => m.contactId), alvo);
      const titulo = columns.find((c) => c.id === alvo);
      history.push(bulkMoveEntry(moves, alvo, `Mover ${moves.length} cards para ${titulo ? titulo.title : 'outra coluna'}`));
      toast(`${moves.length} card(s) movidos.`, {
        duration: 4500,
        action: { label: 'Desfazer', onClick: () => undoTop() }
      });
      clearSelection();
    } catch (error) {
      log.warn('[board] moveCards falhou', error);
      toast('Não foi possível mover os cards.', { type: 'error' });
    }
  }

  async function bulkTag(applied) {
    const state = currentState();
    const ids = selectedIds();
    const tags = state.tags || [];
    if (!ids.length) return;
    if (!tags.length) {
      toast('Crie uma tag antes (botão “Tags” no cabeçalho).', { type: 'warn' });
      return;
    }
    const tagId = await dialogs.openDialog({
      title: applied ? `Aplicar tag em ${ids.length} card(s)` : `Remover tag de ${ids.length} card(s)`,
      body: (hh) => hh('p', { class: 'kz-dialog__text' },
        applied ? 'Escolha a tag a aplicar.' : 'Escolha a tag a remover.'),
      actions: [
        { id: 'cancel', label: 'Cancelar', variant: 'ghost', value: null },
        ...tags.map((tag) => ({ id: tag.id, label: tag.name, value: tag.id }))
      ]
    });
    if (!tagId) return;
    // só os cards que MUDAM entram na entrada de desfazer
    const changed = ids.filter((id) => {
      const card = (state.cards || {})[id];
      if (!card) return false;
      return (card.tagIds || []).includes(tagId) !== applied;
    });
    if (!changed.length) {
      toast(applied ? 'Todos já tinham essa tag.' : 'Nenhum deles tinha essa tag.', { duration: 3000 });
      return;
    }
    try {
      if (applied) await store.actions.addTagToCards(changed, tagId);
      else await store.actions.removeTagFromCards(changed, tagId);
      const tag = tags.find((t) => t.id === tagId);
      history.push(bulkTagEntry(changed, tagId, applied,
        `${applied ? 'Aplicar' : 'Remover'} “${tag ? tag.name : 'tag'}” em ${changed.length} cards`));
      toast(`Tag ${applied ? 'aplicada em' : 'removida de'} ${changed.length} card(s).`, {
        duration: 4500,
        action: { label: 'Desfazer', onClick: () => undoTop() }
      });
      clearSelection();
    } catch (error) {
      log.warn('[board] tag em lote falhou', error);
      toast('Não foi possível alterar as tags.', { type: 'error' });
    }
  }

  async function bulkArchive() {
    const ids = selectedIds();
    if (!ids.length) return;
    await toggleArchived(ids, true);
    clearSelection();
  }

  function idOfEntry(entry) {
    if (typeof entry === 'string') return entry;
    if (!entry || typeof entry !== 'object') return null;
    return entry.contactId || entry.id || (entry.contact && entry.contact.id) || null;
  }

  /**
   * `store.select.cardsByColumn` é a fonte de verdade da composição das
   * colunas (contrato §3.5): busca, filtro de tag, só-não-lidas e ordenação
   * são responsabilidade dele. O board só normaliza o formato e completa os
   * campos que faltarem a partir do estado. A derivação local abaixo é
   * exclusivamente para o caso do select não existir ou lançar.
   */
  function entriesFromSelect(state) {
    const select = store.select;
    if (!select || typeof select.cardsByColumn !== 'function') return null;
    let raw;
    try {
      raw = select.cardsByColumn(state, filterPayload());
    } catch (error) {
      if (!selectWarned) {
        selectWarned = true;
        log.warn('[board] store.select.cardsByColumn lançou; usando derivação local', error);
      }
      return null;
    }
    let pairs = null;
    if (raw instanceof Map) pairs = Array.from(raw.entries());
    else if (Array.isArray(raw)) {
      pairs = raw.map((group) => [
        group && (group.columnId || group.id || (group.column && group.column.id)),
        group && (group.cards || group.items || group.entries)
      ]);
    } else if (raw && typeof raw === 'object') pairs = Object.entries(raw);
    if (!pairs || !pairs.length) return null;

    const tagsById = new Map((state.tags || []).map((tag) => [tag.id, tag]));
    const out = new Map();
    for (const [columnId, list] of pairs) {
      if (!columnId || !Array.isArray(list)) continue;
      const entries = [];
      for (const item of list) {
        const contactId = idOfEntry(item);
        if (!contactId) continue;
        const contact = (item && item.contact) || (state.contacts || {})[contactId];
        const card = (item && item.card) || (state.cards || {})[contactId];
        if (!contact || !card) continue;
        entries.push({
          contactId,
          contact,
          card,
          tags: Array.isArray(item && item.tags)
            ? item.tags
            : (card.tagIds || []).map((id) => tagsById.get(id)).filter(Boolean),
          followup: (item && item.followup) || (state.followups || {})[contactId] || null
        });
      }
      out.set(columnId, entries);
    }
    if (!out.size) return null;
    // toda coluna do estado precisa existir no mapa, mesmo vazia
    for (const column of state.columns || []) {
      if (!out.has(column.id)) out.set(column.id, []);
    }
    return out;
  }

  /** Plano B: só roda quando o select não existe ou lança. */
  function entriesFromState(state) {
    const query = parseSearchQuery(filters.search);
    const tagsById = new Map((state.tags || []).map((tag) => [tag.id, tag]));
    const titleById = new Map((state.columns || []).map((column) => [column.id, column.title]));
    const out = new Map();
    for (const column of state.columns || []) out.set(column.id, []);
    const firstId = (state.columns || [])[0] ? state.columns[0].id : null;
    const cards = state.cards || {};

    for (const contactId of Object.keys(cards)) {
      const card = cards[contactId];
      const contact = (state.contacts || {})[contactId];
      if (!card || !contact) continue;
      let columnId = card.columnId;
      if (!out.has(columnId)) columnId = firstId;
      if (!columnId) continue;
      if (card.archived === true && !filters.showArchived) continue;
      if (filters.hideGroups && contact.isGroup === true) continue;
      if (filters.onlyUnread && !(Number(contact.unread) > 0)) continue;
      if (filters.tagId && !(card.tagIds || []).includes(filters.tagId)) continue;
      const tags = (card.tagIds || []).map((id) => tagsById.get(id)).filter(Boolean);
      if (!matchesSearchQuery(query, {
        name: contact.name,
        preview: contact.preview,
        note: card.note,
        tags,
        column: titleById.get(columnId)
      })) continue;
      out.get(columnId).push({
        contactId,
        contact,
        card,
        tags,
        followup: (state.followups || {})[contactId] || null
      });
    }
    for (const entries of out.values()) sortEntries(entries);
    return out;
  }

  function collect(state) {
    return entriesFromSelect(state) || entriesFromState(state);
  }

  function sortEntries(entries) {
    const mode = filters.sort;
    if (mode === 'name') {
      entries.sort((a, b) => String(a.contact.name || '').localeCompare(String(b.contact.name || ''), 'pt-BR'));
    } else if (mode === 'recent') {
      entries.sort((a, b) => (b.contact.lastSeenAt || 0) - (a.contact.lastSeenAt || 0));
    } else if (mode === 'inbox') {
      entries.sort((a, b) => {
        const ai = Number.isInteger(a.contact.inboxOrder) ? a.contact.inboxOrder : Number.MAX_SAFE_INTEGER;
        const bi = Number.isInteger(b.contact.inboxOrder) ? b.contact.inboxOrder : Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return (a.card.order || 0) - (b.card.order || 0);
      });
    } else {
      entries.sort((a, b) => (a.card.order || 0) - (b.card.order || 0));
    }
  }

  /* ------------------------------- render ------------------------------ */

  /**
   * Preferências que também são filtros do cabeçalho. O `paint` pode ser
   * chamado com um estado ANTIGO (é o que acontece logo depois de o usuário
   * mexer no filtro, antes de a escrita voltar do store): comparar direto com
   * `settings` desfazia a ação que o usuário acabara de fazer. Por isso só
   * adotamos o valor de `settings` quando ele MUDOU desde a última leitura —
   * aí sim é mudança externa (outra aba, tela de Configurações).
   */
  const settingsSeen = { onlyUnread: null, hideGroups: null, showArchived: null, sort: null };

  function adoptSettings(settings) {
    for (const key of ['onlyUnread', 'hideGroups', 'showArchived']) {
      if (typeof settings[key] !== 'boolean' && settingsSeen[key] !== null) continue;
      const value = settings[key] === true;
      if (settingsSeen[key] === null || value !== settingsSeen[key]) {
        settingsSeen[key] = value;
        filters[key] = value;
      }
    }
    const sort = typeof settings.sort === 'string' && settings.sort ? settings.sort : null;
    if (sort && (settingsSeen.sort === null || sort !== settingsSeen.sort)) {
      settingsSeen.sort = sort;
      filters.sort = sort;
    }
  }

  function applyCollapsed(view, collapsed) {
    view.collapsed = Boolean(collapsed);
    view.colEl.classList.toggle('is-collapsed', view.collapsed);
    view.collapseBtn.setAttribute('aria-expanded', String(!view.collapsed));
    view.collapseBtn.setAttribute('aria-label', view.collapsed ? 'Expandir coluna' : 'Recolher coluna');
  }

  const cardHandlers = {
    isDragging: () => dnd.isDragging(),
    onOpenChat: (contactId) => openChat(contactId),
    onCardClick: (contactId, event) => onCardClick(contactId, event),
    onTags: (contactId) => openTagPicker(viewCtx, contactId),
    onTemplate: (contactId) => openTemplatePicker(viewCtx, contactId),
    onFollowup: (contactId) => openFollowupScheduler(viewCtx, contactId),
    onNote: (contactId) => openNoteEditor(viewCtx, contactId),
    onArchive: (contactId) => toggleArchived([contactId])
  };

  /**
   * Arquiva/desarquiva em UMA escrita, com entrada única na pilha de desfazer.
   * O alvo do "toggle" é o estado do primeiro card: em lote, todos seguem ele.
   */
  async function toggleArchived(ids, force) {
    const list = [...new Set((ids || []).filter(Boolean))];
    if (!list.length) return;
    const state = currentState();
    const first = (state.cards || {})[list[0]];
    const archived = typeof force === 'boolean' ? force : !(first && first.archived === true);
    if (typeof store.actions.setArchived !== 'function') {
      toast('Arquivamento indisponível nesta versão.', { type: 'warn' });
      return;
    }
    try {
      await store.actions.setArchived(list, archived);
      history.push(archiveEntry(
        list,
        archived,
        list.length === 1
          ? `${archived ? 'Arquivar' : 'Desarquivar'} ${nameOf(state, list[0])}`
          : `${archived ? 'Arquivar' : 'Desarquivar'} ${list.length} cards`
      ));
      const aviso = archived
        ? `${list.length === 1 ? nameOf(state, list[0]) : `${list.length} cards`} fora do funil. Nada foi apagado.`
        : `${list.length === 1 ? nameOf(state, list[0]) : `${list.length} cards`} de volta ao funil.`;
      toast(aviso, { duration: 4500, action: { label: 'Desfazer', onClick: () => undoTop() } });
      setText(liveRegion, aviso);
    } catch (error) {
      log.warn('[board] setArchived falhou', error);
      toast('Não foi possível arquivar.', { type: 'error' });
    }
  }

  async function openChat(contactId) {
    const state = lastState || store.getState();
    const contact = (state.contacts || {})[contactId];
    if (!contact) return;
    if (!composer || typeof composer.openChat !== 'function') {
      toast('Abertura de conversa indisponível nesta tela.', { type: 'warn' });
      return;
    }
    if (onClose) onClose();
    try {
      const result = await composer.openChat(contact);
      if (result && result.ok === false) {
        // o motivo vem do composer: dizer "não deu" sem dizer por quê foi o que
        // fez o usuário culpar a extensão quando a conversa até abriu
        const motivo = result.reason ? ` ${result.reason}` : '';
        toast(`Não foi possível abrir a conversa de ${contact.name}.${motivo} Capture as conversas ou role a lista lateral e tente de novo.`, { type: 'error' });
        log.warn('[board] openChat não confirmou', { id: contactId, steps: result.steps });
      }
    } catch (error) {
      log.warn('[board] openChat falhou', error);
      toast('Falha ao abrir a conversa.', { type: 'error' });
    }
  }

  function ensureColumnView(column) {
    let view = columnViews.get(column.id);
    if (view) return view;

    const titleEl = h('span', {
      class: 'kz-col__title',
      attrs: { tabindex: '0', role: 'button', title: 'Duplo clique para renomear; Alt+setas move a coluna' },
      onDblClick: () => startInlineRename(view, view.column),
      onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          startInlineRename(view, view.column);
        } else if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          moveColumn(lastState || store.getState(), column.id, event.key === 'ArrowLeft' ? -1 : 1);
        }
      }
    });

    const badgeEl = h('span', { class: 'kz-col__badge' }, '0');

    const collapseBtn = h('button', {
      class: 'kz-iconbtn',
      type: 'button',
      attrs: { 'aria-label': 'Recolher coluna', title: 'Recolher/expandir' },
      onClick: () => {
        const next = !view.collapsed;
        applyCollapsed(view, next);
        if (typeof store.actions.setColumnCollapsed === 'function') {
          Promise.resolve(store.actions.setColumnCollapsed(view.column.id, next)).catch((error) => {
            log.warn('[board] setColumnCollapsed falhou', error);
            applyCollapsed(view, view.column.collapsed === true);
            toast('Não foi possível salvar o estado da coluna.', { type: 'error' });
          });
        }
      }
    }, icon('chevronDown', { size: 15 }));

    const listEl = h('div', {
      class: 'kz-col__body',
      attrs: { role: 'list', 'aria-label': `Cards de ${column.title}` }
    });

    const moreBtn = h('button', {
      class: 'kz-btn kz-btn--ghost kz-col__more',
      type: 'button',
      hidden: true,
      onClick: () => {
        view.limit += PAGE_SIZE;
        if (lastState) paint(lastState);
      }
    }, 'Mostrar mais');

    const headEl = h('div', {
      class: 'kz-col__head',
      onPointerDown: (event) => onColumnPointerDown(event, view)
    },
    collapseBtn,
    titleEl,
    badgeEl,
    h('div', { class: 'kz-col__actions' },
      h('button', {
        class: 'kz-iconbtn',
        type: 'button',
        attrs: { 'aria-label': 'Renomear coluna', title: 'Renomear' },
        onClick: () => renameColumn(view, view.column)
      }, icon('edit', { size: 15 })),
      h('button', {
        class: 'kz-iconbtn',
        type: 'button',
        attrs: { 'aria-label': 'Cor e limite WIP da coluna', title: 'Cor e limite WIP' },
        onClick: () => editColumn(view.column)
      }, icon('settings', { size: 15 })),
      h('button', {
        class: 'kz-iconbtn',
        type: 'button',
        attrs: { 'aria-label': 'Excluir coluna', title: 'Excluir' },
        onClick: () => removeColumn(view.column, lastState || store.getState())
      }, icon('trash', { size: 15 }))));

    const colEl = h('div', {
      class: 'kz-col',
      dataset: { columnId: column.id }
    }, headEl, listEl, h('div', { class: 'kz-col__foot' }, moreBtn));

    view = {
      columnId: column.id,
      column,
      colEl,
      headEl,
      listEl,
      titleEl,
      collapseBtn,
      badgeEl,
      moreBtn,
      emptyEl: null,
      limit: PAGE_SIZE,
      collapsed: false,
      editing: false,
      title: column.title
    };
    columnViews.set(column.id, view);
    return view;
  }

  function renderColumns(state) {
    const columns = state.columns || [];
    const wanted = new Set(columns.map((c) => c.id));

    for (const [columnId, view] of Array.from(columnViews.entries())) {
      if (!wanted.has(columnId)) {
        if (view.colEl.parentNode) view.colEl.parentNode.removeChild(view.colEl);
        columnViews.delete(columnId);
      }
    }

    let cursor = columnsEl.firstChild;
    for (const column of columns) {
      const view = ensureColumnView(column);
      view.column = column;
      view.title = column.title;
      if (view.colEl === cursor) {
        cursor = cursor.nextSibling;
      } else {
        columnsEl.insertBefore(view.colEl, cursor);
      }
      if (!view.editing) setText(view.titleEl, column.title);
      view.colEl.style.borderTopColor = column.color || 'var(--kz-accent)';
      view.listEl.setAttribute('aria-label', `Cards de ${column.title}`);
      applyCollapsed(view, column.collapsed === true);
    }
    return columns;
  }

  /**
   * Remove os cards que não aparecem em nenhuma coluna. A remoção é global e
   * independente do pai: depois de um arraste o nó pode estar em outra lista.
   */
  function pruneCards(wantedAll) {
    for (const [contactId, cardView] of Array.from(cardViews.entries())) {
      if (wantedAll.has(contactId)) continue;
      cardView.el.remove();
      cardViews.delete(contactId);
    }
  }

  function renderCards(view, entries, limited, now) {
    const listEl = view.listEl;

    // cria/atualiza/reordena reaproveitando os nós existentes; `insertBefore`
    // re-parenteia sozinho o nó que veio de outra coluna pelo arraste.
    let cursor = listEl.firstChild;
    for (const entry of limited) {
      let cardView = cardViews.get(entry.contactId);
      if (!cardView) {
        cardView = createCard(entry.contactId, cardHandlers);
        cardViews.set(entry.contactId, cardView);
      }
      cardView.update({ contact: entry.contact, card: entry.card, tags: entry.tags, followup: entry.followup, now });
      const chosen = selection.has(entry.contactId);
      cardView.el.setAttribute('aria-selected', String(chosen));
      cardView.el.classList.toggle('is-selected', chosen);

      // pula o placeholder do drag e o card que está sendo arrastado
      while (cursor && cursor !== cardView.el && isSkippable(cursor)) {
        cursor = cursor.nextSibling;
      }
      if (cursor === cardView.el) {
        cursor = cursor.nextSibling;
      } else if (!cardView.el.classList.contains('is-dragging')) {
        listEl.insertBefore(cardView.el, cursor);
      }
    }

    // estado vazio da coluna
    const isEmpty = limited.length === 0;
    if (isEmpty && !view.emptyEl) {
      view.emptyEl = h('div', { class: 'kz-empty' },
        icon('inbox', { size: 22 }),
        h('span', { class: 'kz-empty__title' }, 'Nenhum card aqui'),
        h('span', { class: 'kz-empty__text' }, 'Arraste um contato para esta coluna ou ajuste os filtros.'));
      listEl.appendChild(view.emptyEl);
    } else if (!isEmpty && view.emptyEl) {
      if (view.emptyEl.parentNode === listEl) listEl.removeChild(view.emptyEl);
      view.emptyEl = null;
    }

    const hidden = entries.length - limited.length;
    view.moreBtn.hidden = hidden <= 0;
    if (hidden > 0) setText(view.moreBtn, `Mostrar mais (${hidden})`);

    const limit = view.column.wipLimit;
    setText(view.badgeEl, limit ? `${entries.length}/${limit}` : String(entries.length));
    view.badgeEl.classList.toggle('is-over', Boolean(limit) && entries.length > limit);
    view.badgeEl.setAttribute('title', limit
      ? `${entries.length} de ${limit} cards (limite WIP)`
      : `${entries.length} cards · sem limite WIP`);
  }

  function renderTagFilter(state) {
    const tags = state.tags || [];
    const signature = tags.map((tag) => `${tag.id}:${tag.name}`).join('|');
    if (tagFilter.dataset.signature === signature) return;
    tagFilter.dataset.signature = signature;
    const current = filters.tagId;
    while (tagFilter.children.length > 1) tagFilter.removeChild(tagFilter.lastChild);
    for (const tag of tags) tagFilter.appendChild(h('option', { value: tag.id }, tag.name));
    tagFilter.value = tags.some((tag) => tag.id === current) ? current : '';
    filters.tagId = tagFilter.value;
  }

  function renderHealth() {
    const health = (adapter && adapter.health) || null;
    if (!health) {
      healthBtn.dataset.state = 'ok';
      setText(healthText, 'Diagnóstico');
      return;
    }
    const degraded = Boolean(health.degraded);
    const down = health.ok === false;
    healthBtn.dataset.state = down ? 'down' : degraded ? 'degraded' : 'ok';
    if (down) setText(healthText, 'WhatsApp não detectado');
    else if (degraded) setText(healthText, 'Leitura parcial');
    else setText(healthText, `Leitura ok · ${health.rowsFound || 0} conversas`);
    const qualityPct = typeof health.quality === 'number' ? ` · qualidade: ${Math.round(health.quality * 100)}%` : '';
    healthBtn.setAttribute('title', `Estratégia: ${health.strategy || '—'} · confiança: ${health.confidence != null ? health.confidence : '—'}${qualityPct}`);

    const showBanner = down || degraded;
    banner.hidden = !showBanner;
    if (showBanner) {
      const text = down
        ? 'Não foi possível localizar a lista de conversas do WhatsApp. Abra web.whatsapp.com, aguarde carregar e clique em Atualizar. Os cards abaixo vêm do que já estava salvo.'
        : `O layout do WhatsApp mudou e a extração está parcial (estratégia "${health.strategy || 'desconhecida'}", confiança ${health.confidence != null ? health.confidence : '—'}${qualityPct}). Alguns nomes, avatares ou contadores podem faltar — confira no diagnóstico antes de confiar nos cards.${health.lastError ? ` Último erro: ${health.lastError}` : ''}`;
      setText(banner.querySelector('.kz-banner__text'), text);
    }
  }

  function renderBoardEmpty(state, totalVisible) {
    const model = boardEmptyModel({
      hasContacts: Object.keys(state.contacts || {}).length > 0,
      totalVisible,
      filtering: Boolean(filters.search || filters.tagId || filters.onlyUnread),
      down: Boolean(adapter && adapter.health && adapter.health.ok === false)
    });
    columnsEl.hidden = false;
    if (!model.needs) {
      if (emptyBoardEl) {
        emptyBoardEl.remove();
        emptyBoardEl = null;
        emptyBoardKind = '';
      }
      return;
    }
    // o nó é criado uma vez, mas o TEXTO acompanha o estado: um arranque a frio
    // começa sem contatos e só depois descobre que o WhatsApp não está lá
    if (!emptyBoardEl) {
      emptyBoardEl = h('div', { class: 'kz-empty kz-empty--board' },
        h('span', { class: 'kz-empty__icon' }),
        h('span', { class: 'kz-empty__title' }),
        h('span', { class: 'kz-empty__text' }),
        h('button', { class: 'kz-btn kz-btn--primary', type: 'button', onClick: () => onRefresh && onRefresh() },
          icon('refresh', { size: 15 }), 'Atualizar agora'));
      columnsEl.parentNode.insertBefore(emptyBoardEl, columnsEl);
      emptyBoardKind = '';
    }
    if (emptyBoardKind !== model.kind) {
      emptyBoardKind = model.kind;
      const iconSlot = emptyBoardEl.querySelector('.kz-empty__icon');
      clear(iconSlot);
      iconSlot.appendChild(icon(model.icon, { size: 34 }));
      setText(emptyBoardEl.querySelector('.kz-empty__title'), model.title);
      setText(emptyBoardEl.querySelector('.kz-empty__text'), model.text);
    }
  }

  function paint(state) {
    lastState = state;
    adoptSettings(state.settings || {});
    if (sortSelect.value !== filters.sort) sortSelect.value = filters.sort;
    if (unreadToggle.checked !== filters.onlyUnread) unreadToggle.checked = filters.onlyUnread;
    if (groupsToggle.checked !== filters.hideGroups) groupsToggle.checked = filters.hideGroups;
    if (archivedToggle.checked !== filters.showArchived) archivedToggle.checked = filters.showArchived;

    renderTagFilter(state);
    const columns = renderColumns(state);
    const byColumn = collect(state);
    const now = Date.now();
    let totalVisible = 0;

    // 1ª passada: recorta por coluna e junta o conjunto do quadro inteiro.
    const planned = new Map();
    const wantedAll = new Set();
    for (const column of columns) {
      const view = columnViews.get(column.id);
      const entries = byColumn.get(column.id) || [];
      const limited = entries.slice(0, view.limit);
      totalVisible += entries.length;
      planned.set(column.id, { entries, limited });
      for (const entry of limited) wantedAll.add(entry.contactId);
    }

    // 2ª passada: poda global antes de posicionar, senão um card que mudou de
    // coluna seria removido logo depois de ser inserido no destino.
    pruneCards(wantedAll);

    for (const column of columns) {
      const { entries, limited } = planned.get(column.id);
      renderCards(columnViews.get(column.id), entries, limited, now);
    }

    const totalCards = Object.keys(state.cards || {}).length;
    setText(countEl, totalVisible === totalCards
      ? `${totalCards} contato${totalCards === 1 ? '' : 's'}`
      : `${totalVisible} de ${totalCards}`);

    // seleção não sobrevive a um card que sumiu da tela (filtro, arquivamento)
    for (const id of [...selection]) if (!wantedAll.has(id)) selection.delete(id);
    if (anchorId && !selection.has(anchorId)) anchorId = selection.size ? anchorId : null;
    renderSelectionBar();

    renderHealth();
    renderBoardEmpty(state, totalVisible);
  }

  /** Atualiza o quadro. Durante um drag o update é adiado para não matá-lo. */
  function update(state) {
    if (dnd.isBusy()) {
      pendingState = state;
      if (!pendingSince) pendingSince = Date.now();
      if (!pendingTimer) pendingTimer = window.setTimeout(flushPending, 500);
      return;
    }
    pendingState = null;
    pendingSince = 0;
    try {
      paint(state);
    } catch (error) {
      log.warn('[board] falha ao renderizar', error);
    }
  }

  function flushPending() {
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
      pendingTimer = 0;
    }
    if (!pendingState) return;
    if (dnd.isBusy()) {
      // um arraste que nunca termina (pointerup perdido) não pode congelar o
      // quadro para sempre: passado o limite, cancela o arraste e repinta
      if (pendingSince && Date.now() - pendingSince > MAX_PENDING_MS) {
        log.warn('[board] arraste preso por tempo demais; cancelando para voltar a repintar');
        dnd.cancel();
      } else {
        pendingTimer = window.setTimeout(flushPending, 500);
        return;
      }
    }
    pendingState = null;
    pendingSince = 0;
    // o estado retido pode estar velho; o do store é sempre o mais novo, e é
    // ele que faz o DOM voltar a concordar com o store depois de um cancelamento
    let state = null;
    try {
      state = typeof store.getState === 'function' ? store.getState() : null;
    } catch (error) {
      log.warn('[board] getState falhou no flush', error);
    }
    update(state || lastState);
  }

  /**
   * Topo da pilha do Esc dentro do quadro (contrato §5.6). Devolve `true`
   * quando alguma coisa foi cancelada — aí o quadro NÃO deve fechar.
   */
  function handleEscape() {
    if (dnd.cancel()) {
      flushPending();
      return true;
    }
    if (renameSession) {
      renameSession.cancel();
      renameSession = null;
      return true;
    }
    // seleção múltipla vem ANTES da busca preenchida (roadmap §4)
    if (selection.size) {
      clearSelection();
      setText(liveRegion, 'Seleção limpa.');
      return true;
    }
    if (searchInput.value) {
      searchInput.value = '';
      filters.search = '';
      if (lastState) paint(lastState);
      searchInput.focus();
      return true;
    }
    return false;
  }

  return {
    el: boardEl,
    update,
    flushPending,
    handleEscape,
    undo: undoTop,
    redo: redoTop,
    history,
    focusSearch() {
      searchInput.focus();
      searchInput.select();
    },
    refreshHealth: renderHealth,
    destroy() {
      window.clearTimeout(searchTimer);
      window.clearTimeout(pendingTimer);
      window.removeEventListener('pointermove', onColumnPointerMove);
      window.removeEventListener('pointerup', onColumnPointerUp);
      dnd.destroy();
      columnViews.clear();
      cardViews.clear();
      if (emptyBoardEl) {
        emptyBoardEl.remove();
        emptyBoardEl = null;
      }
    }
  };
}
