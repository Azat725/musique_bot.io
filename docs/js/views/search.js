import { api } from '../api.js';
import { t } from '../i18n.js';
import { clearRecentSearches, pushRecentSearch, recentSearches } from '../store.js';
import { esc, h, icon, trackList } from '../ui.js';

let lastQuery = '';
let lastTracks = null;

export async function render() {
  const root = h(`<div class="view">
    <header class="view__head"><h1 class="view__title">${esc(t('nav_search'))}</h1></header>
    <div class="searchbar">
      ${icon('search')}
      <input type="search" enterkeyhint="search" autocomplete="off" placeholder="${esc(t('search_placeholder'))}">
      <button class="icon-btn searchbar__clear" aria-label="clear" hidden>${icon('close')}</button>
    </div>
    <div class="search__body"></div>
  </div>`);
  const input = root.querySelector('input');
  const clear = root.querySelector('.searchbar__clear');
  const body = root.querySelector('.search__body');
  let timer, seq = 0;

  function showIdle() {
    const recent = recentSearches();
    body.innerHTML = '';
    if (!recent.length) {
      body.append(h(`<div class="empty">${icon('vinyl', 'empty__icon')}
        <div class="empty__title">${esc(t('search_hint'))}</div>
        <div class="empty__text">${esc(t('search_hint_sub'))}</div></div>`));
      return;
    }
    const head = h(`<div class="section__head"><h2 class="section__title">${esc(t('search_recent'))}</h2>
      <button class="link">${esc(t('search_clear'))}</button></div>`);
    head.querySelector('button').addEventListener('click', () => { clearRecentSearches(); showIdle(); });
    const chips = h('<div class="chips"></div>');
    recent.forEach((q) => {
      const chip = h(`<button class="chip">${esc(q)}</button>`);
      chip.addEventListener('click', () => { input.value = q; run(q, true); });
      chips.append(chip);
    });
    body.append(head, chips);
  }

  async function run(q, remember = false) {
    q = q.trim();
    clear.hidden = !q;
    if (!q) { lastQuery = ''; lastTracks = null; showIdle(); return; }
    const my = ++seq;
    body.innerHTML = `<div class="skeleton">${'<div class="sk sk--row"></div>'.repeat(8)}</div>`;
    try {
      const { tracks } = await api.search(q);
      if (my !== seq) return;
      lastQuery = q;
      lastTracks = tracks;
      if (remember) pushRecentSearch(q);
      body.innerHTML = '';
      body.append(tracks.length ? trackList(tracks)
        : h(`<div class="empty"><div class="empty__title">${esc(t('search_nothing'))}</div></div>`));
    } catch {
      if (my === seq) body.innerHTML = `<div class="empty"><div class="empty__title">${esc(t('toast_error'))}</div></div>`;
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value), 350);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(timer); run(input.value, true); input.blur(); }
  });
  input.addEventListener('blur', () => { if (input.value.trim() && lastTracks?.length) pushRecentSearch(input.value.trim()); });
  clear.addEventListener('click', () => { input.value = ''; run(''); input.focus(); });

  if (lastQuery && lastTracks) {
    input.value = lastQuery;
    clear.hidden = false;
    body.append(trackList(lastTracks));
  } else {
    showIdle();
  }
  root.onShow = () => { if (!input.value) setTimeout(() => input.focus(), 100); };
  return root;
}
