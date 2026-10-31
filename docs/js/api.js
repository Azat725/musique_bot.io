const tg = window.Telegram?.WebApp;
const API_KEY = 'musique.api';

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
  return '';
}

const base = resolveBase();
let streamToken = '';

async function request(method, path, body, signal, timeout = 0) {
  if (!base) throw new Error('no-server');
  const ctrl = new AbortController(); // never hang on a blocked or sleeping server (AbortSignal.timeout is missing in older WebViews)
  const timer = setTimeout(() => ctrl.abort(), timeout || (path === '/api/me' ? 15000 : 45000));
  signal?.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(base + path, {
      signal: ctrl.signal,
      method,
      headers: {
        'X-Init-Data': tg?.initData || '',
        'ngrok-skip-browser-warning': '1', // ngrok's free tier otherwise answers browsers with an interstitial page
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
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
  async me() {
    const data = await get('/api/me');
    streamToken = data.token;
    return data.user;
  },
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
