import { api } from './api.js';

const tg = window.Telegram?.WebApp;
const KEY = 'musique.settings';
const listeners = new Set();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

const tgLang = tg?.initDataUnsafe?.user?.language_code || navigator.language || 'en';

// themes that were renamed or removed: whoever had them is moved to the new name (or to the classic look)
const RENAMED_THEMES = { oldmoney: 'richesse', sky: 'classic' };
function migrate() {
  const next = RENAMED_THEMES[settings.colorTheme];
  if (next) settings.colorTheme = next;
  // the 33 / 45 switch grew into a speed with a slowed setting
  if (settings.rpm45 && settings.speed === 'normal') settings.speed = 'fast';
  delete settings.rpm45;
}

export const settings = {
  theme: 'system',
  lang: /^(ru|uk|be|kk)/i.test(tgLang) ? 'ru' : 'en',
  sounds: true,
  eq: { on: false, preset: 'flat', gains: [0, 0, 0, 0, 0] },
  vinylNoise: 0, // background record noise while music plays: 0 off, 1-3 louder
  plSort: 'new',
  searchMode: 'all',
  name: '', // optional name for the home greeting
  colorTheme: 'classic', // themes.js; 'classic' follows `theme` (auto / light / dark)
  playerMode: 'record', // 'record' alone or 'turntable'
  recordColor: 'black',
  deckColor: 'walnut', // the turntable's colourway, see css/tokens.css
  idleDelay: 20, // seconds before the player's interface fades away; 0 never
  hapticSeek: true, // a tick under the finger while seeking
  sleeve: true, // a track heard for the first time comes out of its sleeve
  speed: 'normal', // 'slow' 0.85×, 'normal' 33⅓ rpm, 'fast' 45 rpm 1.35×: the record spins and plays at that pace, pitch following
  reverb: 'off', // 'room' | 'hall'; with a slowed record this is the slowed + reverb sound
  offlineLikes: false, // favourites are downloaded to the phone and play without a network (offline.js)
  ...load(),
};
migrate();

// what belongs to this device alone and stays out of the account's look: downloads live on one phone, and the
// "just so you know" notes are shown once per device
const DEVICE_ONLY = new Set(['offlineLikes', 'fxNoted', 'eqNoted']);

/** The settings that follow the account to every device. */
export function sharedSettings() {
  return Object.fromEntries(Object.entries(settings).filter(([k, v]) => !DEVICE_ONLY.has(k) && v !== undefined));
}

/** `remote`: the change came from the account (another device), so it is not to be sent back. */
export function updateSettings(patch, { remote = false } = {}) {
  if (remote) { // only what a device may take over, and only known keys
    patch = Object.fromEntries(Object.entries(patch).filter(([k]) => !DEVICE_ONLY.has(k) && k in settings));
  }
  Object.assign(settings, patch);
  if (remote) migrate();
  const json = JSON.stringify(settings);
  try { localStorage.setItem(KEY, json); } catch {}
  try { if (tg?.isVersionAtLeast?.('6.9')) tg.CloudStorage.setItem(KEY, json); } catch {}
  listeners.forEach((fn) => fn(settings, { remote }));
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
        migrate();
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
const LIKES_KEY = 'musique.likes'; // the last list seen, so Favourites opens (and plays) without a network

function keepLikes() {
  try { localStorage.setItem(LIKES_KEY, JSON.stringify(likedTracks)); } catch {}
}

function useLikes(tracks) {
  likedTracks = tracks;
  likes.clear();
  tracks.forEach((t) => likes.add(t.id));
}

/** Liked tracks, downloaded once per session and then kept in step with toggleLike().
 *  Without a network the list last seen is used, and the server is asked again next time. */
export function loadLikes() {
  likesLoaded ||= api.likes().then(({ tracks }) => { useLikes(tracks); keepLikes(); }, (err) => {
    likesLoaded = null;
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(LIKES_KEY)); } catch {}
    if (!Array.isArray(kept)) throw err;
    useLikes(kept);
  });
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
    keepLikes();
    await api.unlike(track.id);
    return false;
  }
  likes.add(track.id);
  likedTracks = [track, ...likedTracks];
  keepLikes();
  await api.like(track);
  return true;
}

// ---------- tracks already heard (the sleeve is only for a first listen) ----------

export const heard = new Set();
export let heardReady = false; // until the list arrives nobody is sure what is new: no sleeve then

export async function loadHeard() {
  const { ids } = await api.heardIds();
  heard.clear();
  ids.forEach((id) => heard.add(id));
  heardReady = true;
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
