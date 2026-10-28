import { api } from './api.js';
import { t } from './i18n.js';
import { player } from './player.js';
import { likes, toggleLike } from './store.js';

export const tg = window.Telegram?.WebApp;

const P = (d) => `<path d="${d}"/>`;
const ICONS = {
  home: P('M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z'),
  search: '<circle cx="11" cy="11" r="6.5"/>' + P('m16 16 4.5 4.5'),
  library: P('M5 4v16M10 4v16') + P('m14.5 4.6 4.6 15'),
  settings: P('M4 7h10M18 7h2M4 17h4M12 17h8') + '<circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  play: '<path class="fill" d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z"/>',
  pause: '<rect class="fill" x="6.5" y="5" width="3.8" height="14" rx="1"/><rect class="fill" x="13.7" y="5" width="3.8" height="14" rx="1"/>',
  next: '<path class="fill" d="M5 6.2v11.6a.7.7 0 0 0 1.1.6l8.4-5.8a.7.7 0 0 0 0-1.2L6.1 5.6a.7.7 0 0 0-1.1.6z"/>' + P('M18.5 5.5v13'),
  prev: '<path class="fill" d="M19 6.2v11.6a.7.7 0 0 1-1.1.6l-8.4-5.8a.7.7 0 0 1 0-1.2l8.4-5.8a.7.7 0 0 1 1.1.6z"/>' + P('M5.5 5.5v13'),
  shuffle: P('M4 7h3.5c4.5 0 5.5 10 10 10H20M4 17h3.5c1.7 0 2.8-1.4 3.7-3M14.3 10c.9-1.6 2-3 3.7-3H20') + P('m17.5 4.5 2.5 2.5-2.5 2.5M17.5 14.5l2.5 2.5-2.5 2.5'),
  repeat: P('M5 11V9a2 2 0 0 1 2-2h12m-3-3 3 3-3 3M19 13v2a2 2 0 0 1-2 2H5m3 3-3-3 3-3'),
  repeat1: P('M5 11V9a2 2 0 0 1 2-2h12m-3-3 3 3-3 3M19 13v2a2 2 0 0 1-2 2H5m3 3-3-3 3-3') + P('M11.5 10.5 12.5 10v4.5'),
  heart: P('M12 19.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10z'),
  heartFill: '<path class="fill" d="M12 19.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10z"/>',
  more: '<circle class="fill" cx="5.5" cy="12" r="1.5"/><circle class="fill" cx="12" cy="12" r="1.5"/><circle class="fill" cx="18.5" cy="12" r="1.5"/>',
  down: P('m6 9.5 6 6 6-6'),
  back: P('m14.5 6-6 6 6 6'),
  right: P('m9.5 6 6 6-6 6'),
  plus: P('M12 5v14M5 12h14'),
  send: P('M20 4 3.5 10.6l6.6 2.8L20 4zm0 0-9.9 9.4 2.8 6.6z'),
  listPlus: P('M4 7h11M4 12h11M4 17h7M17 14v6M14 17h6'),
  next2: P('M4 7h12M4 12h12M4 17h8') + '<path class="fill" d="M16 14.5v5l4-2.5z"/>',
  trash: P('M5 7h14M10 7V5h4v2M7 7l.8 12a1 1 0 0 0 1 1h6.4a1 1 0 0 0 1-1L17 7'),
  edit: P('M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'),
  clock: '<circle cx="12" cy="12" r="8"/>' + P('M12 8v4.5l3 1.5'),
  vinyl: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><circle class="fill" cx="12" cy="12" r=".9"/>',
  close: P('M6 6l12 12M18 6 6 18'),
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  // adopt out of the template's inert document, otherwise el.animate() binds to a timeline that never runs
  return document.adoptNode(tpl.content.firstElementChild);
}

export function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function haptic(kind = 'light') {
  try {
    if (kind === 'success' || kind === 'error') tg?.HapticFeedback?.notificationOccurred(kind);
    else if (kind === 'select') tg?.HapticFeedback?.selectionChanged();
    else tg?.HapticFeedback?.impactOccurred(kind);
  } catch {}
}

export function cover(url, cls = '') {
  return url
    ? `<img class="cover ${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<div class="cover cover--empty ${cls}">${icon('vinyl')}</div>`;
}

// ---------- toast ----------

let toastTimer;
export function toast(text) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('<div id="toast" class="toast" role="status"></div>');
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2200);
}

// ---------- bottom sheet ----------

export function sheet({ title = '', items = [], content = null }) {
  return new Promise((resolve) => {
    const root = h(`<div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet__scrim"></div>
      <div class="sheet__panel">
        <div class="sheet__grip"></div>
        ${title ? `<div class="sheet__title">${title}</div>` : ''}
        <div class="sheet__body"></div>
        <button class="sheet__cancel">${esc(t('cancel'))}</button>
      </div>
    </div>`);
    const body = root.querySelector('.sheet__body');
    if (content) body.append(content);
    items.forEach((it, i) => {
      const btn = h(`<button class="sheet__item ${it.danger ? 'is-danger' : ''}">${icon(it.icon)}<span>${esc(it.label)}</span></button>`);
      btn.addEventListener('click', () => close(i));
      body.append(btn);
    });
    function close(value) {
      root.classList.remove('is-open');
      setTimeout(() => root.remove(), 260);
      resolve(value ?? null);
    }
    root.querySelector('.sheet__scrim').addEventListener('click', () => close(null));
    root.querySelector('.sheet__cancel').addEventListener('click', () => close(null));
    root.close = close;
    document.body.append(root);
    requestAnimationFrame(() => root.classList.add('is-open'));
  });
}

export function promptName({ title, value = '', action }) {
  return new Promise((resolve) => {
    const root = h(`<div class="dialog" role="dialog" aria-modal="true">
      <form class="dialog__panel">
        <div class="dialog__title">${esc(title)}</div>
        <input class="field" maxlength="64" value="${esc(value)}" placeholder="${esc(t('playlist_name'))}" required>
        <div class="dialog__actions">
          <button type="button" class="btn btn--ghost" data-cancel>${esc(t('cancel'))}</button>
          <button type="submit" class="btn btn--accent">${esc(action)}</button>
        </div>
      </form>
    </div>`);
    const input = root.querySelector('input');
    const done = (v) => { root.remove(); resolve(v); };
    root.querySelector('[data-cancel]').addEventListener('click', () => done(null));
    root.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (v) done(v);
    });
    document.body.append(root);
    setTimeout(() => input.focus(), 50);
  });
}

export function confirmDialog(text) {
  return new Promise((resolve) => {
    if (tg?.showConfirm && tg.isVersionAtLeast?.('6.2')) tg.showConfirm(text, resolve);
    else resolve(window.confirm(text));
  });
}

// ---------- track list ----------

export function trackRow(track, { index = null } = {}) {
  const row = h(`<div class="track" data-id="${esc(track.id)}" role="button" tabindex="0">
    ${index !== null ? `<span class="track__num">${index + 1}</span>` : ''}
    <div class="track__art">${cover(track.cover)}<span class="eq"><i></i><i></i><i></i></span></div>
    <div class="track__meta">
      <div class="track__title">${esc(track.title)}</div>
      <div class="track__artist">${esc(track.artist)}</div>
    </div>
    <span class="track__time">${fmt(track.duration)}</span>
    <button class="icon-btn track__more" aria-label="more">${icon('more')}</button>
  </div>`);
  return row;
}

/** Render a playable list; clicking a row plays the list starting at it. */
export function trackList(tracks, { numbered = false, context = null, onChange = null } = {}) {
  const list = h('<div class="tracks"></div>');
  tracks.forEach((tr, i) => list.append(trackRow(tr, { index: numbered ? i : null })));
  list.addEventListener('click', async (e) => {
    const row = e.target.closest('.track');
    if (!row) return;
    const i = [...list.children].indexOf(row);
    if (e.target.closest('.track__more')) {
      e.stopPropagation();
      const changed = await trackMenu(tracks[i], context);
      if (changed === 'removed') { tracks.splice(i, 1); row.remove(); onChange?.(); }
      return;
    }
    haptic('light');
    if (player.current?.id === tracks[i].id) player.toggle();
    else player.playQueue(tracks, i);
  });
  markPlaying(list);
  return list;
}

export function markPlaying(root = document) {
  const id = player.current?.id;
  root.querySelectorAll('.track').forEach((row) => {
    row.classList.toggle('is-current', row.dataset.id === id);
    row.classList.toggle('is-playing', row.dataset.id === id && player.playing);
  });
}

// ---------- track actions ----------

export async function chooseAndAddToPlaylist(track) {
  const { playlists } = await api.playlists();
  const items = [{ icon: 'plus', label: t('lib_new_playlist') },
    ...playlists.map((p) => ({ icon: 'library', label: p.name }))];
  const choice = await sheet({ title: esc(t('menu_add_playlist')), items });
  if (choice === null) return;
  let pl = playlists[choice - 1];
  if (choice === 0) {
    const name = await promptName({ title: t('lib_new_playlist'), action: t('create') });
    if (!name) return;
    const { id } = await api.createPlaylist(name);
    pl = { id, name };
  }
  await api.addToPlaylist(pl.id, track);
  haptic('success');
  toast(t('toast_added', { name: pl.name }));
}

export async function trackMenu(track, context = null) {
  const liked = likes.has(track.id);
  const actions = [
    { icon: liked ? 'heartFill' : 'heart', label: t(liked ? 'menu_unlike' : 'menu_like'), run: 'like' },
    { icon: 'listPlus', label: t('menu_add_playlist'), run: 'playlist' },
    { icon: 'next2', label: t('menu_play_next'), run: 'next' },
    { icon: 'send', label: t('menu_send'), run: 'send' },
  ];
  if (context?.playlistId) actions.push({ icon: 'trash', label: t('menu_remove'), run: 'remove', danger: true });
  const head = h(`<div class="sheet__track">${cover(track.cover)}<div><div class="track__title">${esc(track.title)}</div><div class="track__artist">${esc(track.artist)}</div></div></div>`);
  const i = await sheet({ content: head, items: actions });
  if (i === null) return null;
  try {
    switch (actions[i].run) {
      case 'like': {
        const now = await toggleLike(track);
        haptic('success');
        toast(t(now ? 'toast_liked' : 'toast_unliked'));
        document.dispatchEvent(new CustomEvent('likes-changed'));
        if (!now && context?.likes) return 'removed';
        break;
      }
      case 'playlist': await chooseAndAddToPlaylist(track); break;
      case 'next': player.playNext(track); toast(t('toast_next')); break;
      case 'send': await api.send(track); haptic('success'); toast(t('toast_sending')); break;
      case 'remove':
        await api.removeFromPlaylist(context.playlistId, track.id);
        toast(t('toast_removed'));
        return 'removed';
    }
  } catch {
    haptic('error');
    toast(t('toast_error'));
  }
  return null;
}
