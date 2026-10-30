import { api } from './api.js';
import { t } from './i18n.js';
import { settings, updateSettings } from './store.js';
import { CLASSIC_SWATCH, THEMES } from './themes.js';
import { EASE_IO, brandMark, esc, h, haptic, icon } from './ui.js';

/** The product intro shown on the very first launch, as stories: tap the right side for the next one,
 *  the left side for the previous, hold to pause, swipe down or tap the cross to close.
 *  Settings → About replays it. Each slide is drawn with flat shapes only, in the brand colours. */

const SLIDE_MS = 6500;

const record = (cls = '') => `<svg class="sx-record ${cls}" viewBox="0 0 200 200" aria-hidden="true">
  <circle class="rim" cx="100" cy="100" r="97"/>
  ${[86, 76, 66, 56, 46].map((r) => `<circle class="g" cx="100" cy="100" r="${r}"/>`).join('')}
  <path class="s" d="M100 100 L100 6 A94 94 0 0 1 166 33 Z"/>
  <circle class="l" cx="100" cy="100" r="30"/><circle class="lr" cx="100" cy="100" r="22"/>
  <circle class="h" cx="100" cy="100" r="4"/>
</svg>`;

const SLIDES = [
  { tone: 'navy', art: () => `<div class="sx-turntable">${record('sx-spin')}</div>` },
  {
    tone: 'bordeaux',
    art: () => {
      const q = t('st2_q');
      return `<div class="sx-search">
        <div class="sx-bar">${icon('search')}<span class="sx-type" style="--n:${q.length}">${esc(q)}</span><i class="sx-caret"></i></div>
        ${[0, 1, 2].map((i) => `<div class="sx-row" style="--d:${i * 0.12}s"><b></b><span><i></i><i></i></span></div>`).join('')}
      </div>`;
    },
  },
  {
    tone: 'vinyl',
    art: () => `<div class="sx-hand">
      <span class="sx-arrow sx-arrow--l">${icon('prev')}</span>${record('sx-scrub')}<span class="sx-arrow sx-arrow--r">${icon('next')}</span>
    </div>`,
  },
  {
    tone: 'cream',
    art: () => `<div class="sx-grid">${[['heart', 'lib_likes'], ['shelf', 'lib_playlists'], ['clock', 'lib_history'], ['mic', 'lib_artists']]
      .map(([ic, key], i) => `<div class="sx-tile" style="--d:${i * 0.1}s">${icon(ic)}<span>${esc(t(key))}</span></div>`).join('')}</div>`,
  },
  {
    tone: 'navy',
    art: () => `<div class="sx-eq">${[['60', '18%', '62%'], ['230', '40%', '12%'], ['910', '58%', '30%'], ['3.6k', '24%', '50%'], ['14k', '46%', '8%']]
      .map(([label, a, b], i) => `<div class="sx-f" style="--a:${a};--b:${b};--d:${i * -0.35}s"><span><b></b></span><small>${label}</small></div>`).join('')}</div>`,
  },
  {
    tone: 'vinyl',
    art: () => `<div class="sx-custom">
      <div class="sx-discs">${['#101218', '#5A1420', '#D5BF9B', '#1E3A2C', '#B08D57']
        .map((c, i) => `<span class="sx-disc" style="--c:${c};--d:${i * 0.09}s"></span>`).join('')}</div>
      <div class="sx-themes">${[CLASSIC_SWATCH, ...Object.values(THEMES).filter(Boolean).map((th) => th.swatch)]
        .map((sw, i) => `<span class="sx-theme" style="--d:${0.5 + i * 0.07}s">${sw.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`).join('')}</div>
    </div>`,
  },
  {
    tone: 'bordeaux',
    art: () => `<div class="sx-chat">
      <div class="sx-msg">${esc(t('st7_query'))}</div>
      <div class="sx-audio"><span class="sx-play">${icon('play')}</span>
        <span class="sx-audio__meta"><b>${esc(t('st7_track'))}</b>
          <span class="sx-wave">${[5, 9, 14, 8, 12, 16, 10, 6, 13, 9, 15, 7, 11, 14, 8, 5, 10, 13, 7, 9].map((v) => `<i style="height:${v}px"></i>`).join('')}</span>
        </span></div>
    </div>`,
  },
];

let root = null, index = 0, fill = null, done = null, keyHandler = null, visHandler = null;

/** Shows the stories; resolves once they are closed. */
export function showStories() {
  if (root) return Promise.resolve();
  const last = SLIDES.length - 1;
  root = h(`<div class="stories" role="dialog" aria-modal="true" aria-label="Musique">
    ${SLIDES.map((s, i) => `<section class="story story--${s.tone}" aria-hidden="true">
      <div class="story__art">${s.art()}</div>
      <div class="story__copy">
        <h2 class="story__title">${esc(t(`st${i + 1}_t`))}</h2>
        <p class="story__text">${esc(t(`st${i + 1}_s`))}</p>
        ${i === last ? `<button class="btn story__cta" data-start>${esc(t('st_start'))}</button>` : ''}
      </div>
    </section>`).join('')}
    <div class="stories__top">
      <div class="stories__bars">${SLIDES.map(() => '<span class="stories__bar"><i></i></span>').join('')}</div>
      <div class="stories__head">${brandMark()}<span class="stories__brand">Musique</span>
        <button class="stories__close" data-close aria-label="${esc(t('st_close'))}">${icon('close')}</button></div>
    </div>
  </div>`);
  document.body.append(root);
  root.animate([{ opacity: 0, transform: 'scale(1.02)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE_IO });
  bindGestures();
  keyHandler = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  };
  document.addEventListener('keydown', keyHandler);
  // a story must not run on while Telegram is in the background
  visHandler = () => { if (document.hidden) fill?.pause(); else if (!root?.classList.contains('is-held')) fill?.play(); };
  document.addEventListener('visibilitychange', visHandler);
  go(0);
  return new Promise((resolve) => { done = resolve; });
}

/** First launch only. Someone who has used Musique before (saved settings or a listening history) never sees it. */
export async function maybeShowStories() {
  if (settings.storiesSeen) return;
  let returning = false;
  try { returning = !!localStorage.getItem('musique.settings'); } catch {}
  if (!returning) {
    try { returning = ((await api.history()).tracks || []).length > 0; } catch {}
  }
  if (returning) { updateSettings({ storiesSeen: true }); return; }
  await showStories();
}

function go(i) {
  index = Math.max(0, Math.min(SLIDES.length - 1, i));
  root.querySelectorAll('.story').forEach((s, j) => {
    s.classList.toggle('is-active', j === index);
    s.setAttribute('aria-hidden', String(j !== index));
  });
  root.dataset.tone = SLIDES[index].tone;
  const bars = [...root.querySelectorAll('.stories__bar i')];
  fill?.cancel();
  bars.forEach((b, j) => { b.style.transform = j < index ? 'scaleX(1)' : 'scaleX(0)'; });
  fill = bars[index].animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: SLIDE_MS, fill: 'forwards' });
  // the last story waits for "Start listening" instead of closing on its own
  if (index < SLIDES.length - 1) fill.onfinish = () => go(index + 1);
  if (document.hidden) fill.pause();
}

function next() {
  haptic('select');
  if (index === SLIDES.length - 1) close();
  else go(index + 1);
}

function prev() {
  haptic('select');
  go(index - 1); // on the first story this simply restarts it
}

function bindGestures() {
  let x0 = null, y0 = 0, held = false, holdTimer = 0;
  const reset = () => {
    clearTimeout(holdTimer);
    x0 = null;
    root.style.transform = '';
    root.classList.remove('is-held');
  };
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    x0 = e.clientX; y0 = e.clientY; held = false;
    holdTimer = setTimeout(() => { held = true; fill?.pause(); root.classList.add('is-held'); }, 220);
  });
  root.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    const dy = e.clientY - y0;
    if (Math.abs(e.clientX - x0) > 10 || Math.abs(dy) > 10) clearTimeout(holdTimer);
    if (dy > 0) root.style.transform = `translateY(${dy * 0.5}px) scale(${1 - Math.min(dy, 300) / 3000})`;
  });
  root.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0, wasHeld = held;
    reset();
    if (dy > 90 && dy > Math.abs(dx)) { close(); return; }
    if (wasHeld) { fill?.play(); return; }
    if (Math.abs(dx) > 50) { if (dx < 0) next(); else prev(); return; }
    if (e.clientX < window.innerWidth * 0.3) prev();
    else next();
  });
  root.addEventListener('pointercancel', () => { reset(); fill?.play(); });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { haptic('light'); close(); }
    else if (e.target.closest('[data-start]')) { haptic('success'); close(); }
  });
}

function close() {
  if (!root) return;
  const el = root;
  root = null;
  fill?.cancel();
  fill = null;
  document.removeEventListener('keydown', keyHandler);
  document.removeEventListener('visibilitychange', visHandler);
  if (!settings.storiesSeen) updateSettings({ storiesSeen: true });
  const out = el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(24px)' }], { duration: 240, easing: EASE_IO, fill: 'forwards' });
  const remove = () => el.remove();
  out.finished.then(remove, remove);
  setTimeout(remove, 600); // animations stall while the WebView is in the background
  done?.();
  done = null;
}
