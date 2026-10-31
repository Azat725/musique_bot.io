import { api } from '../api.js';
import { t } from '../i18n.js';
import { player } from '../player.js';
import { favArtists, loadFavArtists, toggleFavArtist } from '../store.js';
import { cover, esc, h, haptic, icon, thumb, toast, trackList } from '../ui.js';

function sectionHead(title, onAll) {
  const head = h(`<div class="section__head"><h2 class="section__title">${esc(title)}</h2></div>`);
  if (onAll) {
    const btn = h(`<button class="link">${esc(t('see_all'))}${icon('right')}</button>`);
    btn.addEventListener('click', onAll);
    head.append(btn);
  }
  return head;
}

function releases(items, nav) {
  const row = h('<div class="cards"></div>');
  items.forEach((al) => {
    const card = h(`<button class="card">
      ${cover(al.cover, 'card__cover', 400)}
      <span class="card__title">${esc(al.title)}</span>
      <span class="card__artist">${esc(al.year)}</span>
    </button>`);
    card.addEventListener('click', () => nav.push('playlist', { kind: 'album', id: al.id, title: al.title }));
    row.append(card);
  });
  return row;
}

function relatedRow(items, nav) {
  const row = h('<div class="cards cards--artists"></div>');
  items.forEach((a) => {
    const card = h(`<button class="card card--artist">
      ${cover(a.cover, 'card__cover card__cover--round', 300)}
      <span class="card__title">${esc(a.name)}</span>
    </button>`);
    card.addEventListener('click', () => nav.push('artist', { id: a.id, name: a.name }));
    row.append(card);
  });
  return row;
}

async function load(params) {
  // ids from video results can be plain YouTube channels that YouTube Music has no page for: retry by name
  if (params.id) {
    try { return await api.artist(params.id); } catch {}
  }
  const { id } = await api.findArtist(params.name);
  params.id = id;
  return api.artist(id);
}

/** Artist card: photo, popular tracks, albums, singles, similar artists. */
export async function render(params, nav) {
  const a = await load(params);
  const listeners = a.listeners ? t('artist_listeners', { n: a.listeners }) : a.subscribers ? t('artist_subscribers', { n: a.subscribers }) : '';
  const root = h(`<div class="view artist">
    <header class="artist__head">
      ${a.cover ? `<img class="artist__photo" src="${esc(thumb(a.cover, 720))}" alt="" decoding="async" referrerpolicy="no-referrer">`
        : `<div class="artist__photo artist__photo--empty">${icon('mic')}</div>`}
      <div class="view__kicker">${esc(t('artist_kicker'))}</div>
      <h1 class="view__title">${esc(a.name || params.name)}</h1>
      <div class="view__sub">${esc(listeners)}</div>
      <div class="list-actions">
        <button class="btn btn--accent" data-play>${icon('play')}${esc(t('play'))}</button>
        <button class="btn btn--outline" data-shuffle>${icon('shuffle')}${esc(t('shuffle'))}</button>
        <button class="icon-btn artist__fav" data-fav aria-label="${esc(t('artist_fav'))}"></button>
      </div>
    </header>
    <div class="artist__body"></div>
  </div>`);
  const body = root.querySelector('.artist__body');
  const tracks = a.tracks || [];
  root.querySelector('.list-actions').classList.toggle('is-disabled', !tracks.length);
  // the microphone adds the artist to the favourite artists in the Library
  const fav = root.querySelector('[data-fav]');
  const me = { id: params.id || a.id, name: a.name || params.name, cover: a.cover || '' };
  const syncFav = () => {
    const on = favArtists.has(me.id);
    fav.innerHTML = icon(on ? 'micFill' : 'mic');
    fav.classList.toggle('is-on', on);
    fav.setAttribute('aria-pressed', on);
  };
  loadFavArtists().then(syncFav, syncFav);
  document.addEventListener('fav-artists-changed', syncFav);
  fav.addEventListener('click', async () => {
    haptic('light');
    try {
      const now = await toggleFavArtist(me);
      haptic('success');
      toast(t(now ? 'toast_artist_fav' : 'toast_artist_unfav'), now ? 'like' : 'unlike');
    } catch { toast(t('toast_error'), 'error'); }
    syncFav();
  });
  root.querySelector('[data-play]').addEventListener('click', () => { if (tracks.length) { haptic('medium'); player.playQueue(tracks, 0); } });
  root.querySelector('[data-shuffle]').addEventListener('click', () => { if (tracks.length) { haptic('medium'); player.playQueue(tracks, 0, { shuffle: true }); } });

  if (tracks.length) {
    const s = h('<section class="section"></section>');
    const all = a.songs_id ? () => nav.push('playlist', { kind: 'yt', id: a.songs_id, title: a.name }) : null;
    s.append(sectionHead(t('artist_popular'), all), trackList(tracks, { numbered: true }));
    body.append(s);
  }
  for (const [key, label] of [['albums', 'artist_albums'], ['singles', 'artist_singles']]) {
    if (!a[key]?.length) continue;
    const s = h('<section class="section"></section>');
    s.append(sectionHead(t(label)), releases(a[key], nav));
    body.append(s);
  }
  if (a.related?.length) {
    const s = h('<section class="section"></section>');
    s.append(sectionHead(t('artist_related')), relatedRow(a.related, nav));
    body.append(s);
  }
  if (a.description) {
    const s = h(`<section class="section"><h2 class="section__title">${esc(t('artist_about'))}</h2>
      <p class="artist__about">${esc(a.description)}</p><button class="link" hidden>${esc(t('more'))}</button></section>`);
    const p = s.querySelector('.artist__about'), more = s.querySelector('button');
    more.hidden = a.description.length < 260;
    more.addEventListener('click', () => { p.classList.add('is-open'); more.hidden = true; });
    body.append(s);
  }
  return root;
}
