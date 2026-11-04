import { api } from './api.js';
import { t } from './i18n.js';
import { settings, updateSettings } from './store.js';
import { CLASSIC_SWATCH, THEMES } from './themes.js';
import { EASE_IO, brandMark, esc, h, haptic, icon, tg } from './ui.js';
import { RECEIVERS } from './devices/receivers.js';
import { COUNTRIES, receiverArt } from './radio.js';

const receiverById = (id) => RECEIVERS.find((r) => r.id === id);

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

/** The swatches of every theme in the mode on screen now. */
function themeSwatches() {
  const mode = document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light';
  return [CLASSIC_SWATCH[mode], ...Object.values(THEMES).filter(Boolean).map((th) => th[mode].swatch)];
}

/** Numbered steps under a picture: how to use what it shows. */
const steps = (keys) => `<ol class="sx-steps">${keys.map((k, i) => `<li style="--i:${i}"><b>${i + 1}</b><span>${esc(t(k))}</span></li>`).join('')}</ol>`;

const PLAYERS = ['record', 'turntable', 'cassette', 'reel', 'cd', 'phonograph', 'radio-car', 'radio-home'];

const SLIDES = [
  // music you can touch: one machine after another takes the record's place
  { key: 'st_hero', tone: 'navy', art: () => `<div class="sx-hero">${record('sx-spin')}
    <div class="sx-orbit">${PLAYERS.map((m, i) => `<span class="sx-orbit__item" style="--i:${i}">${icon('pm_' + m)}</span>`).join('')}</div></div>` },
  // the radio as a time machine: a car of its time under the rain, the dial running through the decades
  { key: 'st_radio', tone: 'vinyl', art: () => { const r = receiverById('fiat500');
    return `<div class="sx-radio"><div class="sx-radio__car"><span class="sx-radio__glass"><i></i><i></i></span>${receiverArt(r)}</div>
      <div class="sx-radio__years">${[1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000].map((y, i) => `<b style="--i:${i}">${y}</b>`).join('')}</div>
      <div class="sx-radio__flags">${COUNTRIES.map((c, i) => `<span style="--i:${i}">${esc(t('country_' + c))}</span>`).join('')}</div></div>`; } },
  // the car radio: what it is and three things to do with it
  { key: 'st_car', tone: 'bordeaux', art: () => `<div class="sx-radio"><div class="sx-radio__car"><span class="sx-radio__glass"><i></i><i></i></span>${receiverArt(receiverById('ds'))}</div>${steps(['st_car_1', 'st_car_2', 'st_car_3'])}</div>` },
  // the home radio
  { key: 'st_home', tone: 'navy', art: () => `<div class="sx-radio"><div class="sx-radio__home">${receiverArt(receiverById('saba'))}</div>${steps(['st_home_1', 'st_home_2', 'st_home_3'])}</div>` },
  // the little game in the car radio
  { key: 'st_drive', tone: 'vinyl', art: () => `<div class="sx-radio"><div class="sx-radio__drive">${icon('steering')}</div>${steps(['st_drive_1', 'st_drive_2', 'st_drive_3'])}</div>` },
  {
    key: 'st2', tone: 'bordeaux',
    art: () => {
      const q = t('st2_q');
      return `<div class="sx-search">
        <div class="sx-bar">${icon('search')}<span class="sx-type" style="--n:${q.length}">${esc(q)}</span><i class="sx-caret"></i></div>
        ${[0, 1, 2].map((i) => `<div class="sx-row" style="--d:${i * 0.12}s"><b></b><span><i></i><i></i></span></div>`).join('')}
      </div>`;
    },
  },
  {
    key: 'st3', tone: 'vinyl',
    art: () => `<div class="sx-hand">
      <span class="sx-arrow sx-arrow--l">${icon('prev')}</span>${record('sx-scrub')}<span class="sx-arrow sx-arrow--r">${icon('next')}</span>
    </div>`,
  },
  { key: 'st_tape', tone: 'navy', art: () => `<div class="sx-players">${PLAYERS
    .map((m, i) => `<span class="sx-player" style="--d:${i * 0.08}s">${icon('pm_' + m)}<small>${esc(t('player_' + m))}</small></span>`).join('')}</div>` },
  {
    key: 'st6', tone: 'bordeaux',
    art: () => `<div class="sx-sound">
      <div class="sx-rings"><i></i><i></i><i></i>${record('sx-slow')}</div>
      <div class="sx-chips">${['0.85×', '33⅓', '45'].map((c, i) => `<span class="sx-chip${i ? '' : ' is-on'}">${c}</span>`).join('')}</div>
      <span class="sx-pill">${esc(t('sound_slowrev'))}</span>
    </div>`,
  },
  {
    key: 'st7', tone: 'vinyl',
    art: () => `<div class="sx-custom">
      <div class="sx-discs">${['#101218', '#5A1420', '#D5BF9B', '#1E3A2C', '#B08D57']
        .map((c, i) => `<span class="sx-disc" style="--c:${c};--d:${i * 0.09}s"></span>`).join('')}</div>
      <div class="sx-themes">${themeSwatches()
        .map((sw, i) => `<span class="sx-theme" style="--d:${0.5 + i * 0.07}s">${sw.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`).join('')}</div>
    </div>`,
  },
  {
    key: 'st4', tone: 'cream',
    art: () => `<div class="sx-grid">${[['heart', 'lib_likes'], ['shelf', 'lib_playlists'], ['clock', 'lib_history'], ['offline', 'st_offline']]
      .map(([ic, key], i) => `<div class="sx-tile" style="--d:${i * 0.1}s">${icon(ic)}<span>${esc(t(key))}</span></div>`).join('')}</div>`,
  },
  {
    key: 'st8', tone: 'bordeaux',
    art: () => `<div class="sx-chat">
      <div class="sx-msg">${esc(t('st8_query'))}</div>
      <div class="sx-audio"><span class="sx-play">${icon('play')}</span>
        <span class="sx-audio__meta"><b>${esc(t('st8_track'))}</b>
          <span class="sx-wave">${[5, 9, 14, 8, 12, 16, 10, 6, 13, 9, 15, 7, 11, 14, 8, 5, 10, 13, 7, 9].map((v) => `<i style="height:${v}px"></i>`).join('')}</span>
        </span></div>
    </div>`,
  },
  // the last one: choose a player right here, and it is what you open the app with
  { key: 'st_pick', tone: 'navy', art: () => `<div class="sx-pick">${PLAYERS.map((m) => `<button class="sx-pick__item ${m === settings.playerMode ? 'is-on' : ''}" data-pick="${m}">
    ${icon('pm_' + m)}<span>${esc(t('player_' + m))}</span></button>`).join('')}</div>` },
];

// the pages shown now (the intro, or the one-off page asking to support the author)
let deck = SLIDES;
let root = null, index = 0, fill = null, done = null, keyHandler = null, visHandler = null;

/** Shows the stories; resolves once they are closed. */
export function showStories(slides = SLIDES) {
  if (root) return Promise.resolve();
  deck = slides;
  const last = deck.length - 1;
  const keys = deck.map((s) => s.key);
  root = h(`<div class="stories" role="dialog" aria-modal="true" aria-label="Musique">
    ${deck.map((s, i) => `<section class="story story--${s.tone}" aria-hidden="true">
      <div class="story__art">${s.art()}</div>
      <div class="story__copy">
        <h2 class="story__title">${esc(t(`${keys[i]}_t`))}</h2>
        <p class="story__text">${esc(t(`${keys[i]}_s`))}</p>
        ${i === last ? (s.cta || `<button class="btn story__cta" data-start>${esc(t('st_start'))}</button>`) : ''}
      </div>
    </section>`).join('')}
    <div class="stories__top">
      <div class="stories__bars">${deck.map(() => '<span class="stories__bar"><i></i></span>').join('')}</div>
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

const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
const BOT_URL = 'https://t.me/musiqueenbot';

/** The bot is where support is given (Telegram Stars or a tea): the app itself never takes a payment. */
export function openSupport() {
  if (tg?.initData && tg.openTelegramLink) tg.openTelegramLink(BOT_URL); // inside Telegram; in a browser an ordinary link
  else window.open(BOT_URL, '_blank', 'noopener');
}

const SUPPORT = [
  { key: 'st_support1', tone: 'bordeaux', art: () => `<div class="sx-hero">${record('sx-spin')}<span class="sx-heart">${icon('heart')}</span></div>` },
  { key: 'st_support2', tone: 'navy', art: () => `<div class="sx-hero sx-hero--small">${icon('pm_record')}</div>`,
    cta: `<button class="btn story__cta" data-support>${icon('heart')}<span>${esc(t('st_support_btn'))}</span></button><button class="story__later" data-start>${esc(t('st_support_later'))}</button>` },
];

/** Once, after two weeks of use: a page in the style of the intro offering to support the author. The first launch only
 *  stamps the day; it never shows while something else is on screen (it waits for the next launch). */
export async function maybeShowSupport() {
  if (!settings.firstUse) { updateSettings({ firstUse: Date.now() }); return; }
  if (settings.supportAsked || !settings.storiesSeen || Date.now() - settings.firstUse < TWO_WEEKS) return;
  if (root || document.body.classList.contains('player-open') || document.body.classList.contains('drive-open') || document.querySelector('.sheet, .dialog')) return;
  updateSettings({ supportAsked: true }); // asked once, however it is closed
  await showStories(SUPPORT);
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
  index = Math.max(0, Math.min(deck.length - 1, i));
  root.querySelectorAll('.story').forEach((s, j) => {
    s.classList.toggle('is-active', j === index);
    s.setAttribute('aria-hidden', String(j !== index));
  });
  root.dataset.tone = deck[index].tone;
  const bars = [...root.querySelectorAll('.stories__bar i')];
  fill?.cancel();
  bars.forEach((b, j) => { b.style.transform = j < index ? 'scaleX(1)' : 'scaleX(0)'; });
  fill = bars[index].animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: SLIDE_MS, fill: 'forwards' });
  // the last story waits for "Start listening" instead of closing on its own
  if (index < deck.length - 1) fill.onfinish = () => go(index + 1);
  if (document.hidden) fill.pause();
}

function next() {
  haptic('select');
  if (index === deck.length - 1) close();
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
    if (e.target.closest('button')) { x0 = null; return; }
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
    if (x0 === null || e.target.closest('button')) return;
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
    else if (e.target.closest('[data-support]')) { haptic('success'); openSupport(); close(); }
    else if (e.target.closest('[data-pick]')) { // the player chosen on the last page: on at once, the intro ends
      const pick = e.target.closest('[data-pick]');
      haptic('success');
      root.querySelectorAll('[data-pick]').forEach((b) => b.classList.toggle('is-on', b === pick));
      updateSettings({ playerMode: pick.dataset.pick });
      setTimeout(close, 450);
    }
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
