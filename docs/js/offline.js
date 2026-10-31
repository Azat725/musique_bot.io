import { api } from './api.js';
import { likedList, likes, onSettings, settings } from './store.js';

/** Favourites without a network: with the setting on, every liked track is downloaded (a compact copy, about
 *  3 MB) into IndexedDB while the app is open, and played from there, so the metro and the lift keep the music.
 *  Unliked tracks are deleted. Telegram itself needs a network to open the app: this keeps it playing after. */

const DB = 'musique-offline';
const STORE = 'tracks';
const COVER_PX = 144;
export const MAX_SAVED = 100; // the newest liked tracks kept on the phone (about 300 MB); older likes stream as before

export const offline = new EventTarget(); // 'change' whenever the saved set or the download progress changes
const saved = new Map(); // id -> bytes
let db = null, ready = null, syncing = false, again = false, current = null, abort = null, stopped = '';
const urls = new Map(); // id -> object URL of the audio (a few are kept, the oldest are revoked)
const coverUrls = new Map(); // id -> object URL of the small cover

const emit = () => offline.dispatchEvent(new Event('change'));

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

function tx(mode = 'readonly') { return db.transaction(STORE, mode).objectStore(STORE); }

/** Opens the store and learns what is already saved. Safe to call many times. */
export function initOffline() {
  ready ||= (async () => {
    if (!window.indexedDB) return;
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'id' });
    db = await req(open);
    // the sizes only, not the audio: a cursor over keys and a small "size" field
    await new Promise((resolve, reject) => {
      const cur = tx().openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) { resolve(); return; }
        saved.set(c.value.id, c.value.size || 0);
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
    emit();
  })().catch(() => { db = null; });
  return ready;
}

export const isSaved = (id) => saved.has(id);
export const savingId = () => current;
export const stopReason = () => stopped; // '' | 'space' | 'network'

export function usage() {
  let bytes = 0;
  saved.forEach((b) => { bytes += b; });
  return { count: saved.size, bytes };
}

/** How many of the favourites are saved: { done, total, capped } (total never above MAX_SAVED). */
export function progress() {
  let done = 0;
  likes.forEach((id) => { if (saved.has(id)) done++; });
  return { done: Math.min(done, MAX_SAVED), total: Math.min(likes.size, MAX_SAVED), capped: likes.size > MAX_SAVED };
}

/** A playable URL for a saved track, or null. */
export async function audioUrl(id) {
  if (!saved.has(id) || !db) return null;
  if (urls.has(id)) return urls.get(id);
  const row = await req(tx().get(id));
  if (!row?.blob) return null;
  const url = URL.createObjectURL(row.blob);
  urls.set(id, url);
  while (urls.size > 3) { // the current and the next couple stay; older ones are let go
    const [old, oldUrl] = urls.entries().next().value;
    URL.revokeObjectURL(oldUrl);
    urls.delete(old);
  }
  return url;
}

/** The saved small cover of a track (for when the network cannot bring the real one), or null. */
export async function coverUrl(id) {
  if (!saved.has(id) || !db) return null;
  if (coverUrls.has(id)) return coverUrls.get(id);
  const row = await req(tx().get(id));
  if (!row?.cover) return null;
  const url = URL.createObjectURL(row.cover);
  coverUrls.set(id, url);
  return url;
}

async function remove(id) {
  await req(tx('readwrite').delete(id));
  saved.delete(id);
  if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  if (coverUrls.has(id)) { URL.revokeObjectURL(coverUrls.get(id)); coverUrls.delete(id); }
}

export async function clearAll() {
  abort?.abort();
  await initOffline();
  if (!db) return;
  await req(tx('readwrite').clear());
  saved.clear();
  urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear();
  coverUrls.forEach((u) => URL.revokeObjectURL(u)); coverUrls.clear();
  emit();
}

function smallCover(url) {
  if (!url) return '';
  if (url.includes('i.ytimg.com')) return url.replace(/\/(hq720|maxresdefault|sddefault|hqdefault)\.jpg/, '/mqdefault.jpg');
  return url.replace(/=w\d+-h\d+/, `=w${COVER_PX}-h${COVER_PX}`);
}

async function download(track) {
  abort = new AbortController();
  const res = await fetch(`${api.streamUrl(track.id)}&q=save`, { signal: abort.signal, headers: { 'ngrok-skip-browser-warning': '1' } });
  if (!res.ok) throw Object.assign(new Error(`http-${res.status}`), { skip: res.status === 404 });
  const blob = await res.blob();
  let cover = null;
  if (track.cover) {
    try { // a cover is nice to have: some hosts refuse to be fetched from a page, and that is fine
      const c = await fetch(smallCover(track.cover), { signal: abort.signal, mode: 'cors' });
      if (c.ok && c.headers.get('content-type')?.startsWith('image/')) cover = await c.blob();
    } catch {}
  }
  const meta = { title: track.title, artist: track.artist, duration: track.duration, artist_id: track.artist_id || '', cover: track.cover || '' };
  await req(tx('readwrite').put({ id: track.id, blob, cover, meta, size: blob.size + (cover?.size || 0), savedAt: Date.now() }));
  saved.set(track.id, blob.size + (cover?.size || 0));
}

/** Make the saved set match the newest MAX_SAVED favourites: delete what was unliked (or pushed past the limit
 *  by newer likes), download what is missing, one at a time. */
export async function syncOffline() {
  if (!settings.offlineLikes) return;
  if (syncing) { again = true; return; } // the favourites changed meanwhile: look once more when this round ends
  syncing = true;
  again = false;
  stopped = '';
  try {
    await initOffline();
    if (!db) return;
    let list;
    try { list = (await likedList()).slice(0, MAX_SAVED); } catch { return; } // newest first
    const wanted = new Set(list.map((tr) => tr.id));
    for (const id of [...saved.keys()]) if (!wanted.has(id)) await remove(id);
    emit();
    for (const track of list) {
      if (!settings.offlineLikes) break;
      if (saved.has(track.id)) continue;
      if (!navigator.onLine) { stopped = 'network'; break; }
      current = track.id;
      emit();
      try {
        await download(track);
      } catch (e) {
        if (e?.name === 'QuotaExceededError' || /quota/i.test(e?.message || '')) { stopped = 'space'; break; }
        if (e?.name === 'AbortError') break;
        if (e?.skip) continue; // this one is not available anywhere: the others still are
        stopped = 'network'; // the network went away mid-download: carry on when it is back
        break;
      } finally {
        current = null;
      }
      emit();
    }
  } finally {
    current = null;
    syncing = false;
    abort = null;
    emit();
    if (again && settings.offlineLikes && !stopped) soon(300);
  }
}

let syncTimer = 0;
const soon = (ms = 800) => { clearTimeout(syncTimer); syncTimer = setTimeout(syncOffline, ms); };

/** Ask the browser not to clear the downloads when the phone runs low on space. */
export function keepDownloads() {
  try { navigator.storage?.persist?.(); } catch {}
}

// when to look again: a like or an unlike, the network coming back, the setting switched on
document.addEventListener('likes-changed', () => soon());
addEventListener('online', () => soon(1500));
let wasOn = settings.offlineLikes;
onSettings(() => {
  if (settings.offlineLikes === wasOn) return;
  wasOn = settings.offlineLikes;
  if (wasOn) { keepDownloads(); soon(0); } else abort?.abort();
});
