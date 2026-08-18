/**
 * launcher.js — botão flutuante de abrir/fechar o quadro.
 * Arrastável (Pointer Events) com a posição persistida por callback.
 */
import { h, setText, brandMark } from './h.js';

const SIZE = 48;
const MARGIN = 12;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createLauncher({ parent, onToggle, savePosition }) {
  const badge = h('span', { class: 'kz-launcher__dot', hidden: true });

  const el = h('button', {
    class: 'kz-launcher',
    type: 'button',
    attrs: {
      'aria-label': 'Abrir o quadro KanZapp (Ctrl+Shift+K)',
      title: 'KanZapp — arraste para reposicionar'
    }
  }, brandMark({ size: 22, className: 'kz-launcher__mark' }), badge);

  let drag = null;
  let position = null;

  function place(x, y) {
    const maxX = Math.max(MARGIN, window.innerWidth - SIZE - MARGIN);
    const maxY = Math.max(MARGIN, window.innerHeight - SIZE - MARGIN);
    position = { x: clamp(x, MARGIN, maxX), y: clamp(y, MARGIN, maxY) };
    el.style.left = `${position.x}px`;
    el.style.top = `${position.y}px`;
  }

  function applyPosition(saved) {
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) place(saved.x, saved.y);
    else place(window.innerWidth - SIZE - 24, window.innerHeight - SIZE - 96);
  }

  function onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - el.getBoundingClientRect().left,
      offsetY: event.clientY - el.getBoundingClientRect().top,
      moved: false
    };
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* noop */
    }
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.abs(event.clientX - drag.startX) < 5 && Math.abs(event.clientY - drag.startY) < 5) return;
      drag.moved = true;
      el.classList.add('is-dragging');
    }
    place(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    drag = null;
    el.classList.remove('is-dragging');
    if (moved) {
      if (typeof savePosition === 'function') savePosition({ x: position.x, y: position.y });
    } else {
      onToggle();
    }
  }

  function onResize() {
    if (position) place(position.x, position.y);
  }

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
    }
  });
  window.addEventListener('resize', onResize);
  parent.appendChild(el);

  return {
    el,
    applyPosition,
    setOpen(isOpen) {
      el.setAttribute('aria-label', isOpen
        ? 'Fechar o quadro KanZapp (Ctrl+Shift+K)'
        : 'Abrir o quadro KanZapp (Ctrl+Shift+K)');
      el.setAttribute('aria-expanded', String(Boolean(isOpen)));
    },
    /** Bolinha de alerta com follow-ups vencidos. */
    setAlert(count) {
      const has = Number(count) > 0;
      badge.hidden = !has;
      if (has) {
        setText(badge, '');
        el.setAttribute('title', `KanZapp — ${count} follow-up(s) vencido(s)`);
      } else {
        el.setAttribute('title', 'KanZapp — arraste para reposicionar');
      }
    },
    setHidden(hidden) {
      el.hidden = Boolean(hidden);
    },
    destroy() {
      window.removeEventListener('resize', onResize);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  };
}
