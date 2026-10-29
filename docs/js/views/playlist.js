import { api } from '../api.js';
import { plural, t } from '../i18n.js';
import { player } from '../player.js';
import { invalidatePlaylists, likedList } from '../store.js';
import { confirmDialog, esc, h, haptic, icon, promptName, sheet, toast, trackList } from '../ui.js';

async function loadTracks(p) {
  switch (p.kind) {
    case 'tracks': return p.tracks;
    case 'yt': return (await api.collection(p.id)).tracks;
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
      <div class="view__kicker">${esc(params.kind === 'user' ? t('lib_playlists') : '')}</div>
      <h1 class="view__title">${esc(params.title)}</h1>
      <div class="view__sub"></div>
      <div class="list-actions">
        <button class="btn btn--accent" data-play>${icon('play')}${esc(t('play'))}</button>
        <button class="btn btn--outline" data-shuffle>${icon('shuffle')}${esc(t('shuffle'))}</button>
        <button class="icon-btn" data-more hidden aria-label="more">${icon('more')}</button>
      </div>
    </header>
    <div class="list__body"><div class="skeleton">${'<div class="sk sk--row"></div>'.repeat(8)}</div></div>
  </div>`);
  const body = root.querySelector('.list__body');
  const sub = root.querySelector('.view__sub');
  const more = root.querySelector('[data-more]');
  let tracks = [];

  const refreshCount = () => {
    sub.textContent = plural(tracks.length);
    root.querySelector('.list-actions').classList.toggle('is-disabled', !tracks.length);
  };

  function draw() {
    body.innerHTML = '';
    if (!tracks.length) {
      body.append(h(`<div class="empty"><div class="empty__title">${esc(t(EMPTY[params.kind] || 'playlist_empty'))}</div></div>`));
    } else {
      const context = { playlistId: params.kind === 'user' ? params.id : null, likes: params.kind === 'likes' };
      body.append(trackList(tracks, { numbered: params.kind !== 'history', context, onChange: () => { refreshCount(); if (!tracks.length) draw(); } }));
    }
    refreshCount();
  }

  root.querySelector('[data-play]').addEventListener('click', () => { if (tracks.length) { haptic('medium'); player.playQueue(tracks, 0); } });
  root.querySelector('[data-shuffle]').addEventListener('click', () => { if (tracks.length) { haptic('medium'); player.playQueue(tracks, 0, { shuffle: true }); } });

  if (params.kind === 'user' || params.kind === 'history') {
    more.hidden = false;
    more.addEventListener('click', async () => {
      if (params.kind === 'history') {
        const i = await sheet({ items: [{ icon: 'trash', label: t('clear_history'), danger: true }] });
        if (i === 0) { await api.clearHistory(); tracks = []; draw(); toast(t('settings_cleared')); }
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
      } else if (i === 1 && await confirmDialog(t('playlist_delete_confirm', { name: params.title }))) {
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
