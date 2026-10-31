import { api } from './api.js';
import { t } from './i18n.js';
import { player } from './player.js';
import { getPlaylists, invalidatePlaylists, likes, toggleLike } from './store.js';

export const tg = window.Telegram?.WebApp;

const P = (d) => `<path d="${d}"/>`;
const ICONS = {
  // retro tab icons: gramophone, magnifier over a record, a record sliding out of its sleeve, a volume knob
  home: P('M4.5 16.5h12v3.5h-12z') + P('M6 16.5c0-1 2.2-1.6 4.5-1.6s4.5.6 4.5 1.6') + P('M10.5 15V13.4c0-.9.7-1.5 1.7-1.5')
    + '<g class="ic__horn">' + P('M11.8 11.6 15.2 5.6M12.6 12.2 19.4 9') + '<ellipse cx="17.3" cy="7.3" rx="2.7" ry="1.3" transform="rotate(39 17.3 7.3)"/></g>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><g class="ic__rec"><circle cx="10.5" cy="10.5" r="3"/><circle class="fill" cx="11.6" cy="10.5" r=".8"/></g>' + P('m15.4 15.4 4.6 4.6'),
  library: P('M4 6.5h10.5v13H4z') + '<g class="ic__disc">' + P('M14.5 7a6 6 0 0 1 0 12') + P('M14.5 10.6a2.4 2.4 0 0 1 0 4.8') + '</g>',
  settings: '<g class="ic__knob"><circle cx="12" cy="13.5" r="6"/>' + P('M12 13.5 8.6 10.1') + '</g>'
    + P('M4.3 10.7 2.7 10.1M7.3 6.8 6.3 5.4M12 5.3V3.6M16.7 6.8l1-1.4M19.7 10.7l1.6-.6'),
  lyrics: '<g class="ic__ln">' + P('M4 6h10') + '</g><g class="ic__ln">' + P('M4 10h10') + '</g><g class="ic__ln">' + P('M4 14h6') + '</g>'
    + P('M18 17.5V8.5l3-1') + '<circle class="fill" cx="16.2" cy="17.6" r="2.1"/>',
  palette: P('M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.6-.7 1.6-1.5 0-.5-.2-.8-.5-1.1-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6h1.9a4.4 4.4 0 0 0 4.4-4.4c0-4-3.8-7.3-8.5-7.3z')
    + '<circle class="fill" cx="7.6" cy="11.2" r="1.2"/><circle class="fill" cx="10.2" cy="7.4" r="1.2"/><circle class="fill" cx="14.6" cy="7.6" r="1.2"/>',
  play: '<path class="fill" d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z"/>',
  pause: '<rect class="fill" x="6.5" y="5" width="3.8" height="14" rx="1"/><rect class="fill" x="13.7" y="5" width="3.8" height="14" rx="1"/>',
  next: '<path class="fill" d="M5 6.2v11.6a.7.7 0 0 0 1.1.6l8.4-5.8a.7.7 0 0 0 0-1.2L6.1 5.6a.7.7 0 0 0-1.1.6z"/>' + P('M18.5 5.5v13'),
  prev: '<path class="fill" d="M19 6.2v11.6a.7.7 0 0 1-1.1.6l-8.4-5.8a.7.7 0 0 1 0-1.2l8.4-5.8a.7.7 0 0 1 1.1.6z"/>' + P('M5.5 5.5v13'),
  shuffle: P('M4 7h3.5c4.5 0 5.5 10 10 10H20M4 17h3.5c1.7 0 2.8-1.4 3.7-3M14.3 10c.9-1.6 2-3 3.7-3H20') + P('m17.5 4.5 2.5 2.5-2.5 2.5M17.5 14.5l2.5 2.5-2.5 2.5'),
  repeat: P('M5 11V9a2 2 0 0 1 2-2h12m-3-3 3 3-3 3M19 13v2a2 2 0 0 1-2 2H5m3 3-3-3 3-3'),
  repeat1: P('M5 11V9a2 2 0 0 1 2-2h12m-3-3 3 3-3 3M19 13v2a2 2 0 0 1-2 2H5m3 3-3-3 3-3') + P('M11.5 10.5 12.5 10v4.5'),
  heart: P('M12 19.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10z'),
  heartFill: '<path class="fill" d="M12 19.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10z"/>',
  more: [5.5, 12, 18.5].map((x) => `<circle class="fill ic__dot" cx="${x}" cy="12" r="1.5"/>`).join(''),
  down: P('m6 9.5 6 6 6-6'),
  right: P('m9.5 6 6 6-6 6'),
  plus: P('M12 5v14M5 12h14'),
  send: P('M20 4 3.5 10.6l6.6 2.8L20 4zm0 0-9.9 9.4 2.8 6.6z'),
  listPlus: P('M4 7h11M4 12h11M4 17h7') + '<g class="ic__plus">' + P('M17 14v6M14 17h6') + '</g>',
  next2: P('M4 7h12M4 12h12M4 17h8') + '<path class="fill" d="M16 14.5v5l4-2.5z"/>',
  trash: P('M5 7h14M10 7V5h4v2M7 7l.8 12a1 1 0 0 0 1 1h6.4a1 1 0 0 0 1-1L17 7'),
  edit: P('M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'),
  clock: '<circle cx="12" cy="12" r="8"/><g class="ic__hands">' + P('M12 8v4.5l3 1.5') + '</g>',
  vinyl: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><circle class="fill" cx="12" cy="12" r=".9"/>',
  close: P('M6 6l12 12M18 6 6 18'),
  // favourites: records on a shelf (two sleeves and a disc) with a small heart above
  shelf: P('M3 19.5h18M4.5 19.5v1.5M19.5 19.5v1.5') + '<rect x="4.5" y="9.5" width="4" height="10" rx=".4"/><rect x="9.6" y="8" width="4" height="11.5" rx=".4"/>'
    + '<g class="ic__roll"><circle cx="17.6" cy="15.6" r="3.9"/><circle cx="17.6" cy="15.6" r="1.1"/>' + P('M17.6 12.4v1.4') + '</g>'
    + '<path class="fill ic__heart" d="M17.6 9.2s-2.7-1.6-2.7-3.5a1.45 1.45 0 0 1 2.7-.75 1.45 1.45 0 0 1 2.7.75c0 1.9-2.7 3.5-2.7 3.5z"/>',
  check: P('m5 12.5 4.5 4.5L19 7.5'),
  sort: P('M7 5v14m0 0-3-3m3 3 3-3M14 7h6M14 12h4.5M14 17h3'),
  eq: P('M6 4v16M12 4v16M18 4v16') + [[4, 13], [10, 7], [16, 11]].map(([x, y]) => `<rect class="fill ic__cap" x="${x}" y="${y}" width="4" height="3" rx=".8"/>`).join(''),
  micFill: '<path class="fill" d="M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3z"/>' + P('M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20M9 20h6'),
  // favourite artists: a microphone with a small heart beside it
  micFav: P('M10 4.5a2.8 2.8 0 0 1 2.8 2.8v4.4a2.8 2.8 0 0 1-5.6 0V7.3A2.8 2.8 0 0 1 10 4.5zM4.8 11.3a5.2 5.2 0 0 0 10.4 0M10 16.5V20M7.2 20h5.6')
    + '<path class="fill" d="M18.4 9.6s-2.9-1.7-2.9-3.7a1.5 1.5 0 0 1 2.9-.8 1.5 1.5 0 0 1 2.9.8c0 2-2.9 3.7-2.9 3.7z"/>',
  mic: P('M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3zM6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20M9 20h6'),
  // up next: a short stack of lines with the current one marked
  queue: P('M9 6.5h11M9 17.5h11') + '<g class="ic__mid">' + P('M9 12h11') + '</g><path class="fill" d="M3.5 4.2v4.6l3.8-2.3z"/>' + P('M4 12h1.5M4 17.5h1.5'),
  grip: '<g class="fill">' + [8.5, 15.5].map((x) => [6, 12, 18].map((y) => `<circle cx="${x}" cy="${y}" r="1.5"/>`).join('')).join('') + '</g>',
  moon: P('M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z'),
  // the 33 / 45 speed selector of a turntable
  speed: '<circle cx="12" cy="13" r="7.5"/>' + P('M12 13l3.6-3.6M7.5 5.2 6.4 3.7M16.5 5.2l1.1-1.5'),
  import: P('M12 4v10m0 0-4-4m4 4 4-4M5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V15'),
};

export const EASE_IO = 'cubic-bezier(.65, 0, .35, 1)';
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function icon(name, cls = '') {
  return `<svg class="ic ic--${name} ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

// ---------- a small motion of the icon on every press (css: .is-press .ic--<name>) ----------

const PRESSABLE = '.icon-btn, .play-btn, .pill, .tile, .link--sort';
const PRESS_MS = 650;

/** Replays the press motion of a button's icon; the class goes by timer (animations stall in a hidden page). */
export function pressAnim(btn) {
  if (!btn || reducedMotion()) return;
  btn.classList.remove('is-press');
  btn.classList.toggle('was-on', !!btn.querySelector('.ic--heartFill')); // a heart being unliked squeezes; one being liked beats
  void btn.offsetWidth; // restart the animation when tapped again quickly
  btn.classList.add('is-press');
  clearTimeout(btn._pressTimer);
  btn._pressTimer = setTimeout(() => btn.classList.remove('is-press'), PRESS_MS);
}
// one listener for the whole app: every pressable button plays its icon's motion, whatever else the tap does
document.addEventListener('click', (e) => pressAnim(e.target.closest?.(PRESSABLE)), true);

/** Brand mark: a small vinyl record with a bordeaux label. */
export function brandMark() {
  return `<svg class="brand__mark" viewBox="0 0 24 24" aria-hidden="true">
    <circle class="disc" cx="12" cy="12" r="11.2"/>
    <circle class="groove" cx="12" cy="12" r="9"/><circle class="groove" cx="12" cy="12" r="7"/>
    <circle class="label" cx="12" cy="12" r="4.4"/><circle class="hole" cx="12" cy="12" r="1.1"/>
  </svg>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  // adopt out of the template's inert document, otherwise el.animate() binds to a timeline that never runs
  return document.adoptNode(tpl.content.firstElementChild);
}

export function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function haptic(kind = 'light') {
  if (!tg?.isVersionAtLeast?.('6.1')) return;
  try {
    if (kind === 'success' || kind === 'error') tg?.HapticFeedback?.notificationOccurred(kind);
    else if (kind === 'select') tg?.HapticFeedback?.selectionChanged();
    else tg?.HapticFeedback?.impactOccurred(kind);
  } catch {}
}

/** Cover URL sized for where it is shown: a 1280px thumbnail decoded for a 48px row costs ~3.7 MB of memory. */
export function thumb(url, px = 144) {
  if (!url) return url;
  if (url.includes('i.ytimg.com')) return px > 320 ? url : url.replace(/\/(hq720|maxresdefault|sddefault|hqdefault)\.jpg/, '/mqdefault.jpg');
  return url.replace(/=w\d+-h\d+/, `=w${px}-h${px}`);
}

const VINYL = '<div class="vl" aria-hidden="true"><div class="vl__slide"><div class="vl__disc"><span class="vl__groove"></span><span class="vl__label"></span></div></div><div class="vl__sleeve"><span class="vl__brand">Musique</span></div></div>';

/** Loading placeholder: the same record-and-sleeve scene as the launch screen, smaller. It fades in
 *  only after a quarter of a second, so fast screens never flash it. */
export function loader() {
  return `<div class="view-loader">${VINYL.replace('class="vl"', 'class="vl vl--sm"')}</div>`;
}

export function cover(url, cls = '', px = 144) {
  return url
    ? `<img class="cover ${cls}" src="${esc(thumb(url, px))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : `<div class="cover cover--empty ${cls}">${icon('vinyl')}</div>`;
}

// ---------- toast ----------

let toastTimer;
export function toast(text) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('<div id="toast" class="toast" role="status"></div>');
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2200);
}

// ---------- bottom sheet ----------

export function sheet({ title = '', items = [], content = null, done = false, closeLabel = '', swipe = false, cls = '' }) {
  return new Promise((resolve) => {
    const root = h(`<div class="sheet ${cls}" role="dialog" aria-modal="true">
      <div class="sheet__scrim"></div>
      <div class="sheet__panel">
        <div class="sheet__grip"></div>
        ${title ? `<div class="sheet__title">${title}</div>` : ''}
        <div class="sheet__body"></div>
        <button class="sheet__cancel">${esc(closeLabel || t(done ? 'done' : 'cancel'))}</button>
      </div>
    </div>`);
    const body = root.querySelector('.sheet__body');
    if (content) body.append(content);
    items.forEach((it, i) => {
      const btn = h(`<button class="sheet__item ${it.danger ? 'is-danger' : ''}">${icon(it.icon)}<span>${esc(it.label)}</span></button>`);
      btn.addEventListener('click', () => close(i));
      body.append(btn);
    });
    let unbindSwipe = null;
    function close(value) {
      unbindSwipe?.();
      root.classList.remove('is-open');
      setTimeout(() => root.remove(), 380);
      resolve(value ?? null);
    }
    root.querySelector('.sheet__scrim').addEventListener('click', () => close(null));
    root.querySelector('.sheet__cancel').addEventListener('click', () => close(null));
    if (swipe) unbindSwipe = swipeToClose(root, () => close(null));
    root.close = close;
    document.body.append(root);
    requestAnimationFrame(() => root.classList.add('is-open'));
  });
}

/** Drag a sheet down to close it. Only once its content is scrolled to the top (or from the grip and title),
 *  so reading a long text up and down never closes it by accident. */
function swipeToClose(root, close) {
  const panel = root.querySelector('.sheet__panel');
  const scroller = root.querySelector('.sheet__scroll') || panel;
  let y0 = null, t0 = 0, dy = 0, dragging = false, fromHead = false;
  const start = (y, target) => {
    if (target.closest('button')) return;
    fromHead = !!target.closest('.sheet__grip, .sheet__title, .sheet__head');
    y0 = y; t0 = performance.now(); dy = 0; dragging = false;
  };
  /** true while the sheet itself follows the finger (the page must not scroll then) */
  const move = (y) => {
    if (y0 === null) return false;
    dy = y - y0;
    if (!dragging) {
      if (dy < -6) { y0 = null; return false; } // moving up: an ordinary scroll
      if (dy < 8) return false;
      if (!fromHead && scroller.scrollTop > 0) { y0 = null; return false; } // scrolled text: reading, not closing
      dragging = true;
      panel.classList.add('is-dragging');
    }
    panel.style.transform = `translateY(${Math.max(0, dy)}px)`;
    return true;
  };
  const end = () => {
    if (y0 === null) return;
    y0 = null;
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('is-dragging');
    const fast = dy > 40 && dy / Math.max(1, performance.now() - t0) > 0.6; // a flick closes even if short
    panel.style.transform = '';
    if (dy > 90 || fast) { haptic('light'); close(); }
  };
  // touch: a vertical drag over scrollable text belongs to the browser unless taken here with preventDefault
  panel.addEventListener('touchstart', (e) => start(e.touches[0].clientY, e.target), { passive: true });
  panel.addEventListener('touchmove', (e) => { if (move(e.touches[0].clientY)) e.preventDefault(); }, { passive: false });
  panel.addEventListener('touchend', end);
  panel.addEventListener('touchcancel', end);
  // mouse (desktop Telegram); the window listeners go away with the sheet
  const onMove = (e) => { if (e.pointerType === 'mouse') move(e.clientY); };
  const onUp = (e) => { if (e.pointerType === 'mouse') end(); };
  panel.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') start(e.clientY, e.target); });
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  return () => { removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); };
}

export function promptName({ title, value = '', action, placeholder = t('playlist_name'), max = 64 }) {
  return new Promise((resolve) => {
    const root = h(`<div class="dialog" role="dialog" aria-modal="true">
      <form class="dialog__panel">
        <div class="dialog__title">${esc(title)}</div>
        <input class="field" maxlength="${max}" value="${esc(value)}" placeholder="${esc(placeholder)}" required>
        <div class="dialog__actions">
          <button type="button" class="btn btn--ghost" data-cancel>${esc(t('cancel'))}</button>
          <button type="submit" class="btn btn--accent">${esc(action)}</button>
        </div>
      </form>
    </div>`);
    const input = root.querySelector('input');
    const done = (v) => { root.remove(); resolve(v); };
    root.querySelector('[data-cancel]').addEventListener('click', () => done(null));
    root.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (v) done(v);
    });
    document.body.append(root);
    setTimeout(() => input.focus(), 50);
  });
}

export function confirmDialog(text) {
  return new Promise((resolve) => {
    if (tg?.showConfirm && tg.isVersionAtLeast?.('6.2')) tg.showConfirm(text, resolve);
    else resolve(window.confirm(text));
  });
}

// ---------- track list ----------

export function trackRow(track, { index = null } = {}) {
  const liked = likes.has(track.id);
  const row = h(`<div class="track" data-id="${esc(track.id)}" role="button" tabindex="0">
    ${index !== null ? `<span class="track__num">${index + 1}</span>` : ''}
    <div class="track__art">${cover(track.cover)}<span class="eq"><i></i><i></i><i></i></span></div>
    <div class="track__meta">
      <div class="track__title">${esc(track.title)}</div>
      <div class="track__artist">${esc(track.artist)}</div>
    </div>
    <span class="track__time">${track.duration ? fmt(track.duration) : ''}</span>
    <button class="icon-btn track__like ${liked ? 'is-on' : ''}" aria-label="like" aria-pressed="${liked}">${icon(liked ? 'heartFill' : 'heart')}</button>
    <button class="icon-btn track__more" aria-label="more">${icon('more')}</button>
  </div>`);
  return row;
}

const MARQUEE_GAP = 48; // px between the end of the title and its next turn
const MARQUEE_SPEED = 30; // px per second

/** A title too long for its box runs round like a ticker: one way, its copy following after a gap, resting at
 *  the start of each round; a short one stays put. `box` holds one `.marquee` span. Call again whenever the
 *  text or the box width may have changed. */
export function fitMarquee(box) {
  const span = box?.querySelector('.marquee');
  if (!span) return;
  box.dataset.marquee = '';
  requestAnimationFrame(() => {
    box.classList.remove('is-marquee');
    span.querySelector('.marquee__copy')?.remove();
    span.querySelector('.marquee__text') && (span.textContent = span.querySelector('.marquee__text').textContent);
    const width = span.scrollWidth;
    if (!box.clientWidth || width - box.clientWidth <= 2) return; // fits (or is hidden right now: measured again next time)
    const text = span.textContent;
    span.innerHTML = `<span class="marquee__text">${esc(text)}</span><span class="marquee__copy" aria-hidden="true">${esc(text)}</span>`;
    const run = (width + MARQUEE_GAP) / MARQUEE_SPEED;
    box.style.setProperty('--gap', `${MARQUEE_GAP}px`);
    box.style.setProperty('--dist', `${-(width + MARQUEE_GAP)}px`);
    box.style.setProperty('--dur', `${(run / 0.85).toFixed(2)}s`); // the first 15 % of a round is the rest
    box.classList.add('is-marquee');
  });
}
addEventListener('resize', () => document.querySelectorAll('[data-marquee]').forEach(fitMarquee));

/** Hearts in every list follow the likes, wherever a track was liked (row, menu, player). */
export function syncHearts(root = document) {
  root.querySelectorAll('.track__like').forEach((btn) => {
    const liked = likes.has(btn.closest('.track')?.dataset.id);
    if (btn.classList.contains('is-on') === liked) return;
    btn.classList.toggle('is-on', liked);
    btn.setAttribute('aria-pressed', liked);
    btn.innerHTML = icon(liked ? 'heartFill' : 'heart');
  });
}
document.addEventListener('likes-changed', () => syncHearts());

/** A track leaves a list the way a record leaves a shelf: drawn out a little, slid away, the gap closing.
 *  Removed by timer (a hidden page never finishes animations); `done` runs once it is gone. */
export function removeRow(row, done) {
  row.classList.add('is-removing');
  if (reducedMotion()) { row.remove(); done?.(); return; }
  const height = row.offsetHeight;
  row.animate([
    { transform: 'none', boxShadow: '0 0 0 rgba(0, 0, 0, 0)' },
    { offset: 0.33, transform: 'translateY(-6px) scale(1.02)', boxShadow: '0 10px 22px rgba(0, 0, 0, .22)', opacity: 1 },
    { transform: 'translate(60%, -6px) rotate(3deg)', boxShadow: '0 10px 22px rgba(0, 0, 0, 0)', opacity: 0 },
  ], { duration: 420, easing: EASE_IO, fill: 'forwards' });
  setTimeout(() => {
    row.style.overflow = 'hidden';
    row.animate([{ height: `${height}px`, minHeight: `${height}px` }, { height: '0px', minHeight: '0px', paddingTop: '0px', paddingBottom: '0px' }],
      { duration: 200, easing: 'ease-out', fill: 'forwards' });
  }, 400);
  setTimeout(() => { row.remove(); done?.(); }, 620);
}

/** Render a playable list; clicking a row plays the list starting at it. */
export function trackList(tracks, { numbered = false, context = null, onChange = null } = {}) {
  const list = h(`<div class="tracks ${numbered ? 'tracks--numbered' : ''}"></div>`);
  tracks.forEach((tr, i) => list.append(trackRow(tr, { index: numbered ? i : null })));
  list.addEventListener('click', async (e) => {
    const row = e.target.closest('.track');
    if (!row) return;
    if (row.classList.contains('is-removing')) return;
    const i = [...list.children].filter((r) => !r.classList.contains('is-removing')).indexOf(row);
    if (e.target.closest('.track__artist')) { e.stopPropagation(); openArtist(tracks[i]); return; }
    if (e.target.closest('.track__like')) {
      // like right from the list: the track keeps playing (or not) as it was
      e.stopPropagation();
      haptic('light');
      try {
        const now = await toggleLike(tracks[i]);
        document.dispatchEvent(new CustomEvent('likes-changed'));
        if (!now && context?.likes) { tracks.splice(i, 1); removeRow(row, onChange); }
      } catch { toast(t('toast_error')); }
      return;
    }
    if (e.target.closest('.track__more')) {
      e.stopPropagation();
      const changed = await trackMenu(tracks[i], context);
      if (changed === 'removed') { tracks.splice(i, 1); removeRow(row, onChange); }
      return;
    }
    haptic('light');
    if (player.current?.id === tracks[i].id) player.toggle();
    else player.playQueue(tracks, i);
  });
  markPlaying(list);
  return list;
}

/** Highlight the current track. Touches only the rows that change, not the whole list. */
export function markPlaying(root = document) {
  const id = player.current?.id;
  root.querySelectorAll('.track.is-current').forEach((row) => {
    if (row.dataset.id !== id) row.classList.remove('is-current', 'is-playing');
  });
  if (!id) return;
  root.querySelectorAll(`.track[data-id="${CSS.escape(id)}"]`).forEach((row) => {
    row.classList.add('is-current');
    row.classList.toggle('is-playing', player.playing);
  });
}

// ---------- artists ----------

/** A row for an artist (search results, favourite artists); tapping it opens the artist card. */
export function artistRow(a) {
  const row = h(`<button class="artist-row" data-id="${esc(a.id)}">${cover(a.cover, 'artist-row__photo', 168)}
    <span class="artist-row__meta"><span class="artist-row__name">${esc(a.name)}</span>
      ${a.subscribers ? `<span class="artist-row__sub">${esc(t('artist_subscribers', { n: a.subscribers }))}</span>` : ''}</span>
    ${icon('right', 'artist-row__chev')}</button>`);
  row.addEventListener('click', () => {
    haptic('light');
    document.dispatchEvent(new CustomEvent('open-artist', { detail: { id: a.id, name: a.name } }));
  });
  return row;
}

// ---------- track actions ----------

/** Open the artist card for a track; with several artists ("A, B feat. C") the user picks one first. */
export async function openArtist(track) {
  if (!track?.artist || track.artist === '—') return;
  const names = track.artist.split(/\s*(?:,|&|\sfeat\.?\s|\sft\.?\s|\sx\s)\s*/i).filter(Boolean);
  let pick = 0;
  if (names.length > 1) {
    pick = await sheet({ title: esc(t('artist_choose')), items: names.map((n) => ({ icon: 'mic', label: n })) });
    if (pick === null) return;
  }
  haptic('light');
  // the stored id belongs to the first artist only; the others are looked up by name
  document.dispatchEvent(new CustomEvent('open-artist', { detail: { id: pick === 0 ? track.artist_id || '' : '', name: names[pick] } }));
}

export async function chooseAndAddToPlaylist(track) {
  const playlists = await getPlaylists();
  const items = [{ icon: 'plus', label: t('lib_new_playlist') },
    ...playlists.map((p) => ({ icon: 'library', label: p.name }))];
  const choice = await sheet({ title: esc(t('menu_add_playlist')), items });
  if (choice === null) return;
  let pl = playlists[choice - 1];
  if (choice === 0) {
    const name = await promptName({ title: t('lib_new_playlist'), action: t('create') });
    if (!name) return;
    const { id } = await api.createPlaylist(name);
    pl = { id, name };
  }
  await api.addToPlaylist(pl.id, track);
  invalidatePlaylists();
  haptic('success');
  toast(t('toast_added', { name: pl.name }));
}

export async function trackMenu(track, context = null) {
  const liked = likes.has(track.id);
  const actions = [
    { icon: liked ? 'heartFill' : 'heart', label: t(liked ? 'menu_unlike' : 'menu_like'), run: 'like' },
    { icon: 'listPlus', label: t('menu_add_playlist'), run: 'playlist' },
    { icon: 'next2', label: t('menu_play_next'), run: 'next' },
    { icon: 'mic', label: t('menu_artist'), run: 'artist' },
    { icon: 'send', label: t('menu_send'), run: 'send' },
  ];
  // the full player's menu: the track already plays, and the turntable's own switches join in
  if (context?.player) {
    actions.splice(2, 1);
    actions.push({ icon: 'moon', label: context.player.sleep, run: 'sleep' }, { icon: 'speed', label: context.player.sound, run: 'sound' });
  }
  if (context?.playlistId) actions.push({ icon: 'trash', label: t('menu_remove'), run: 'remove', danger: true });
  const head = h(`<div class="sheet__track">${cover(track.cover)}<div><div class="track__title">${esc(track.title)}</div><div class="track__artist">${esc(track.artist)}</div></div></div>`);
  const i = await sheet({ content: head, items: actions });
  if (i === null) return null;
  try {
    switch (actions[i].run) {
      case 'like': {
        const now = await toggleLike(track);
        haptic('success');
        toast(t(now ? 'toast_liked' : 'toast_unliked'));
        document.dispatchEvent(new CustomEvent('likes-changed'));
        if (!now && context?.likes) return 'removed';
        break;
      }
      case 'playlist': await chooseAndAddToPlaylist(track); break;
      case 'next': player.playNext(track); toast(t('toast_next')); break;
      case 'artist': await openArtist(track); break;
      case 'send': await api.send(track); haptic('success'); toast(t('toast_sending')); break;
      case 'sleep': case 'sound': return actions[i].run; // the player handles its own switches
      case 'remove':
        await api.removeFromPlaylist(context.playlistId, track.id);
        invalidatePlaylists();
        toast(t('toast_removed'));
        return 'removed';
    }
  } catch {
    haptic('error');
    toast(t('toast_error'));
  }
  return null;
}
