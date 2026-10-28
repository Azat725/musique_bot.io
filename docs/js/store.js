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
  ...load(),
};

export function updateSettings(patch) {
  Object.assign(settings, patch);
  const json = JSON.stringify(settings);
  try { localStorage.setItem(KEY, json); } catch {}
  try { tg?.CloudStorage?.setItem(KEY, json); } catch {}
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

export async function loadLikes() {
  const { tracks } = await api.likes();
  likes.clear();
  tracks.forEach((t) => likes.add(t.id));
}

export async function toggleLike(track) {
  if (likes.has(track.id)) {
    likes.delete(track.id);
    await api.unlike(track.id);
    return false;
  }
  likes.add(track.id);
  await api.like(track);
  return true;
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
