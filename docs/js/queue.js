import { t } from './i18n.js';
import { player } from './player.js';
import { cover, esc, fmt, h, haptic, icon, reducedMotion, sheet, toast } from './ui.js';

/** "Up next": the current track and what follows. Tap a row to play it, × to take it out,
 *  drag the grip to reorder. Follows the player while open; swipe down closes it. */
export function openQueue() {
  haptic('light');
  const content = h(`<div class="queue">
    <div class="sheet__head"><div class="queue__title">${esc(t('queue_title'))}</div><p class="queue__summary"></p></div>
    <div class="sheet__scroll">
      <div class="queue__label">${esc(t('player_now'))}</div>
      <div class="queue__now"></div>
      <div class="queue__label queue__label--next"><span>${esc(t('queue_next'))}</span>
        <button class="queue__clear">${esc(t('queue_clear'))}</button></div>
      <div class="queue__list"></div>
      <p class="queue__empty">${esc(t('queue_empty'))}</p>
    </div>
  </div>`);
  const now = content.querySelector('.queue__now');
  const list = content.querySelector('.queue__list');
  const scroller = content.querySelector('.sheet__scroll');
  let drag = null;

  const row = (tr, i) => h(`<div class="qrow" data-i="${i}" role="button" tabindex="0">
    ${cover(tr.cover, 'qrow__cover')}
    <div class="qrow__meta"><div class="qrow__title">${esc(tr.title)}</div><div class="qrow__artist">${esc(tr.artist)}</div></div>
    ${i > player.index ? `<button class="icon-btn qrow__next" aria-label="${esc(t('menu_play_next'))}">${icon('next2')}</button><button class="icon-btn qrow__remove" aria-label="${esc(t('queue_remove'))}">${icon('close')}</button>
      <button class="qrow__grip" aria-label="${esc(t('queue_move'))}">${icon('grip')}</button>` : ''}
  </div>`);

  function render() {
    if (drag) return; // redrawn when the drag ends
    const cur = player.current;
    now.replaceChildren(...(cur ? [row(cur, player.index)] : []));
    now.firstElementChild?.classList.add('is-current', player.playing ? 'is-playing' : 'is-paused');
    const rest = player.queue.slice(player.index + 1);
    content.querySelector('.queue__summary').textContent = t('queue_summary', { n: rest.length, time: fmt(rest.reduce((sum, tr) => sum + (tr.duration || 0) / player.rate, 0)) });
    list.replaceChildren(...rest.map((tr, k) => row(tr, player.index + 1 + k)));
    content.classList.toggle('is-empty', !rest.length);
  }

  list.addEventListener('click', (e) => {
    const r = e.target.closest('.qrow');
    if (!r || e.target.closest('.qrow__grip')) return;
    const i = Number(r.dataset.i);
    if (e.target.closest('.qrow__remove')) {
      haptic('light');
      const track = player.queue[i], session = player.queueSession, offset = i - player.index;
      if (!reducedMotion()) {
        const clone = r.cloneNode(true), rect = r.getBoundingClientRect();
        Object.assign(clone.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, zIndex: 300, pointerEvents: 'none' });
        clone.inert = true; clone.setAttribute('aria-hidden', 'true'); document.body.append(clone);
        clone.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(30%)' }], { duration: 180, fill: 'forwards' });
        setTimeout(() => clone.remove(), 200);
      }
      player.removeAt(i);
      toast(t('toast_removed'), 'remove', { run: () => { if (!player.insertUpcoming([track], offset, session)) toast(t('queue_changed')); } });
      return;
    }
    if (e.target.closest('.qrow__next')) { haptic('select'); player.move(i, player.index + 1); return; }
    haptic('light');
    player.jumpTo(i);
  });
  list.addEventListener('keydown', (e) => { if (e.target.matches('.qrow') && ['Enter', ' '].includes(e.key)) { e.preventDefault(); e.target.click(); } });
  content.querySelector('.queue__clear').addEventListener('click', () => {
    const removed = player.queue.slice(player.index + 1), session = player.queueSession;
    haptic('medium'); player.clearUpcoming();
    if (removed.length) toast(t('queue_clear'), 'remove', { run: () => { if (!player.insertUpcoming(removed, 1, session)) toast(t('queue_changed')); } });
  });

  // ---------- reorder: only the grip starts a drag, so the list still scrolls under the finger ----------
  list.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.qrow__grip');
    if (!grip) return;
    e.preventDefault();
    const r = grip.closest('.qrow');
    const rows = [...list.children];
    drag = { r, rows, from: rows.indexOf(r), to: rows.indexOf(r), y0: e.clientY, s0: scroller.scrollTop,
      step: r.offsetHeight, y: e.clientY, raf: 0, current: player.current };
    grip.setPointerCapture(e.pointerId);
    r.classList.add('is-dragging');
    list.classList.add('is-sorting');
    haptic('select');
    const edge = () => { // near the top or bottom edge the list scrolls along
      if (!drag) return;
      const box = scroller.getBoundingClientRect();
      const v = drag.y < box.top + 48 ? -6 : drag.y > box.bottom - 48 ? 6 : 0;
      if (v) { scroller.scrollTop += v; layout(); }
      drag.raf = requestAnimationFrame(edge);
    };
    drag.raf = requestAnimationFrame(edge);
  });
  function layout() {
    const d = drag;
    const dy = d.y - d.y0 + scroller.scrollTop - d.s0;
    const to = Math.max(0, Math.min(d.rows.length - 1, d.from + Math.round(dy / d.step)));
    if (to !== d.to) { d.to = to; haptic('select'); }
    d.r.style.transform = `translateY(${dy}px)`;
    d.rows.forEach((x, k) => {
      if (x === d.r) return;
      const shift = d.from < k && k <= to ? -d.step : to <= k && k < d.from ? d.step : 0;
      x.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }
  list.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.y = e.clientY;
    layout();
  });
  const drop = (cancel = false) => {
    if (!drag) return;
    const { from, to, raf, current } = drag;
    cancelAnimationFrame(raf);
    drag = null;
    list.classList.remove('is-sorting');
    if (!cancel && current === player.current && from !== to) player.move(player.index + 1 + from, player.index + 1 + to);
    render();
  };
  list.addEventListener('pointerup', () => drop());
  list.addEventListener('pointercancel', () => drop(true));

  const events = ['queue', 'track', 'state'];
  const changed = () => { if (drag) drop(true); else render(); };
  events.forEach((ev) => player.addEventListener(ev, changed));
  render();
  sheet({ content, swipe: true, closeLabel: t('close'), cls: 'sheet--queue' })
    .then(() => { if (drag) { cancelAnimationFrame(drag.raf); drag = null; } events.forEach((ev) => player.removeEventListener(ev, changed)); });
}
