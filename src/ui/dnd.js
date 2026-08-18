/**
 * dnd.js — arrastar e soltar por Pointer Events (mouse + toque) com
 * alternativa completa por teclado.
 *
 * O módulo só mexe no DOM e devolve a intenção de movimento para o board
 * (`onDrop(contactId, { columnId, beforeId })`); quem traduz isso para o
 * índice do store é o board, porque só ele conhece a coluna completa
 * (a lista visível pode estar filtrada ou virtualizada).
 *
 * Teclado: Espaço pega/solta, ←/→ trocam de coluna, ↑/↓ movem na coluna,
 * Esc cancela e devolve o card à posição de origem.
 */
import { h } from './h.js';

const DRAG_THRESHOLD = 6;
const EDGE = 72;
const EDGE_SPEED = 18;
/** Tolerância vertical/horizontal para aceitar uma coluna vizinha (px). */
export const DROP_TOLERANCE = 40;
/** Um arraste que passa disto sem `pointerup` é um arraste órfão. */
const STALE_DRAG_MS = 15000;

function cardIdOf(node) {
  return node && node.dataset ? node.dataset.cardId || null : null;
}

/**
 * Escolhe a coluna sob o ponto. Função pura para poder ser testada em Node.
 *
 * Fora da faixa VERTICAL das colunas (cabeçalho do quadro, área abaixo do
 * rodapé) não existe coluna válida: devolver a "mais próxima em x" fazia um
 * card solto sobre o cabeçalho mudar de coluna sem o usuário pedir.
 *
 * @param {Array<{rect: {top,left,right,bottom}}>} entries
 * @returns {object|null}
 */
export function pickColumnAt(entries, x, y, tolerance = DROP_TOLERANCE) {
  const list = (entries || []).filter((item) => item && item.rect);
  if (!list.length) return null;
  let fallback = null;
  let bestDistance = Infinity;
  for (const item of list) {
    const rect = item.rect;
    const insideY = y >= rect.top - tolerance && y <= rect.bottom + tolerance;
    if (!insideY) continue;
    if (x >= rect.left - 1 && x <= rect.right + 1) return item;
    const distance = x < rect.left ? rect.left - x : x - rect.right;
    if (distance < bestDistance) {
      bestDistance = distance;
      fallback = item;
    }
  }
  return fallback;
}

function cardsIn(listEl, exclude) {
  return Array.from(listEl.children).filter(
    (node) => node.classList && node.classList.contains('kz-card') && node !== exclude
  );
}

export function createDnd({ scroller, getColumns, onDrop, announce = () => {} }) {
  let drag = null;      // arraste por ponteiro
  let grab = null;      // arraste por teclado
  let suppressUntil = 0;
  let rafId = 0;
  let scrollRaf = 0;
  let staleTimer = 0;
  let lastPoint = null;

  /**
   * Se um `pointerup` se perder (aba perde o foco, captura de ponteiro some),
   * `drag` ficaria preso e o quadro pararia de repintar para sempre. O
   * watchdog desfaz o arraste sem comitar nada.
   */
  function armStaleWatchdog() {
    if (staleTimer) window.clearTimeout(staleTimer);
    staleTimer = window.setTimeout(() => {
      staleTimer = 0;
      if (drag) cleanupDrag(false);
    }, STALE_DRAG_MS);
  }

  function onInterrupted() {
    if (drag) cleanupDrag(false);
  }

  function onVisibilityChange() {
    if (document.hidden) onInterrupted();
  }

  const placeholder = h('div', { class: 'kz-placeholder', attrs: { 'aria-hidden': 'true' } });

  function columns() {
    return (getColumns() || []).filter((c) => c && c.listEl && !c.collapsed);
  }

  function columnAt(x, y) {
    const entries = columns().map((col) => ({ col, rect: col.colEl.getBoundingClientRect() }));
    const picked = pickColumnAt(entries, x, y);
    return picked ? picked.col : null;
  }

  function placePlaceholder(col, y, dragged) {
    const items = cardsIn(col.listEl, dragged);
    let reference = null;
    for (const item of items) {
      if (item === placeholder) continue;
      const rect = item.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        reference = item;
        break;
      }
    }
    if (placeholder.parentNode === col.listEl && placeholder.nextSibling === reference) return;
    col.listEl.insertBefore(placeholder, reference);
  }

  function beforeIdFromPlaceholder() {
    let node = placeholder.nextSibling;
    while (node && !(node.classList && node.classList.contains('kz-card'))) node = node.nextSibling;
    return cardIdOf(node);
  }

  function autoScroll() {
    scrollRaf = 0;
    if (!drag || !lastPoint) return;
    const rect = scroller.getBoundingClientRect();
    let dx = 0;
    if (lastPoint.x < rect.left + EDGE) dx = -EDGE_SPEED * ((rect.left + EDGE - lastPoint.x) / EDGE);
    else if (lastPoint.x > rect.right - EDGE) dx = EDGE_SPEED * ((lastPoint.x - (rect.right - EDGE)) / EDGE);
    if (dx) scroller.scrollLeft += dx;

    // rolagem vertical dentro da coluna sob o ponteiro
    const col = columnAt(lastPoint.x, lastPoint.y);
    if (col) {
      const listRect = col.listEl.getBoundingClientRect();
      let dy = 0;
      if (lastPoint.y < listRect.top + EDGE) dy = -EDGE_SPEED * ((listRect.top + EDGE - lastPoint.y) / EDGE);
      else if (lastPoint.y > listRect.bottom - EDGE) dy = EDGE_SPEED * ((lastPoint.y - (listRect.bottom - EDGE)) / EDGE);
      if (dy) col.listEl.scrollTop += dy;
    }
    scrollRaf = window.requestAnimationFrame(autoScroll);
  }

  function beginDrag(event) {
    const card = drag.card;
    const rect = card.getBoundingClientRect();
    drag.started = true;
    drag.offsetX = drag.startX - rect.left;
    drag.offsetY = drag.startY - rect.top;
    drag.originList = card.parentNode;
    drag.originNext = card.nextSibling;

    placeholder.style.height = `${rect.height}px`;
    card.parentNode.insertBefore(placeholder, card);

    card.style.setProperty('--kz-drag-w', `${rect.width}px`);
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    card.classList.add('is-dragging');
    card.setAttribute('aria-grabbed', 'true');

    for (const col of columns()) col.colEl.classList.add('is-drop-zone');
    moveDrag(event);
    if (!scrollRaf) scrollRaf = window.requestAnimationFrame(autoScroll);
  }

  function moveDrag(event) {
    lastPoint = { x: event.clientX, y: event.clientY };
    if (rafId) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      if (!drag || !drag.started || !lastPoint) return;
      const { card } = drag;
      card.style.left = `${lastPoint.x - drag.offsetX}px`;
      card.style.top = `${lastPoint.y - drag.offsetY}px`;
      const col = columnAt(lastPoint.x, lastPoint.y);
      // compara por id: cada chamada de columns() devolve objetos novos
      for (const other of columns()) {
        other.colEl.classList.toggle('is-drop-target', Boolean(col) && other.columnId === col.columnId);
      }
      if (col) {
        drag.targetColumn = col;
        placePlaceholder(col, lastPoint.y, card);
      } else {
        // fora de qualquer coluna: sem alvo e sem marcador — soltar aqui
        // devolve o card para a posição de origem
        drag.targetColumn = null;
        if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
      }
    });
  }

  function cleanupDrag(commit) {
    if (!drag) return;
    const { card } = drag;
    if (staleTimer) {
      window.clearTimeout(staleTimer);
      staleTimer = 0;
    }
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (scrollRaf) {
      window.cancelAnimationFrame(scrollRaf);
      scrollRaf = 0;
    }
    for (const col of columns()) {
      col.colEl.classList.remove('is-drop-target');
      col.colEl.classList.remove('is-drop-zone');
    }
    card.classList.remove('is-dragging');
    card.style.removeProperty('left');
    card.style.removeProperty('top');
    card.style.removeProperty('--kz-drag-w');
    card.setAttribute('aria-grabbed', 'false');

    let intent = null;
    if (drag.started) {
      if (commit && placeholder.parentNode && drag.targetColumn) {
        const beforeId = beforeIdFromPlaceholder();
        const targetCol = drag.targetColumn;
        placeholder.parentNode.insertBefore(card, placeholder);
        intent = { columnId: targetCol.columnId, beforeId };
      } else if (drag.originList) {
        // sem coluna válida sob o ponteiro (ou cancelamento): volta para a
        // origem, sem mexer no store
        drag.originList.insertBefore(card, drag.originNext);
        if (commit) announce('Solto fora das colunas: card devolvido à posição original.');
      }
    }
    if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);

    try {
      if (card.hasPointerCapture && drag.pointerId != null && card.hasPointerCapture(drag.pointerId)) {
        card.releasePointerCapture(drag.pointerId);
      }
    } catch {
      /* noop */
    }

    const wasStarted = drag.started;
    const contactId = drag.contactId;
    drag = null;
    lastPoint = null;
    if (wasStarted) suppressUntil = Date.now() + 250;
    if (intent) onDrop(contactId, intent);
  }

  function onPointerDown(event) {
    if (drag || grab) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const target = event.target;
    if (target.closest('[data-card-action]')) return;
    const card = target.closest('.kz-card');
    if (!card || !scroller.contains(card)) return;
    const contactId = cardIdOf(card);
    if (!contactId) return;

    drag = {
      card,
      contactId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      targetColumn: null
    };
    try {
      card.setPointerCapture(event.pointerId);
    } catch {
      /* alguns navegadores rejeitam captura em pointerType desconhecido */
    }
    armStaleWatchdog();
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      const dx = Math.abs(event.clientX - drag.startX);
      const dy = Math.abs(event.clientY - drag.startY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      beginDrag(event);
      return;
    }
    event.preventDefault();
    armStaleWatchdog();
    moveDrag(event);
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    cleanupDrag(true);
  }

  function onPointerCancel(event) {
    if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
    cleanupDrag(false);
  }

  /* ----------------------------- teclado ----------------------------- */

  function columnOf(card) {
    const list = columns();
    return list.find((col) => col.listEl.contains(card)) || null;
  }

  function releaseGrab(cancelled) {
    if (!grab) return;
    const { card } = grab;
    card.classList.remove('is-grabbed');
    card.setAttribute('aria-grabbed', 'false');
    if (cancelled && grab.originList) {
      grab.originList.insertBefore(card, grab.originNext);
      commitFromDom(card);
      announce('Movimento cancelado, card devolvido à posição original.');
    } else {
      announce('Card solto.');
    }
    grab = null;
    card.focus();
  }

  function commitFromDom(card) {
    const col = columnOf(card);
    if (!col) return;
    let node = card.nextSibling;
    while (node && !(node.classList && node.classList.contains('kz-card'))) node = node.nextSibling;
    onDrop(cardIdOf(card), { columnId: col.columnId, beforeId: cardIdOf(node) });
  }

  function moveByKeyboard(card, direction) {
    const list = columns();
    const col = columnOf(card);
    if (!col) return;
    const index = list.findIndex((item) => item.columnId === col.columnId);
    if (index < 0) return;

    if (direction === 'left' || direction === 'right') {
      const next = list[index + (direction === 'left' ? -1 : 1)];
      if (!next) {
        announce('Não há coluna nessa direção.');
        return;
      }
      const position = cardsIn(col.listEl, null).indexOf(card);
      const targets = cardsIn(next.listEl, null);
      const reference = targets[Math.min(position, targets.length)] || null;
      next.listEl.insertBefore(card, reference);
      commitFromDom(card);
      announce(`Movido para a coluna ${next.title || next.columnId}.`);
    } else {
      const items = cardsIn(col.listEl, null);
      const position = items.indexOf(card);
      const target = direction === 'up' ? position - 1 : position + 1;
      if (target < 0 || target >= items.length) {
        announce('Já está no limite da coluna.');
        return;
      }
      if (direction === 'up') col.listEl.insertBefore(card, items[target]);
      else col.listEl.insertBefore(card, items[target].nextSibling);
      commitFromDom(card);
      announce(`Posição ${target + 1} de ${items.length} em ${col.title || col.columnId}.`);
    }
    window.requestAnimationFrame(() => card.focus());
  }

  function onKeyDown(event) {
    const card = event.target.closest ? event.target.closest('.kz-card') : null;
    if (!card) return;

    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (grab && grab.card === card) {
        releaseGrab(false);
        return;
      }
      if (grab) releaseGrab(false);
      const col = columnOf(card);
      grab = {
        card,
        originList: card.parentNode,
        originNext: card.nextSibling,
        originColumn: col ? col.columnId : null
      };
      card.classList.add('is-grabbed');
      card.setAttribute('aria-grabbed', 'true');
      announce('Card pego. Use as setas para mover, espaço para soltar, Esc para cancelar.');
      return;
    }

    if (!grab || grab.card !== card) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      releaseGrab(true);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      releaseGrab(false);
      return;
    }
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const direction = map[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    moveByKeyboard(card, direction);
  }

  scroller.addEventListener('pointerdown', onPointerDown);
  scroller.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('blur', onInterrupted);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    isDragging: () => Boolean(drag && drag.started) || Date.now() < suppressUntil,
    isBusy: () => Boolean((drag && drag.started) || grab),
    /** `true` quando havia algo para cancelar (usado pela pilha do Esc). */
    cancel: () => {
      const had = Boolean(drag || grab);
      if (drag) cleanupDrag(false);
      if (grab) releaseGrab(true);
      return had;
    },
    destroy() {
      if (drag) cleanupDrag(false);
      if (grab) releaseGrab(false);
      if (staleTimer) {
        window.clearTimeout(staleTimer);
        staleTimer = 0;
      }
      scroller.removeEventListener('pointerdown', onPointerDown);
      scroller.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('blur', onInterrupted);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}
