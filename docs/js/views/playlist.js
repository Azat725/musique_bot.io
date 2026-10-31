import { api } from '../api.js';
import { plural, t } from '../i18n.js';
import { player } from '../player.js';
import { invalidatePlaylists, likedList } from '../store.js';
import { confirmSheet, esc, h, haptic, icon, loader, promptName, sheet, toast, trackList } from '../ui.js';

const FILTER_FROM = 8; // a list this long (or longer) gets a search field
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');

async function loadTracks(p) {
  switch (p.kind) {
    case 'tracks': return p.tracks;
    case 'yt': return (await api.collection(p.id)).tracks;
    case 'album': {
      const data = await api.album(p.id);
      p.title = data.title || p.title;
      return data.tracks;
    }
    case 'likes': return likedList();
    case 'history': return (await api.history()).tracks;
    case 'user': {
      const data = await api.playlist(p.id);
      p.title = data.name;
      return data.tracks;
    }
  }
  return [];
}

const EMPTY = { likes: 'likes_empty', history: 'history_empty' };

/** Any list of tracks: chart, genre, favourites, history or a user playlist. */
export async function render(params, nav) {
  const root = h(`<div class="view">
    <header class="view__head view__head--list">
      <div class="view__kicker">${esc(params.kind === 'user' ? t('lib_playlists') : params.kind === 'album' ? t('album_kicker') : '')}</div>
      <h1 class="view__title">${esc(params.title)}</h1>
      <div class="view__sub"></div>
      <div class="list-actions">
        <button class="btn btn--accent" data-play>${icon('play')}${esc(t('play'))}</button>
        <button class="btn btn--outline" data-shuffle>${icon('shuffle')}${esc(t('shuffle'))}</button>
        <button class="icon-btn" data-more hidden aria-label="more">${icon('more')}</button>
      </div>
    </header>
    <div class="searchbar searchbar--list" hidden>
      ${icon('search')}
      <input type="search" enterkeyhint="search" autocomplete="off" placeholder="${esc(t('list_filter'))}">
      <button class="icon-btn searchbar__clear" aria-label="clear" hidden>${icon('close')}</button>
    </div>
    <div class="list__body">${loader()}</div>
  </div>`);
  const body = root.querySelector('.list__body');
  const sub = root.querySelector('.view__sub');
  const more = root.querySelector('[data-more]');
  const filterBar = root.querySelector('.searchbar--list');
  const filterInput = filterBar.querySelector('input');
  const filterClear = filterBar.querySelector('.searchbar__clear');
  let tracks = [];
  let query = '';

  /** What the filter lets through; with an empty field, the list itself. */
  const shown = () => {
    const q = norm(query.trim());
    return q ? tracks.filter((tr) => norm(`${tr.title} ${tr.artist}`).includes(q)) : tracks;
  };

  const refreshCount = (visible = shown()) => {
    sub.textContent = query.trim() ? t('list_found', { n: visible.length, m: tracks.length }) : plural(tracks.length);
    root.querySelector('.list-actions').classList.toggle('is-disabled', !tracks.length);
  };

  function draw() {
    body.innerHTML = '';
    filterBar.hidden = tracks.length < FILTER_FROM;
    if (filterBar.hidden && query) { query = ''; filterInput.value = ''; filterClear.hidden = true; }
    if (!tracks.length) {
      body.append(h(`<div class="empty"><div class="empty__title">${esc(t(EMPTY[params.kind] || 'playlist_empty'))}</div></div>`));
    } else {
      const visible = shown().slice(); // a copy: the list splices out what is removed, the filter keeps the rest
      if (!visible.length) {
        body.append(h(`<div class="empty"><div class="empty__title">${esc(t('search_nothing'))}</div></div>`));
      } else {
        const context = { playlistId: params.kind === 'user' ? params.id : null, likes: params.kind === 'likes' };
        body.append(trackList(visible, { numbered: params.kind !== 'history', context, onChange: () => {
          const left = new Set(visible.map((tr) => tr.id)); // a row was taken off: forget it in the whole list too
          const gone = shown().filter((tr) => !left.has(tr.id)).map((tr) => tr.id);
          tracks = tracks.filter((tr) => !gone.includes(tr.id));
          refreshCount(visible);
          if (!tracks.length || !visible.length) draw();
        } }));
      }
    }
    refreshCount();
  }

  filterInput.addEventListener('input', () => {
    query = filterInput.value;
    filterClear.hidden = !query;
    draw();
  });
  filterClear.addEventListener('click', () => { filterInput.value = ''; query = ''; filterClear.hidden = true; draw(); filterInput.focus(); });

  root.querySelector('[data-play]').addEventListener('click', () => { const v = shown(); if (v.length) { haptic('medium'); player.playQueue(v, 0); } });
  root.querySelector('[data-shuffle]').addEventListener('click', () => { const v = shown(); if (v.length) { haptic('medium'); player.playQueue(v, 0, { shuffle: true }); } });

  if (params.kind === 'user' || params.kind === 'history') {
    more.hidden = false;
    more.addEventListener('click', async () => {
      if (params.kind === 'history') {
        const i = await sheet({ items: [{ icon: 'trash', label: t('clear_history'), danger: true }] });
        if (i === 0) { await api.clearHistory(); tracks = []; draw(); toast(t('settings_cleared'), 'done'); }
        return;
      }
      const i = await sheet({ title: esc(params.title), items: [
        { icon: 'edit', label: t('rename') },
        { icon: 'trash', label: t('delete'), danger: true },
      ] });
      if (i === 0) {
        const name = await promptName({ title: t('rename'), value: params.title, action: t('save') });
        if (!name) return;
        await api.renamePlaylist(params.id, name);
        invalidatePlaylists();
        params.title = name;
        root.querySelector('.view__title').textContent = name;
      } else if (i === 1 && await confirmSheet({ title: params.title, text: t('playlist_delete_confirm', { name: params.title }), action: t('delete') })) {
        await api.deletePlaylist(params.id);
        invalidatePlaylists();
        haptic('success');
        nav.back();
      }
    });
  }

  tracks = await loadTracks(params);
  root.querySelector('.view__title').textContent = params.title;
  draw();
  if (params.kind === 'likes') {
    let dirty = false;
    document.addEventListener('likes-changed', () => { dirty = true; });
    root.onShow = async () => { if (!dirty) return; dirty = false; tracks = await loadTracks(params); draw(); };
  }
  return root;
}
