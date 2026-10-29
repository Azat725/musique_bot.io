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

async function request(method, path, body, signal) {
  if (!base) throw new Error('no-server');
  const ctrl = new AbortController(); // never hang on a blocked or sleeping server (AbortSignal.timeout is missing in older WebViews)
  const timer = setTimeout(() => ctrl.abort(), path === '/api/me' ? 15000 : 45000);
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
    if (!res.ok) throw new Error(`http-${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b);
const del = (p) => request('DELETE', p);

let homeRequest = null;

// <audio> can't send the header that skips ngrok's interstitial page, so there the audio is fetched explicitly
const usesBlob = (() => {
  try { return /\.ngrok[\w-]*\.(dev|app|io)$/.test(new URL(base || 'http://x').hostname); } catch { return false; }
})();

export const api = {
  hasServer: () => !!base,
  usesBlob,
  async audioBlob(id) {
    const res = await fetch(`${base}/api/stream/${id}?t=${encodeURIComponent(streamToken)}`, {
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
  streamUrl: (id) => `${base}/api/stream/${id}?t=${encodeURIComponent(streamToken)}`,
  /** Start /api/home during boot; the first home() call takes the request already in flight. */
  preloadHome() { homeRequest = get('/api/home'); homeRequest.catch(() => {}); },
  home() { const r = homeRequest || get('/api/home'); homeRequest = null; return r; },
  recommend: () => get('/api/recommend'),
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
  renamePlaylist: (id, name) => request('PATCH', '/api/playlists/' + id, { name }),
  deletePlaylist: (id) => del('/api/playlists/' + id),
  addToPlaylist: (id, track) => post(`/api/playlists/${id}/tracks`, { track }),
  removeFromPlaylist: (id, trackId) => del(`/api/playlists/${id}/tracks/${trackId}`),
  history: () => get('/api/history'),
  addHistory: (track) => post('/api/history', { track }),
  clearHistory: () => del('/api/history'),
  send: (track) => post('/api/send', { track }),
  prefetch: (track) => post('/api/prefetch', { track }),
};
