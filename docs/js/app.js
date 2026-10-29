import { api } from './api.js';
import { setLang, t } from './i18n.js';
import { player } from './player.js';
import { loadLikes, onSettings, settings, syncCloudSettings } from './store.js';
import { EASE_IO, cover, esc, h, haptic, icon, loader, markPlaying, openArtist, reducedMotion, tg, toast } from './ui.js';
import { initEq } from './eq.js';
import { syncVinylNoise } from './sfx.js';
import { closePlayer, initFullPlayer, isPlayerOpen, openPlayer, translate as translatePlayer } from './vinyl.js';
import * as artist from './views/artist.js';
import * as home from './views/home.js';
import * as library from './views/library.js';
import * as playlist from './views/playlist.js';
import * as search from './views/search.js';
import * as settingsView from './views/settings.js';

const VIEWS = { home, search, library, settings: settingsView, playlist, artist };
const TABS = [['home', 'home', 'nav_home'], ['search', 'search', 'nav_search'], ['library', 'library', 'nav_library'], ['settings', 'settings', 'nav_settings']];
const COLORS = { light: '#EFE4CF', dark: '#1A1410' }; // --bg of each theme, for Telegram's header and bars

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const mini = document.getElementById('mini');
const stacks = Object.fromEntries(TABS.map(([k]) => [k, [{ name: k, params: {} }]]));
let tab = 'home';

// ---------- theme & language ----------

function resolvedTheme() {
  if (settings.theme !== 'system') return settings.theme;
  if (tg?.colorScheme) return tg.colorScheme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  const color = COLORS[theme];
  try {
    if (tg?.isVersionAtLeast?.('6.1')) { tg.setHeaderColor(color); tg.setBackgroundColor(color); }
    if (tg?.isVersionAtLeast?.('7.10')) tg.setBottomBarColor(color);
  } catch {}
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}

// ---------- navigation ----------

const navApi = {
  push(name, params = {}) {
    const stack = stacks[tab];
    stack[stack.length - 1].scroll = window.scrollY;
    stack.push({ name, params });
    show('forward');
  },
  back() {
    const stack = stacks[tab];
    if (stack.length > 1) { stack.pop(); show('back'); }
  },
};

// how the incoming and the outgoing screen move: deeper slides in from the right, back from the left, tabs cross-fade
const MOVES = {
  forward: { in: [{ opacity: 0, transform: 'translateX(28px)' }, { opacity: 1, transform: 'none' }],
    out: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-14px)' }] },
  back: { in: [{ opacity: 0, transform: 'translateX(-28px)' }, { opacity: 1, transform: 'none' }],
    out: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(28px)' }] },
  tab: { in: [{ opacity: 0, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }],
    out: [{ opacity: 1 }, { opacity: 0 }] },
};
let finishLeaving = null;

/** Put `next` on screen. The old screen is lifted out of the flow where it stands and fades away over the new one. */
function transition(next, dir) {
  finishLeaving?.(); // a second tap first finishes the transition still running
  const prev = main.firstElementChild;
  if (prev === next) return;
  if (!prev || !dir) {
    main.replaceChildren(next);
    next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: EASE_IO });
    return;
  }
  const move = reducedMotion() ? MOVES.tab : MOVES[dir];
  const top = prev.getBoundingClientRect().top;
  Object.assign(prev.style, { position: 'fixed', top: `${top}px`, left: '0', right: '0', zIndex: '1', pointerEvents: 'none' });
  main.append(next);
  next.animate(move.in, { duration: 440, easing: EASE_IO });
  const out = prev.animate(move.out, { duration: 300, easing: EASE_IO, fill: 'forwards' });
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    prev.remove();
    prev.removeAttribute('style'); // cached screens are shown again later
    out.cancel();
    if (finishLeaving === done) finishLeaving = null;
  };
  finishLeaving = done;
  out.finished.then(done, done);
  setTimeout(done, 700); // animations stall while the WebView is in the background; never leave the old screen behind
}

async function show(dir = null) {
  const stack = stacks[tab];
  const entry = stack[stack.length - 1];
  renderNav();
  syncBackButton();
  if (!entry.el) {
    const skeleton = h(`<div class="view">${loader()}</div>`);
    transition(skeleton, dir);
    window.scrollTo(0, 0);
    try {
      entry.el = await VIEWS[entry.name].render(entry.params, navApi);
    } catch (e) {
      console.error(e);
      entry.el = errorView(() => { entry.el = null; show(); });
    }
    if (stacks[tab][stacks[tab].length - 1] !== entry) return; // user navigated away meanwhile
    if (skeleton.isConnected) {
      skeleton.replaceWith(entry.el);
      entry.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE_IO });
    } else {
      transition(entry.el, null);
    }
  } else {
    entry.el.onShow?.();
    transition(entry.el, dir);
  }
  markPlaying(main);
  window.scrollTo(0, entry.scroll || 0);
}

function switchTab(next) {
  if (next === tab) {
    // tapping the active tab returns to its root
    if (stacks[tab].length > 1) { stacks[tab].length = 1; show('back'); }
    else window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  stacks[tab][stacks[tab].length - 1].scroll = window.scrollY;
  tab = next;
  haptic('select');
  show('tab');
}

/** Built once (and again on a language change); navigation only moves the `is-on` class. */
function renderNav(rebuild = false) {
  if (rebuild || !nav.firstChild) {
    nav.innerHTML = TABS.map(([key, ic, label]) =>
      `<button class="nav__item" data-tab="${key}">${icon(ic)}<span>${esc(t(label))}</span></button>`).join('')
      + '<span class="nav__needle" aria-hidden="true"></span>';
  }
  nav.querySelectorAll('.nav__item').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === tab));
  nav.style.setProperty('--tab', TABS.findIndex(([key]) => key === tab)); // the needle slides under the active tab
}

nav.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (btn) switchTab(btn.dataset.tab);
});

const hasBackButton = !!tg?.BackButton && !!tg.isVersionAtLeast?.('6.1');

function syncBackButton() {
  if (!hasBackButton) return;
  if (isPlayerOpen() || stacks[tab].length > 1) tg.BackButton.show();
  else tg.BackButton.hide();
}

if (hasBackButton) tg.BackButton.onClick(() => {
  if (isPlayerOpen()) closePlayer();
  else navApi.back();
});
document.addEventListener('open-artist', (e) => {
  const top = stacks[tab][stacks[tab].length - 1];
  if (isPlayerOpen()) closePlayer();
  if (top.name === 'artist' && (top.params.id ? top.params.id === e.detail.id : top.params.name === e.detail.name)) return;
  navApi.push('artist', { ...e.detail });
});
document.addEventListener('player-open', (e) => {
  document.body.classList.toggle('player-open', e.detail);
  syncBackButton();
});

function errorView(retry) {
  const el = h(`<div class="view"><div class="empty">${icon('vinyl', 'empty__icon')}
    <div class="empty__title">${esc(t('toast_error'))}</div>
    <button class="btn btn--outline">${esc(t('retry'))}</button></div></div>`);
  el.querySelector('button').addEventListener('click', retry);
  return el;
}

// ---------- mini player ----------

function renderMini() {
  const tr = player.current;
  document.body.classList.toggle('has-mini', !!tr);
  if (!tr) { mini.innerHTML = ''; return; }
  if (mini.dataset.id !== tr.id) {
    mini.dataset.id = tr.id;
    mini.innerHTML = `<div class="mini__progress"></div>
      ${cover(tr.cover, 'mini__cover')}
      <div class="mini__meta"><div class="mini__title">${esc(tr.title)}</div><div class="mini__artist">${esc(tr.artist)}</div></div>
      <button class="icon-btn" data-mini-play aria-label="play"></button>
      <button class="icon-btn" data-mini-next aria-label="next">${icon('next')}</button>`;
  }
  mini.querySelector('[data-mini-play]').innerHTML = icon(player.playing ? 'pause' : 'play');
  mini.classList.toggle('is-loading', player.loading);
}

mini.addEventListener('click', (e) => {
  if (e.target.closest('[data-mini-play]')) { haptic('light'); player.toggle(); return; }
  if (e.target.closest('.mini__artist')) { openArtist(player.current); return; }
  if (e.target.closest('[data-mini-next]')) { haptic('light'); player.next(); return; }
  haptic('light');
  openPlayer();
});

player.addEventListener('track', () => { renderMini(); markPlaying(main); });
const noiseOn = () => syncVinylNoise(player.playing && !player.loading);
player.addEventListener('state', () => { renderMini(); markPlaying(main); noiseOn(); });
player.addEventListener('time', () => {
  if (isPlayerOpen()) return; // the mini player is hidden under the full one
  const bar = mini.firstElementChild; // .mini__progress
  if (bar) bar.style.setProperty('--p', player.duration ? player.time / player.duration : 0);
});
player.addEventListener('error', () => { haptic('error'); toast(t('toast_unavailable')); });

// hq720 thumbnails don't exist for every video — fall back once to the always-present mqdefault
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName === 'IMG' && img.src.includes('/hq720.jpg')) img.src = img.src.replace('/hq720.jpg', '/mqdefault.jpg');
}, true);

// ---------- boot ----------

/** The record goes back into its sleeve and the launch screen fades away. */
function dismissBoot() {
  const boot = document.querySelector('.boot');
  if (!boot) return;
  boot.classList.add('is-done');
  setTimeout(() => boot.remove(), 1000);
}

function noServer() {
  dismissBoot();
  const el = h(`<div class="view"><div class="empty empty--full">${icon('vinyl', 'empty__icon')}
    <div class="empty__title">${esc(t('no_server_title'))}</div>
    <div class="empty__text">${esc(t('no_server_text'))}</div>
    <button class="btn btn--accent">${esc(t('retry'))}</button></div></div>`);
  el.querySelector('button').addEventListener('click', () => location.reload());
  main.replaceChildren(el);
  nav.hidden = true;
}

let shownLang = null;

onSettings(() => {
  applyTheme(); // CSS-only, no re-render needed
  noiseOn();
  if (settings.lang === shownLang) return;
  shownLang = settings.lang;
  setLang(settings.lang);
  translatePlayer();
  renderNav(true);
  // re-render views in the new language, keeping navigation
  Object.values(stacks).forEach((stack) => stack.forEach((entry) => { entry.el = null; }));
  show();
});

async function boot() {
  window.__musiqueStarted = true; // read by the load diagnostics in index.html
  try {
    tg?.expand(); // ready() is already called in index.html
    if (tg?.isVersionAtLeast?.('7.7')) tg.disableVerticalSwipes();
  } catch {}
  // the server round trips don't depend on the settings: start them before waiting for CloudStorage
  // (a slow VPN or a cold tunnel can miss the first /me attempt)
  const me = api.hasServer() ? api.me().catch(() => api.me()) : null;
  if (me) { me.catch(() => {}); api.preloadHome(); }
  await syncCloudSettings();
  shownLang = settings.lang;
  setLang(settings.lang);
  applyTheme();
  tg?.onEvent?.('themeChanged', applyTheme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  initFullPlayer();
  initEq();
  renderNav();

  if (!me) return noServer();
  try {
    await me;
    loadLikes().catch(() => {});
  } catch {
    return noServer();
  }
  setTimeout(dismissBoot, 6000); // a slow first screen keeps its own small loader, not the launch screen
  await show();
  dismissBoot();
}

boot();
