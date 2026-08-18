/**
 * sweeper.js — varredura da lista lateral do WhatsApp.
 *
 * Por que existe: a lista de conversas é virtualizada. Só existem ~15–25 linhas
 * no DOM, então o adapter (e o auto-refresh) enxergam sempre as mesmas. Sem
 * varredura o funil nasce com 20 dos 300 contatos e o usuário não tem como
 * saber disso.
 *
 * Regras duras desta camada:
 * - o `scrollTop` original é restaurado em TODOS os caminhos (fim normal, erro,
 *   exceção do `onProgress`, cancelamento). Terminar a captura com a lista
 *   parada em outro lugar é pior do que não capturar;
 * - o auto-refresh fica suspenso enquanto a varredura roda (dois leitores
 *   disputando a mesma lista só produzem lixo);
 * - nunca lança: erro vira `{ ok:false, reason }`.
 */

const DEFAULTS = Object.freeze({
  stepTimeoutMs: 400,   // teto para o DOM assentar depois de cada rolagem
  maxSteps: 300,        // teto absoluto de passos
  maxMs: 90000,         // teto absoluto de tempo
  scrollRatio: 0.8,     // rola ~80% da altura visível por passo
  noNewLimit: 3,        // 3 passos sem id novo = fim
  maxScrollerNodes: 600 // orçamento da busca pelo elemento rolável
});

function numberOption(value, fallback, min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

/**
 * @param {{adapter?: object, logger?: object, win?: Window,
 *          onBatch?: (chats: Array) => any,
 *          suspendRefresh?: () => (() => void)|void}} [options]
 */
export function createSweeper(options = {}) {
  const adapter = options.adapter || null;
  const logger = options.logger || null;
  const win = options.win || (typeof window !== 'undefined' ? window : null);
  const onBatch = typeof options.onBatch === 'function' ? options.onBatch : null;
  const suspendRefresh = typeof options.suspendRefresh === 'function' ? options.suspendRefresh : null;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

  const cfg = {
    stepTimeoutMs: numberOption(options.stepTimeoutMs, DEFAULTS.stepTimeoutMs, 1),
    maxSteps: numberOption(options.maxSteps, DEFAULTS.maxSteps, 1),
    maxMs: numberOption(options.maxMs, DEFAULTS.maxMs, 1),
    scrollRatio: numberOption(options.scrollRatio, DEFAULTS.scrollRatio, 0.1),
    noNewLimit: numberOption(options.noNewLimit, DEFAULTS.noNewLimit, 1),
    maxScrollerNodes: numberOption(options.maxScrollerNodes, DEFAULTS.maxScrollerNodes, 1)
  };

  let running = false;

  function log(level, ...args) {
    if (logger && typeof logger[level] === 'function') logger[level](...args);
  }

  function overflowOf(el) {
    if (!win || typeof win.getComputedStyle !== 'function') return null;
    try {
      const style = win.getComputedStyle(el);
      return style ? String(style.overflowY || style.overflow || '') : null;
    } catch {
      return null;
    }
  }

  /** Rolável = tem conteúdo além da área visível e não bloqueia o overflow. */
  function isScrollable(el) {
    if (!el || el.nodeType !== 1) return false;
    const scrollHeight = Number(el.scrollHeight);
    const clientHeight = Number(el.clientHeight);
    if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return false;
    if (scrollHeight - clientHeight <= 8) return false;
    const overflow = overflowOf(el);
    // sem `getComputedStyle` (bancada/stub) a diferença de altura já basta
    if (overflow == null || overflow === '') return true;
    return /auto|scroll|overlay/.test(overflow);
  }

  function childrenOf(el) {
    const kids = el && el.children;
    if (!kids) return [];
    return Array.prototype.slice.call(kids);
  }

  /**
   * O elemento rolável pode ser o próprio pane, um descendente (o WhatsApp
   * costuma pôr um wrapper de scroll dentro) ou um ancestral próximo.
   * @returns {Element|null}
   */
  function findScroller() {
    const pane = adapter && adapter.pane ? adapter.pane : null;
    if (!pane) return null;
    if (isScrollable(pane)) return pane;

    const queue = childrenOf(pane);
    let visited = 0;
    while (queue.length && visited < cfg.maxScrollerNodes) {
      const node = queue.shift();
      visited += 1;
      if (isScrollable(node)) return node;
      for (const child of childrenOf(node)) queue.push(child);
    }

    let parent = pane.parentElement || null;
    let hops = 0;
    while (parent && hops < 4) {
      if (isScrollable(parent)) return parent;
      parent = parent.parentElement || null;
      hops += 1;
    }
    return null;
  }

  /** Espera o DOM assentar após a rolagem: mutação + rAF, com teto de tempo. */
  function settle(scroller) {
    return new Promise((resolve) => {
      let done = false;
      let observer = null;
      let timer = null;
      let frame = 0;

      const finish = () => {
        if (done) return;
        done = true;
        if (observer) {
          try {
            observer.disconnect();
          } catch {
            /* já desconectado */
          }
        }
        if (timer) clearTimeout(timer);
        if (frame && win && typeof win.cancelAnimationFrame === 'function') {
          win.cancelAnimationFrame(frame);
        }
        resolve();
      };

      const afterMutation = () => {
        if (done) return;
        if (win && typeof win.requestAnimationFrame === 'function') {
          frame = win.requestAnimationFrame(finish);
        } else {
          finish();
        }
      };

      const Observer = (win && win.MutationObserver)
        || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
      if (Observer) {
        try {
          observer = new Observer(afterMutation);
          observer.observe(scroller, { childList: true, subtree: true });
        } catch {
          observer = null;
        }
      }
      timer = setTimeout(finish, cfg.stepTimeoutMs);
    });
  }

  function readChats() {
    if (!adapter || typeof adapter.listChats !== 'function') return [];
    const chats = adapter.listChats();
    return Array.isArray(chats) ? chats : [];
  }

  /**
   * Varre a lista inteira.
   * @param {{onProgress?: (p: {found:number, step:number, done:boolean}) => void,
   *          signal?: {aborted: boolean}}} [params]
   * @returns {Promise<{ok:boolean, found:number, batches:number, stopped:boolean, reason:string}>}
   */
  async function run(params = {}) {
    const onProgress = typeof params.onProgress === 'function' ? params.onProgress : null;
    const signal = params.signal || null;

    if (running) {
      return { ok: false, found: 0, batches: 0, stopped: true, reason: 'em-andamento' };
    }
    running = true;

    /** id → posição de descoberta (vira `inboxOrder` e conserta a ordem da caixa). */
    const order = new Map();
    let batches = 0;
    let step = 0;
    let stopped = false;
    let reason = '';
    let ok = false;
    let scroller = null;
    let originalScrollTop = 0;
    let resume = null;
    let progressBroken = false;
    const started = now();

    /** @returns {boolean} false quando o `onProgress` do chamador lançou. */
    const emit = (done) => {
      if (!onProgress || progressBroken) return true;
      try {
        onProgress({ found: order.size, step, done: Boolean(done) });
        return true;
      } catch (error) {
        progressBroken = true;
        log('warn', '[sweeper] onProgress lançou; interrompendo a varredura', error);
        return false;
      }
    };

    try {
      if (adapter && typeof adapter.probe === 'function') {
        try {
          adapter.probe(!adapter.pane);
        } catch (error) {
          log('warn', '[sweeper] probe falhou', error);
        }
      }

      scroller = findScroller();
      if (!scroller) {
        reason = 'sem-scroller';
        stopped = true;
        return { ok: false, found: 0, batches: 0, stopped, reason };
      }

      originalScrollTop = Number(scroller.scrollTop) || 0;

      if (suspendRefresh) {
        try {
          const maybe = suspendRefresh();
          if (typeof maybe === 'function') resume = maybe;
        } catch (error) {
          log('warn', '[sweeper] não foi possível suspender o auto-refresh', error);
        }
      }

      // Começa do topo: varrer só do ponto onde o usuário parou deixaria de
      // fora tudo o que está acima, que é justamente o que ele já conversou.
      if (originalScrollTop > 0) {
        scroller.scrollTop = 0;
        await settle(scroller);
      }

      let noNew = 0;
      for (;;) {
        if (signal && signal.aborted) {
          stopped = true;
          reason = 'cancelado';
          break;
        }
        if (step >= cfg.maxSteps) {
          stopped = true;
          reason = 'teto-passos';
          break;
        }
        if (now() - started >= cfg.maxMs) {
          stopped = true;
          reason = 'teto-tempo';
          break;
        }
        step += 1;

        const chats = readChats();
        batches += 1;
        let fresh = 0;
        const batch = [];
        for (const chat of chats) {
          if (!chat || !chat.id) continue;
          if (!order.has(chat.id)) {
            order.set(chat.id, order.size);
            fresh += 1;
          }
          batch.push({ ...chat, inboxOrder: order.get(chat.id) });
        }
        ok = true;

        if (batch.length && onBatch) {
          try {
            await onBatch(batch);
          } catch (error) {
            log('warn', '[sweeper] consumidor do lote falhou', error);
          }
        }
        if (!emit(false)) {
          stopped = true;
          reason = 'erro-progresso';
          break;
        }

        noNew = fresh > 0 ? 0 : noNew + 1;
        if (noNew >= cfg.noNewLimit) {
          reason = 'sem-novos';
          break;
        }

        const before = Number(scroller.scrollTop) || 0;
        const viewport = Number(scroller.clientHeight) || 0;
        const total = Number(scroller.scrollHeight) || 0;
        const delta = Math.max(40, Math.floor(viewport * cfg.scrollRatio));
        const ceiling = Math.max(0, total - viewport);
        scroller.scrollTop = Math.min(before + delta, ceiling);
        await settle(scroller);
        const after = Number(scroller.scrollTop) || 0;
        if (after === before) {
          reason = 'fim-da-lista';
          break;
        }
      }
    } catch (error) {
      ok = false;
      stopped = true;
      reason = reason || 'erro';
      log('error', '[sweeper] varredura falhou', error);
    } finally {
      // restauração incondicional: é o ponto mais importante deste módulo
      if (scroller) {
        try {
          scroller.scrollTop = originalScrollTop;
        } catch (error) {
          log('warn', '[sweeper] não foi possível restaurar a rolagem', error);
        }
      }
      if (resume) {
        try {
          resume();
        } catch (error) {
          log('warn', '[sweeper] não foi possível religar o auto-refresh', error);
        }
      }
      running = false;
      emit(true);
    }

    return { ok, found: order.size, batches, stopped, reason };
  }

  return {
    run,
    isRunning: () => running,
    findScroller
  };
}
