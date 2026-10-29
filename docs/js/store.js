import { api } from './api.js';

const tg = window.Telegram?.WebApp;
const KEY = 'musique.settings';
const listeners = new Set();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

const tgLang = tg?.initDataUnsafe?.user?.language_code || navigator.language || 'en';

export const settings = {
  theme: 'system',
  lang: /^(ru|uk|be|kk)/i.test(tgLang) ? 'ru' : 'en',
  sounds: true,
  eq: { on: false, preset: 'flat', gains: [0, 0, 0, 0, 0] },
  vinylNoise: 0, // background record noise while music plays: 0 off, 1-3 louder
  plSort: 'new',
  searchMode: 'all',
  name: '', // optional name for the home greeting
  ...load(),
};

export function updateSettings(patch) {
  Object.assign(settings, patch);
  const json = JSON.stringify(settings);
  try { localStorage.setItem(KEY, json); } catch {}
  try { if (tg?.isVersionAtLeast?.('6.9')) tg.CloudStorage.setItem(KEY, json); } catch {}
  listeners.forEach((fn) => fn(settings));
}

export function onSettings(fn) {
  listeners.add(fn);
}

/** Pull settings saved on another device via Telegram CloudStorage. */
export function syncCloudSettings() {
  return new Promise((resolve) => {
    if (!tg?.CloudStorage || !tg.isVersionAtLeast?.('6.9')) return resolve(false);
    setTimeout(() => resolve(false), 1200); // never let a silent client block startup
    tg.CloudStorage.getItem(KEY, (err, value) => {
      if (err || !value) return resolve(false);
      try {
        Object.assign(settings, JSON.parse(value));
        try { localStorage.setItem(KEY, value); } catch {}
        resolve(true);
      } catch { resolve(false); }
    });
  });
}

// ---------- likes ----------

export const likes = new Set();
let likedTracks = [];
let likesLoaded = null;

/** Liked tracks, downloaded once per session and then kept in step with toggleLike(). */
export function loadLikes() {
  likesLoaded ||= api.likes().then(({ tracks }) => {
    likedTracks = tracks;
    likes.clear();
    tracks.forEach((t) => likes.add(t.id));
  });
  likesLoaded.catch(() => { likesLoaded = null; });
  return likesLoaded;
}

export async function likedList() {
  await loadLikes();
  return likedTracks.slice();
}

export async function toggleLike(track) {
  if (likes.has(track.id)) {
    likes.delete(track.id);
    likedTracks = likedTracks.filter((t) => t.id !== track.id);
    await api.unlike(track.id);
    return false;
  }
  likes.add(track.id);
  likedTracks = [track, ...likedTracks];
  await api.like(track);
  return true;
}

// ---------- favourite artists ----------

export const favArtists = new Set();
let favArtistList = [];
let favArtistsLoaded = null;

export function loadFavArtists() {
  favArtistsLoaded ||= api.favArtists().then(({ artists }) => {
    favArtistList = artists;
    favArtists.clear();
    artists.forEach((a) => favArtists.add(a.id));
  });
  favArtistsLoaded.catch(() => { favArtistsLoaded = null; });
  return favArtistsLoaded;
}

export async function favArtistsList() {
  await loadFavArtists();
  return favArtistList.slice();
}

/** Add or remove an artist ({id, name, cover}); returns whether it is now a favourite. */
export async function toggleFavArtist(artist) {
  const now = !favArtists.has(artist.id);
  if (now) {
    favArtists.add(artist.id);
    favArtistList = [artist, ...favArtistList.filter((a) => a.id !== artist.id)];
    await api.addFavArtist(artist);
  } else {
    favArtists.delete(artist.id);
    favArtistList = favArtistList.filter((a) => a.id !== artist.id);
    await api.removeFavArtist(artist.id);
  }
  document.dispatchEvent(new CustomEvent('fav-artists-changed'));
  return now;
}

// ---------- playlists ----------

let playlistsCache = null;

/** The user's playlists, fetched once and refetched only after a change. */
export function getPlaylists() {
  playlistsCache ||= api.playlists().then((r) => r.playlists);
  playlistsCache.catch(() => { playlistsCache = null; });
  return playlistsCache;
}

export function invalidatePlaylists() {
  playlistsCache = null;
  document.dispatchEvent(new CustomEvent('playlists-changed'));
}

// ---------- recent searches ----------

const RECENT = 'musique.recent';

export function recentSearches() {
  try { return JSON.parse(localStorage.getItem(RECENT)) || []; } catch { return []; }
}

export function pushRecentSearch(q) {
  const list = [q, ...recentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  try { localStorage.setItem(RECENT, JSON.stringify(list)); } catch {}
}

export function clearRecentSearches() {
  try { localStorage.removeItem(RECENT); } catch {}
}
