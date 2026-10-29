const tg = window.Telegram?.WebApp;
const API_KEY = 'musique.api';

function resolveBase() {
  const fromQuery = new URLSearchParams(location.search).get('api');
  if (fromQuery) {
    try { localStorage.setItem(API_KEY, fromQuery); } catch {}
    return fromQuery.replace(/\/$/, '');
  }
  try {
    const saved = localStorage.getItem(API_KEY);
    if (saved) return saved;
  } catch {}
  if (/^(localhost|127\.)/.test(location.hostname) || location.protocol === 'file:') return 'http://localhost:8000';
  return '';
}

const base = resolveBase();
let streamToken = '';

async function request(method, path, body) {
  if (!base) throw new Error('no-server');
  const ctrl = new AbortController(); // never hang on a blocked or sleeping server (AbortSignal.timeout is missing in older WebViews)
  const timer = setTimeout(() => ctrl.abort(), path === '/api/me' ? 15000 : 45000);
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

// <audio> can't send the header that skips ngrok's interstitial page, so there the audio is fetched explicitly
const usesBlob = /\.ngrok[\w-]*\.(dev|app|io)$/.test(new URL(base || 'http://x').hostname);

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
  home: () => get('/api/home'),
  search: (q) => get('/api/search?q=' + encodeURIComponent(q)),
  collection: (id) => get('/api/collection/' + encodeURIComponent(id)),
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
