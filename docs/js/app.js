import { api } from './api.js';
import { setLang, t } from './i18n.js';
import { player } from './player.js';
import { loadLikes, onSettings, settings, syncCloudSettings } from './store.js';
import { cover, esc, h, haptic, icon, markPlaying, tg, toast } from './ui.js';
import { closePlayer, initFullPlayer, isPlayerOpen, openPlayer, translate as translatePlayer } from './vinyl.js';
import * as home from './views/home.js';
import * as library from './views/library.js';
import * as playlist from './views/playlist.js';
import * as search from './views/search.js';
import * as settingsView from './views/settings.js';

const VIEWS = { home, search, library, settings: settingsView, playlist };
const TABS = [['home', 'home', 'nav_home'], ['search', 'search', 'nav_search'], ['library', 'library', 'nav_library'], ['settings', 'settings', 'nav_settings']];
const COLORS = { light: '#FFFFFF', dark: '#0B1426' };

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
    show();
  },
  back() {
    const stack = stacks[tab];
    if (stack.length > 1) { stack.pop(); show(); }
  },
};

async function show() {
  const stack = stacks[tab];
  const entry = stack[stack.length - 1];
  renderNav();
  syncBackButton();
  if (!entry.el) {
    main.replaceChildren(h('<div class="view"><div class="skeleton">' + '<div class="sk sk--row"></div>'.repeat(6) + '</div></div>'));
    try {
      entry.el = await VIEWS[entry.name].render(entry.params, navApi);
    } catch (e) {
      console.error(e);
      entry.el = errorView(() => { entry.el = null; show(); });
    }
    if (stacks[tab][stacks[tab].length - 1] !== entry) return; // user navigated away meanwhile
  } else {
    entry.el.onShow?.();
  }
  main.replaceChildren(entry.el);
  markPlaying(main);
  window.scrollTo(0, entry.scroll || 0);
}

function switchTab(next) {
  if (next === tab) {
    // tapping the active tab returns to its root
    if (stacks[tab].length > 1) { stacks[tab].length = 1; show(); }
    else window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  stacks[tab][stacks[tab].length - 1].scroll = window.scrollY;
  tab = next;
  haptic('select');
  show();
}

/** Built once (and again on a language change); navigation only moves the `is-on` class. */
function renderNav(rebuild = false) {
  if (rebuild || !nav.firstChild) {
    nav.innerHTML = TABS.map(([key, ic, label]) =>
      `<button class="nav__item" data-tab="${key}">${icon(ic)}<span>${esc(t(label))}</span></button>`).join('');
  }
  nav.querySelectorAll('.nav__item').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === tab));
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
  if (e.target.closest('[data-mini-next]')) { haptic('light'); player.next(); return; }
  haptic('light');
  openPlayer();
});

player.addEventListener('track', () => { renderMini(); markPlaying(main); });
player.addEventListener('state', () => { renderMini(); markPlaying(main); });
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

function noServer() {
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
  renderNav();

  if (!me) return noServer();
  try {
    await me;
    loadLikes().catch(() => {});
  } catch {
    return noServer();
  }
  show();
}

boot();
