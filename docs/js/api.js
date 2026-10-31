const tg = window.Telegram?.WebApp;
const API_KEY = 'musique.api';
const SESSION_KEY = 'musique.session';
// the server, when the site is opened from GitHub Pages without ?api= (on its own domain the site asks its own address)
const DEFAULT_API = 'https://109-66-243-195.sslip.io';

/** Inside Telegram every request carries its signature; in an ordinary browser a session (guest or account) does. */
export const inTelegram = !!tg?.initData;
let session = '';
try { session = localStorage.getItem(SESSION_KEY) || ''; } catch {}

function keepSession(value) {
  session = value || '';
  try { if (session) localStorage.setItem(SESSION_KEY, session); else localStorage.removeItem(SESSION_KEY); } catch {}
}

/** A usable server address from a possibly over-encoded value ("https%3A%2F%2F…"), or '' if there is none. */
export function cleanBase(value) {
  let v = String(value || '').trim();
  for (let i = 0; i < 3 && !/^https?:\/\//i.test(v) && v.includes('%'); i++) {
    try { v = decodeURIComponent(v); } catch { break; }
  }
  try {
    const u = new URL(v);
    return /^https?:$/.test(u.protocol) ? v.replace(/\/$/, '') : '';
  } catch { return ''; }
}

function resolveBase() {
  const fromQuery = cleanBase(new URLSearchParams(location.search).get('api'));
  if (fromQuery) {
    try { localStorage.setItem(API_KEY, fromQuery); } catch {}
    return fromQuery;
  }
  try {
    const saved = cleanBase(localStorage.getItem(API_KEY));
    if (saved) return saved;
  } catch {}
  if (/^(localhost|127\.)/.test(location.hostname) || location.protocol === 'file:') return 'http://localhost:8000';
  if (location.hostname.endsWith('github.io')) return DEFAULT_API;
  return location.origin; // the site on its own domain: Caddy serves the API at the same address
}

const base = resolveBase();
let streamToken = '';

let guestStart = null;

/** In an ordinary browser every request needs a session. A first visit has none: one guest is made, and whatever
 *  asks meanwhile (the home screen is asked for at the very start) waits for that one instead of going out bare. */
function ensureSession() {
  if (inTelegram || session) return Promise.resolve();
  guestStart ||= request('POST', '/api/guest').then((r) => keepSession(r.session)).finally(() => { guestStart = null; });
  return guestStart;
}

async function request(method, path, body, signal, timeout = 0, keepalive = false, retried = false) {
  if (!base) throw new Error('no-server');
  if (path !== '/api/guest') await ensureSession();
  const ctrl = new AbortController(); // never hang on a blocked or sleeping server (AbortSignal.timeout is missing in older WebViews)
  const timer = setTimeout(() => ctrl.abort(), timeout || (path === '/api/me' ? 15000 : 45000));
  signal?.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(base + path, {
      signal: ctrl.signal,
      keepalive, // a last small write while the page is going away
      method,
      headers: {
        ...(inTelegram ? { 'X-Init-Data': tg.initData } : session ? { Authorization: `Bearer ${session}` } : {}),
        'ngrok-skip-browser-warning': '1', // ngrok's free tier otherwise answers browsers with an interstitial page
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !inTelegram && !retried && path !== '/api/guest') {
      // the server does not know this session (a new database, an old browser profile): start over as a new guest
      keepSession('');
      await ensureSession();
      return request(method, path, body, signal, timeout, keepalive, true);
    }
    if (!res.ok) {
      const err = new Error(`http-${res.status}`);
      err.code = await res.json().then((j) => j.detail, () => ''); // a reason the app can explain, e.g. an import that failed
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b);
const del = (p) => request('DELETE', p);

let homeRequest = null;
const lyricsCache = new Map(); // track id -> Promise of the /api/lyrics answer

// <audio> can't send the header that skips ngrok's interstitial page, so there the audio is fetched explicitly
const usesBlob = (() => {
  try { return /\.ngrok[\w-]*\.(dev|app|io)$/.test(new URL(base || 'http://x').hostname); } catch { return false; }
})();

export const api = {
  hasServer: () => !!base,
  usesBlob,
  async audioBlob(id, fx = 'normal-off') {
    const res = await fetch(api.streamUrl(id, fx), {
      headers: { 'ngrok-skip-browser-warning': '1' },
    });
    if (!res.ok) throw new Error(`http-${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  /** Who is listening. Outside Telegram a browser without a session (or with one the server no longer knows)
   *  becomes a guest first. */
  async me() {
    const data = await get('/api/me'); // makes the guest first when there is no session, and mends a stale one
    streamToken = data.token;
    api.user = data.user;
    return data.user;
  },
  /** The account's look and queue: { settings: {value, updated} | null, queue: {value, updated} | null } (server time). */
  state: () => get('/api/state'),
  putSettings: (value) => request('PUT', '/api/state/settings', { value }),
  putQueue: (queue, keepalive = false) => request('PUT', '/api/state/queue', queue, null, 0, keepalive),
  /** Just the place in the queue and in the track; rejects with http-409 when the server holds another queue. */
  patchQueue: (pos, keepalive = false) => request('PATCH', '/api/state/queue', pos, null, 0, keepalive),
  user: null, // { id, first_name, username, language_code, kind: 'telegram' | 'guest' }
  isGuest: () => api.user?.kind === 'guest',
  /** Sign in with Telegram from the site: { code, url } — the url opens the bot, which asks to confirm. */
  loginStart: () => post('/api/login/start'),
  /** { status: 'wait' | 'expired' | 'ok', session?, user? }; on ok the new session is kept at once. */
  async loginPoll(code) {
    const r = await get('/api/login/' + encodeURIComponent(code));
    if (r.status === 'ok') keepSession(r.session);
    return r;
  },
  /** Back to being a guest in this browser (a new, empty guest library). */
  logout() { keepSession(''); },
  /** fx: "<speed>-<reverb>"; anything but plain is a file the server renders (slowed, 45 rpm, reverb). */
  streamUrl: (id, fx = 'normal-off') => `${base}/api/stream/${id}?t=${encodeURIComponent(streamToken)}${fx === 'normal-off' ? '' : `&fx=${fx}`}`,
  /** Start /api/home during boot; the first home() call takes the request already in flight. */
  preloadHome() { homeRequest = get('/api/home'); homeRequest.catch(() => {}); },
  home() { const r = homeRequest || get('/api/home'); homeRequest = null; return r; },
  recommend: () => get('/api/recommend'),
  suggest: (q, signal) => request('GET', `/api/suggest?q=${encodeURIComponent(q)}`, null, signal),
  search: (q, signal, type = 'all') => request('GET', `/api/search?type=${type}&q=${encodeURIComponent(q)}`, null, signal),
  collection: (id) => get('/api/collection/' + encodeURIComponent(id)),
  artist: (id) => get('/api/artist/' + encodeURIComponent(id)),
  findArtist: (name) => get('/api/artist?name=' + encodeURIComponent(name)),
  favArtists: () => get('/api/artists'),
  addFavArtist: (artist) => post('/api/artists', { artist }),
  removeFavArtist: (id) => del('/api/artists/' + encodeURIComponent(id)),
  album: (id) => get('/api/album/' + encodeURIComponent(id)),
  likes: () => get('/api/likes'),
  like: (track) => post('/api/likes', { track }),
  unlike: (id) => del('/api/likes/' + id),
  playlists: () => get('/api/playlists'),
  playlist: (id) => get('/api/playlists/' + id),
  createPlaylist: (name) => post('/api/playlists', { name }),
  /** A playlist from another app or a pasted list: each track is looked up, which takes a while. */
  importPlaylist: (source) => request('POST', '/api/import', { source }, null, 180000),
  renamePlaylist: (id, name) => request('PATCH', '/api/playlists/' + id, { name }),
  deletePlaylist: (id) => del('/api/playlists/' + id),
  addToPlaylist: (id, track) => post(`/api/playlists/${id}/tracks`, { track }),
  removeFromPlaylist: (id, trackId) => del(`/api/playlists/${id}/tracks/${trackId}`),
  history: () => get('/api/history'),
  heardIds: () => get('/api/history/ids'),
  addHistory: (track) => post('/api/history', { track }),
  clearHistory: () => del('/api/history'),
  send: (track) => post('/api/send', { track }),
  /** ahead: how many places ahead in the queue (1 = the very next; 2 and 3 are prepared in the background). */
  prefetch: (track, fx = 'normal-off', ahead = 1) => post('/api/prefetch', { track, fx, ahead }),
  /** Why a track just failed: { reason: 'region' | 'removed' | 'age' | 'youtube' | 'notfound' | '' }. */
  why: (id) => request('GET', '/api/why/' + encodeURIComponent(id), null, null, 4000),
  /** { lyrics: string | null, source }; asked once per track per session. A failed request is forgotten, so it is retried. */
  lyrics(track) {
    if (!lyricsCache.has(track.id)) {
      const q = new URLSearchParams({ title: track.title || '', artist: track.artist || '', duration: String(track.duration || 0) });
      const p = get(`/api/lyrics/${encodeURIComponent(track.id)}?${q}`);
      p.catch(() => lyricsCache.delete(track.id));
      lyricsCache.set(track.id, p);
    }
    return lyricsCache.get(track.id);
  },
};
