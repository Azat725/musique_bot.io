import { api } from '../api.js';
import { t } from '../i18n.js';
import { clearRecentSearches, pushRecentSearch, recentSearches } from '../store.js';
import { esc, h, icon, trackList } from '../ui.js';

let lastQuery = '';
let lastTracks = null;
let lastMore = [];

/** YouTube Music results, then a block with what the other sources found. */
function results(tracks, more) {
  const frag = document.createDocumentFragment();
  if (tracks.length) frag.append(trackList(tracks));
  if (more.length) {
    const s = h(`<section class="section"><div class="section__head"><h2 class="section__title">${esc(t('search_more'))}</h2></div></section>`);
    s.append(trackList(more));
    frag.append(s);
  }
  return frag;
}

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
  let timer, seq = 0, inflight = null;

  function showIdle() {
    const recent = recentSearches();
    body.innerHTML = '';
    if (!recent.length) {
      body.append(h(`<div class="empty">${icon('vinyl', 'empty__icon')}
        <div class="empty__title">${esc(t('search_hint'))}</div>
</div>`));
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
    if (!q) { lastQuery = ''; lastTracks = null; lastMore = []; showIdle(); return; }
    const my = ++seq;
    inflight?.abort(); // a superseded query must not keep the server busy
    inflight = new AbortController();
    body.innerHTML = `<div class="skeleton">${'<div class="sk sk--row"></div>'.repeat(8)}</div>`;
    try {
      const { tracks, more = [] } = await api.search(q, inflight.signal);
      if (my !== seq) return;
      lastQuery = q;
      lastTracks = tracks;
      lastMore = more;
      if (remember) pushRecentSearch(q);
      body.innerHTML = '';
      body.append(tracks.length || more.length ? results(tracks, more)
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
  input.addEventListener('blur', () => { if (input.value.trim() && (lastTracks?.length || lastMore.length)) pushRecentSearch(input.value.trim()); });
  clear.addEventListener('click', () => { input.value = ''; run(''); input.focus(); });

  if (lastQuery && lastTracks) {
    input.value = lastQuery;
    clear.hidden = false;
    body.append(results(lastTracks, lastMore));
  } else {
    showIdle();
  }
  root.onShow = () => { if (!input.value) setTimeout(() => input.focus(), 100); };
  return root;
}
