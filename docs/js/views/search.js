import { api } from '../api.js';
import { t } from '../i18n.js';
import { clearRecentSearches, pushRecentSearch, recentSearches, settings, updateSettings } from '../store.js';
import { artistRow, confirmSheet, esc, h, haptic, icon, loader, trackList } from '../ui.js';

const MODES = ['all', 'tracks', 'artists'];
let last = null; // { q, mode, tracks, more, artists }

const mode = () => (MODES.includes(settings.searchMode) ? settings.searchMode : 'all');
const isEmpty = (r) => !r.tracks.length && !r.more.length && !r.artists.length;

function section(title, content) {
  const s = h(`<section class="section"><div class="section__head"><h2 class="section__title">${esc(title)}</h2></div></section>`);
  s.append(content);
  return s;
}

/** Artists (in 'all' a few at the top), YouTube Music tracks, then what the other sources found. */
function results(r) {
  const frag = document.createDocumentFragment();
  if (r.artists.length) {
    const list = h('<div class="artists"></div>');
    r.artists.forEach((a) => list.append(artistRow(a)));
    frag.append(r.mode === 'artists' ? list : section(t('search_artists'), list));
  }
  if (r.tracks.length) frag.append(r.artists.length ? section(t('search_tracks'), trackList(r.tracks)) : trackList(r.tracks));
  if (r.more.length) frag.append(section(t('search_more'), trackList(r.more)));
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
    <div class="suggest" role="listbox" hidden></div>
    <div class="segmented search__modes" role="tablist">
      ${MODES.map((m) => `<button role="tab" data-mode="${m}">${esc(t('search_mode_' + m))}</button>`).join('')}
    </div>
    <div class="search__body"></div>
  </div>`);
  const input = root.querySelector('input');
  const clear = root.querySelector('.searchbar__clear');
  const body = root.querySelector('.search__body');
  const modes = root.querySelector('.search__modes');
  const suggestBox = root.querySelector('.suggest');
  let timer, seq = 0, inflight = null, suggestTimer = 0, suggestSeq = 0, suggestAbort = null;
  const syncModes = () => modes.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.mode === mode());
    b.setAttribute('aria-selected', b.dataset.mode === mode());
  });
  syncModes();
  modes.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === mode()) return;
    haptic('select');
    updateSettings({ searchMode: b.dataset.mode });
    syncModes();
    if (input.value.trim()) run(input.value);
  });

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
    head.querySelector('button').addEventListener('click', async () => {
      if (!await confirmSheet({ title: t('search_recent'), text: t('confirm_clear_search'), action: t('search_clear') })) return;
      clearRecentSearches();
      showIdle();
    });
    const chips = h('<div class="chips"></div>');
    recent.forEach((q) => {
      const chip = h(`<button class="chip">${esc(q)}</button>`);
      chip.addEventListener('click', () => { input.value = q; run(q, true); });
      chips.append(chip);
    });
    body.append(head, chips);
  }

  // ---------- completions as the user types: what they searched before, then what YouTube Music suggests ----------

  function hideSuggest() {
    clearTimeout(suggestTimer);
    suggestAbort?.abort();
    suggestSeq++;
    suggestBox.hidden = true;
    suggestBox.replaceChildren();
  }

  function showSuggest(q, fromServer = []) {
    const low = q.toLowerCase();
    const mine = recentSearches().filter((r) => r.toLowerCase().startsWith(low) && r.toLowerCase() !== low).slice(0, 3);
    const items = [...mine.map((text) => ({ text, past: true })),
      ...fromServer.filter((s) => s.toLowerCase() !== low && !mine.some((m) => m.toLowerCase() === s.toLowerCase())).map((text) => ({ text, past: false }))].slice(0, 8);
    suggestBox.replaceChildren(...items.map(({ text, past }) => {
      const row = h(`<button class="suggest__item" role="option">${icon(past ? 'clock' : 'search')}<span>${esc(text)}</span></button>`);
      // pointerdown, not click: the field loses focus first, and that would close the list under the finger
      row.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        haptic('select');
        input.value = text;
        hideSuggest();
        input.blur();
        run(text, true);
      });
      return row;
    }));
    suggestBox.hidden = !items.length;
  }

  function askSuggest() {
    const q = input.value.trim();
    clearTimeout(suggestTimer);
    if (!q || document.activeElement !== input) { hideSuggest(); return; }
    showSuggest(q); // what is already known appears at once
    suggestTimer = setTimeout(async () => {
      suggestAbort?.abort(); // a superseded query must not keep the server busy
      suggestAbort = new AbortController();
      const my = ++suggestSeq;
      try {
        const { suggestions = [] } = await api.suggest(q, suggestAbort.signal);
        if (my === suggestSeq && input.value.trim() === q && document.activeElement === input) showSuggest(q, suggestions);
      } catch { /* no suggestions is fine */ }
    }, 150);
  }

  async function run(q, remember = false) {
    q = q.trim();
    clear.hidden = !q;
    if (!q) { last = null; showIdle(); return; }
    const my = ++seq, m = mode();
    inflight?.abort(); // a superseded query must not keep the server busy
    inflight = new AbortController();
    body.innerHTML = loader();
    try {
      const { tracks = [], more = [], artists = [] } = await api.search(q, inflight.signal, m);
      if (my !== seq) return;
      last = { q, mode: m, tracks, more, artists };
      if (remember) pushRecentSearch(q);
      body.innerHTML = '';
      body.append(isEmpty(last) ? h(`<div class="empty"><div class="empty__title">${esc(t('search_nothing'))}</div></div>`) : results(last));
    } catch {
      if (my === seq) body.innerHTML = `<div class="empty"><div class="empty__title">${esc(t('toast_error'))}</div></div>`;
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value), 350);
    askSuggest();
  });
  input.addEventListener('focus', askSuggest);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(timer); hideSuggest(); run(input.value, true); input.blur(); }
  });
  input.addEventListener('blur', () => {
    hideSuggest();
    if (input.value.trim() && last && !isEmpty(last)) pushRecentSearch(input.value.trim());
  });
  clear.addEventListener('click', () => { input.value = ''; hideSuggest(); run(''); input.focus(); });

  if (last && last.mode === mode()) {
    input.value = last.q;
    clear.hidden = false;
    body.append(isEmpty(last) ? h(`<div class="empty"><div class="empty__title">${esc(t('search_nothing'))}</div></div>`) : results(last));
  } else if (last) {
    input.value = last.q;
    run(last.q);
  } else {
    showIdle();
  }
  root.onShow = () => { if (!input.value) setTimeout(() => input.focus(), 100); };
  return root;
}
