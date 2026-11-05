import { api } from '../api.js';
import { viewScope } from '../lifecycle.js';
import { plural, t } from '../i18n.js';
import { player } from '../player.js';
import { invalidatePlaylists, likedList, settings, updateSettings } from '../store.js';
import { artistsOf, byArtist, SORT_KEYS, sortTracks } from '../tracklist.js';
import { isSaved, MAX_SAVED, offline, progress as savedProgress, usage as savedUsage } from '../offline.js';
import { confirmSheet, esc, h, haptic, icon, loader, promptName, sheet, toast, trackList } from '../ui.js';

const FILTER_FROM = 8; // a list this long (or longer) gets a search field
const playlistSorts = new Map(); // a playlist's chosen order, kept until the app is closed (the favourites' one is a setting)
const sortLabel = (k) => t(k === 'new' || k === 'old' ? 'sort_' + k : 'lsort_' + k);
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
    ${params.kind === 'likes' || params.kind === 'user' ? `<div class="list-tools" hidden>
      <button class="link link--sort" data-sort>${icon('sort')}<span></span></button>
      <button class="link link--sort" data-artist hidden>${icon('micFav')}<span></span></button>
    </div>` : ''}
    ${params.kind === 'likes' ? `<label class="download-filter"><input type="checkbox" data-saved-only>${esc(t('downloads_only'))}</label>` : ''}
    <div class="list__body">${loader()}</div>
  </div>`);
  const body = root.querySelector('.list__body');
  const scope = viewScope(root);
  const sub = root.querySelector('.view__sub');
  const more = root.querySelector('[data-more]');
  const filterBar = root.querySelector('.searchbar--list');
  const filterInput = filterBar.querySelector('input');
  const filterClear = filterBar.querySelector('.searchbar__clear');
  let tracks = [];
  let query = '';
  let savedOnly = false;
  let artist = ''; // the artist the list is narrowed to ('' = all)
  const tools = root.querySelector('.list-tools');
  const sortBtn = root.querySelector('[data-sort]');
  const artistBtn = root.querySelector('[data-artist]');
  // favourites come newest first, a playlist oldest first
  const sortKey = () => {
    const k = params.kind === 'likes' ? settings.likesSort : playlistSorts.get(params.id);
    return SORT_KEYS.includes(k) ? k : 'default';
  };

  /** What the filters let through, in the chosen order; with nothing chosen, the list itself. */
  const shown = () => {
    const q = norm(query.trim());
    const kept = tracks.filter((tr) => (!savedOnly || isSaved(tr.id)) && (!q || norm(`${tr.title} ${tr.artist}`).includes(q)));
    return sortTracks(byArtist(kept, artist), sortKey(), { newestFirst: params.kind === 'likes' });
  };

  /** The sort and artist buttons: shown for a list of two or more, with what is chosen written on them. */
  function refreshTools() {
    if (!tools) return;
    if (artist && !tracks.some((tr) => String(tr.artist || '').trim() === artist)) artist = ''; // its last track was taken off
    tools.hidden = tracks.length < 2;
    sortBtn.querySelector('span').textContent = sortLabel(sortKey());
    artistBtn.hidden = artistsOf(tracks).length < 2 && !artist;
    artistBtn.querySelector('span').textContent = artist || t('lsort_all_artists');
  }

  const refreshCount = (visible = shown()) => {
    let text = query.trim() || artist ? t('list_found', { n: visible.length, m: tracks.length }) : plural(tracks.length);
    if (params.kind === 'likes' && settings.offlineLikes && tracks.length) { // how much plays without a network
      const { done, total, capped } = savedProgress();
      const mb = Math.max(1, Math.round(savedUsage().bytes / 1048576));
      text += ' · ' + (done < total ? t('offline_some', { n: done, m: total }) : capped ? t('offline_capped', { n: MAX_SAVED, mb }) : t('offline_all', { mb }));
    }
    sub.textContent = text;
    root.querySelector('.list-actions').classList.toggle('is-disabled', !tracks.length);
    refreshTools();
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
  sortBtn?.addEventListener('click', async () => {
    const i = await sheet({ title: esc(t('lsort_title')), items: SORT_KEYS.map((k) => ({ icon: k === sortKey() ? 'check' : 'sort', label: sortLabel(k) })) });
    if (i === null || SORT_KEYS[i] === sortKey()) return;
    haptic('select');
    if (params.kind === 'likes') updateSettings({ likesSort: SORT_KEYS[i] }); else playlistSorts.set(params.id, SORT_KEYS[i]);
    draw();
  });
  artistBtn?.addEventListener('click', async () => {
    const list = artistsOf(tracks);
    const i = await sheet({ title: esc(t('lsort_artist_title')), items: [{ icon: artist ? 'mic' : 'check', label: t('lsort_all_artists') },
      ...list.map((a) => ({ icon: a.name === artist ? 'check' : 'mic', label: `${a.name} · ${a.count}` }))] });
    if (i === null) return;
    haptic('select');
    artist = i === 0 ? '' : list[i - 1].name;
    draw();
  });
  root.querySelector('[data-saved-only]')?.addEventListener('change', (e) => { savedOnly = e.target.checked; draw(); });
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

  try { tracks = await loadTracks(params); } catch(error) { root.dispose(); throw error; }
  root.querySelector('.view__title').textContent = params.title;
  draw();
  scope.listen(document, 'playlist-restored', async (e) => {
    if (e.detail === params.id || (e.detail === 'likes' && params.kind === 'likes')) { tracks = await loadTracks(params); if (!root.disposed) draw(); }
  });
  if (params.kind === 'likes') {
    scope.listen(offline, 'change', () => { if (root.isConnected) { if (savedOnly) draw(); else refreshCount(); } });
    let dirty = false;
    scope.listen(document, 'likes-changed', () => { dirty = true; });
    root.onShow = async () => { if (!dirty) return; dirty = false; tracks = await loadTracks(params); draw(); };
  }
  return root;
}
