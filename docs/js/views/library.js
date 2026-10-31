import { api } from '../api.js';
import { plural, t } from '../i18n.js';
import { favArtists, getPlaylists, invalidatePlaylists, likedList, likes, loadFavArtists, settings, updateSettings } from '../store.js';
import { EASE_IO, esc, h, haptic, icon, loader, promptName, reducedMotion, sheet, thumb, toast } from '../ui.js';

const OPEN_DELAY_MS = 520; // how long the tile's icon plays before its list opens

// playlist ids grow with creation time, so the id stands in for the date added
const SORTS = {
  new: (a, b) => b.id - a.id,
  old: (a, b) => a.id - b.id,
  most: (a, b) => b.count - a.count || b.id - a.id,
  least: (a, b) => a.count - b.count || b.id - a.id,
};

function mosaic(covers) {
  if (!covers.length) return `<div class="mosaic mosaic--empty">${icon('library')}</div>`;
  const img = (c, px) => `<img src="${esc(thumb(c, px))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  if (covers.length < 4) return `<div class="mosaic">${img(covers[0], 168)}</div>`;
  return `<div class="mosaic mosaic--4">${covers.map((c) => img(c, 96)).join('')}</div>`;
}

export async function render(_, nav) {
  const root = h(`<div class="view">
    <header class="view__head"><h1 class="view__title">${esc(t('nav_library'))}</h1></header>
    <div class="tiles">
      <button class="tile tile--accent" data-go="likes">${icon('shelf')}<span class="tile__title">${esc(t('lib_likes'))}</span><span class="tile__sub">${esc(plural(likes.size))}</span></button>
      <button class="tile tile--navy" data-go="history">${icon('clock')}<span class="tile__title">${esc(t('lib_history'))}</span><span class="tile__sub">&nbsp;</span></button>
      <button class="tile tile--wide" data-go="artists">${icon('micFav')}<span class="tile__text"><span class="tile__title">${esc(t('lib_artists'))}</span><span class="tile__sub"></span></span></button>
    </div>
    <section class="section">
      <div class="section__head"><h2 class="section__title">${esc(t('lib_playlists'))}</h2>
        <div class="section__tools">
          <button class="link link--sort" data-sort hidden>${icon('sort')}<span></span></button>
          <button class="icon-btn icon-btn--accent" data-create aria-label="${esc(t('lib_new_playlist'))}">${icon('plus')}</button>
        </div></div>
      <div class="playlists">${loader()}</div>
    </section>
  </div>`);

  // Favourites and History open a beat after the tap, so the icon's little motion (the heart beating, the clock
  // running back) is seen before the screen moves; what the list needs is loaded meanwhile
  let opening = false;
  const openSlowly = (tile, params, warm) => tile.addEventListener('click', () => {
    if (opening) return;
    opening = true;
    tile.classList.add('is-opening');
    warm?.().catch(() => {});
    setTimeout(() => {
      opening = false;
      tile.classList.remove('is-opening');
      nav.push('playlist', params);
    }, reducedMotion() ? 0 : OPEN_DELAY_MS);
  });
  openSlowly(root.querySelector('[data-go="likes"]'), { kind: 'likes', title: t('lib_likes') }, likedList);
  openSlowly(root.querySelector('[data-go="history"]'), { kind: 'history', title: t('lib_history') }, () => api.history());
  root.querySelector('[data-go="artists"]').addEventListener('click', () => nav.push('artists'));
  const artistsSub = root.querySelector('[data-go="artists"] .tile__sub');
  const syncArtists = () => { artistsSub.textContent = t('artists_count', { n: favArtists.size }); };
  loadFavArtists().then(syncArtists, () => {});
  document.addEventListener('fav-artists-changed', syncArtists);

  const list = root.querySelector('.playlists');
  const sortBtn = root.querySelector('[data-sort]');
  let dirty = false, playlists = [];
  const rows = new Map(); // playlist id -> row element
  document.addEventListener('playlists-changed', () => { dirty = true; });

  const sortKey = () => (SORTS[settings.plSort] ? settings.plSort : 'new');

  /** Put the rows in the chosen order; existing rows glide to their new places (FLIP). */
  function arrange(animate) {
    const before = animate ? new Map([...rows].map(([id, el]) => [id, el.getBoundingClientRect().top])) : null;
    playlists.slice().sort(SORTS[sortKey()]).forEach((p) => list.append(rows.get(p.id)));
    sortBtn.querySelector('span').textContent = t('sort_' + sortKey());
    if (!before || reducedMotion()) return;
    rows.forEach((el, id) => {
      const dy = before.get(id) - el.getBoundingClientRect().top;
      if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 480, easing: EASE_IO });
    });
  }

  async function load() {
    try {
      playlists = await getPlaylists();
    } catch {
      list.innerHTML = `<div class="empty empty--inline"><div class="empty__text">${esc(t('offline_lists'))}</div></div>`;
      dirty = true; // asked again when the library is shown next
      return;
    }
    list.innerHTML = '';
    rows.clear();
    sortBtn.hidden = playlists.length < 2;
    if (!playlists.length) {
      const empty = h(`<div class="pl-empty">${EMPTY_ART}
        <div class="pl-empty__title">${esc(t('lib_empty_title'))}</div>
        <div class="pl-empty__text">${esc(t('lib_empty_playlists'))}</div>
        <button class="btn btn--accent" data-new>${icon('plus')}${esc(t('lib_new_playlist'))}</button>
        <button class="link" data-import>${esc(t('import_menu'))}</button></div>`);
      empty.querySelector('[data-new]').addEventListener('click', createPlaylist);
      empty.querySelector('[data-import]').addEventListener('click', () => importPlaylist(nav));
      list.append(empty);
      return;
    }
    playlists.forEach((p) => {
      const row = h(`<button class="pl-row">${mosaic(p.covers)}
        <span class="pl-row__meta"><span class="pl-row__name">${esc(p.name)}</span><span class="pl-row__count">${esc(plural(p.count))}</span></span>
        ${icon('right', 'pl-row__chev')}</button>`);
      row.addEventListener('click', () => nav.push('playlist', { kind: 'user', id: p.id, title: p.name }));
      rows.set(p.id, row);
    });
    arrange(false);
  }

  sortBtn.addEventListener('click', async () => {
    const keys = Object.keys(SORTS);
    const i = await sheet({ title: esc(t('sort_title')), items: keys.map((k) => ({ icon: k === sortKey() ? 'check' : 'sort', label: t('sort_' + k) })) });
    if (i === null || keys[i] === sortKey()) return;
    haptic('select');
    updateSettings({ plSort: keys[i] });
    arrange(true);
  });

  async function createPlaylist() {
    const name = await promptName({ title: t('lib_new_playlist'), action: t('create') });
    if (!name) return;
    const { id } = await api.createPlaylist(name);
    invalidatePlaylists();
    haptic('success');
    nav.push('playlist', { kind: 'user', id, title: name });
  }

  root.querySelector('[data-create]').addEventListener('click', async () => {
    const choice = await sheet({ items: [{ icon: 'plus', label: t('lib_new_playlist') }, { icon: 'import', label: t('import_menu') }] });
    if (choice === 1) importPlaylist(nav);
    else if (choice === 0) createPlaylist();
  });

  // no network: favourites still play if they are saved; the rest waits for the network
  const note = h(`<div class="offline-note" hidden>${icon('offline')}<span>${esc(t(settings.offlineLikes ? 'offline_note' : 'offline_note_off'))}</span></div>`);
  root.querySelector('.tiles').before(note);
  const syncNote = () => { note.hidden = navigator.onLine; };
  syncNote();
  addEventListener('online', () => { syncNote(); if (root.isConnected) { dirty = false; load(); } });
  addEventListener('offline', syncNote);

  await load();
  root.onShow = () => {
    if (dirty) { dirty = false; load(); }
    root.querySelector('[data-go="likes"] .tile__sub').textContent = plural(likes.size);
  };
  return root;
}

// ---------- import a playlist from another app (a link) or a pasted list of tracks ----------

const IMPORT_ERRORS = ['unrecognized', 'youtube', 'spotify', 'yandex', 'empty'];

/** The empty state of "Playlists": a record peeking out of its sleeve, and the two ways to begin. */
const EMPTY_ART = `<svg class="pl-empty__art" viewBox="0 0 160 120" aria-hidden="true">
  <g class="pl-empty__record"><circle cx="92" cy="58" r="44"/>${[36, 28, 20].map((r) => `<circle class="g" cx="92" cy="58" r="${r}"/>`).join('')}<circle class="l" cx="92" cy="58" r="13"/><circle class="h" cx="92" cy="58" r="2.4"/></g>
  <rect class="pl-empty__sleeve" x="14" y="18" width="84" height="84" rx="4"/><path class="pl-empty__slot" d="M14 34h84"/><circle class="pl-empty__dot" cx="56" cy="68" r="12"/>
</svg>`;

function importPlaylist(nav) {
  const root = h(`<div class="dialog" role="dialog" aria-modal="true">
    <form class="dialog__panel import">
      <div class="dialog__title">${esc(t('import_title'))}</div>
      <p class="import__hint">${esc(t('import_hint'))}</p>
      <textarea class="field import__field" rows="5" maxlength="20000" placeholder="${esc(t('import_placeholder'))}" required></textarea>
      <p class="import__error" hidden></p>
      <div class="import__busy" hidden>${loader()}<span>${esc(t('import_busy'))}</span></div>
      <div class="dialog__actions">
        <button type="button" class="btn btn--ghost" data-cancel>${esc(t('cancel'))}</button>
        <button type="submit" class="btn btn--accent">${esc(t('import_go'))}</button>
      </div>
    </form>
  </div>`);
  const form = root.querySelector('form');
  const field = root.querySelector('textarea');
  const error = root.querySelector('.import__error');
  let busy = false, gone = false;
  const close = () => { gone = true; root.remove(); };
  root.querySelector('[data-cancel]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const source = field.value.trim();
    if (!source || busy) return;
    busy = true;
    error.hidden = true;
    form.classList.add('is-busy');
    root.querySelector('.import__busy').hidden = false;
    form.querySelectorAll('button[type=submit], textarea').forEach((x) => { x.disabled = true; });
    try {
      const r = await api.importPlaylist(source);
      invalidatePlaylists();
      if (gone) { toast(t('import_done', { n: r.added, m: r.total }), 'done'); return; } // closed while waiting: just say so
      close();
      toast(t('import_done', { n: r.added, m: r.total }), 'done');
      if (r.missing?.length) await showMissing(r);
      nav.push('playlist', { kind: 'user', id: r.id, title: r.name });
    } catch (err) {
      haptic('error');
      error.textContent = t(IMPORT_ERRORS.includes(err.code) ? 'import_err_' + err.code : 'import_err_network');
      error.hidden = false;
    } finally {
      busy = false;
      form.classList.remove('is-busy');
      root.querySelector('.import__busy').hidden = true;
      form.querySelectorAll('button[type=submit], textarea').forEach((x) => { x.disabled = false; });
    }
  });
  document.body.append(root);
  setTimeout(() => field.focus(), 50);
}

function showMissing(r) {
  const more = r.total - r.added - r.missing.length; // the server lists the first 20; duplicates count as found
  const content = h(`<div class="import-missing">
    <p class="import-missing__lead">${esc(t('import_missing', { n: r.total - r.added }))}</p>
    <ul>${r.missing.map((m) => `<li>${esc(m)}</li>`).join('')}${more > 0 ? `<li class="import-missing__more">${esc(t('import_missing_more', { n: more }))}</li>` : ''}</ul>
  </div>`);
  return sheet({ title: esc(r.name), content, closeLabel: t('import_open') });
}
