import { api } from './api.js';
import { applyFx, initFx } from './graph.js';
import { player } from './player.js';
import { onSettings, sharedSettings, updateSettings } from './store.js';

/** One look and one queue for one account, on whatever device it is opened.
 *  Settings: sent a moment after every change; taken from the server on open and whenever the app comes back to
 *  the front. Queue: the queue, the track, the place in it, shuffle and repeat are kept on the server; another device
 *  opens with the same queue, paused, and plays on from the same moment. Playing on two devices at once is not asked
 *  of anyone: a device that is playing is never taken over, it simply writes the latest state.
 *  The server stamps every write with its own time (`updated`); devices only ever compare those stamps. */

const META = 'musique.sync';
const SETTINGS_DELAY = 800;
const QUEUE_DELAY = 1500;
const HEARTBEAT_MS = 20000; // the place in the track, while playing
const PULL_EVERY_MS = 4000; // at most this often when the app comes back to the front

let meta = { uid: null, settingsRev: 0, settingsDirty: false, queueRev: 0 };
let restoring = false, pulling = null, lastPull = 0, started = false;
let settingsTimer = 0, queueTimer = 0, lastSettings = '', lastQueueShape = '', queueDirty = false;

function loadMeta() {
  try { return { ...meta, ...JSON.parse(localStorage.getItem(META)) }; } catch { return meta; }
}
function saveMeta() {
  try { localStorage.setItem(META, JSON.stringify(meta)); } catch {}
}

// ---------- settings ----------

async function pushSettings() {
  clearTimeout(settingsTimer);
  const value = sharedSettings();
  const json = JSON.stringify(value);
  if (json === lastSettings && !meta.settingsDirty) return;
  try {
    const { updated } = await api.putSettings(value);
    lastSettings = json;
    meta.settingsRev = updated;
    meta.settingsDirty = false;
    saveMeta();
  } catch { /* no network now: it stays "dirty" and goes out when the app next talks to the server */ }
}

function applyRemoteSettings(value) {
  lastSettings = JSON.stringify(value);
  updateSettings(value, { remote: true });
  initFx(); // an equalizer switched on elsewhere is routed on the first tap here
  applyFx();
}

async function syncSettings(server) {
  if (!server) { await pushSettings(); return; } // the account has no look stored yet: this device's becomes it
  if (server.updated > meta.settingsRev) {
    if (meta.settingsDirty) { await pushSettings(); return; } // an edit made here and not yet sent is the newer
    applyRemoteSettings(server.value);
    meta.settingsRev = server.updated;
    saveMeta();
  } else if (meta.settingsDirty) {
    await pushSettings();
  } else {
    lastSettings = JSON.stringify(sharedSettings()); // the same as the account's
  }
}

// ---------- queue ----------

/** The part of the queue worth keeping: at most 500 tracks, the place in it moved to match. */
function snapshot() {
  const { queue, index } = player;
  if (!queue.length) return null;
  const from = Math.max(0, Math.min(index - 50, queue.length - 500));
  const tracks = queue.slice(from, from + 500).map((t) => ({
    id: t.id, title: t.title, artist: t.artist, duration: t.duration || 0, cover: t.cover || '', artist_id: t.artist_id || '',
  }));
  return { tracks, index: index - from, time: Math.round(player.time * player.rate * 10) / 10, shuffle: player.shuffle, repeat: player.repeat };
}

const shapeOf = (q) => `${q.tracks.map((t) => t.id).join(',')}|${q.shuffle}|${q.repeat}`;

async function pushQueue({ keepalive = false } = {}) {
  clearTimeout(queueTimer);
  queueTimer = 0;
  if (restoring) return;
  const q = snapshot();
  if (!q) return;
  try {
    // the same queue as last time: only where we are in it (small); otherwise the queue itself
    if (!queueDirty && shapeOf(q) === lastQueueShape) {
      try {
        const { updated } = await api.patchQueue({ id: q.tracks[q.index].id, index: q.index, time: q.time }, keepalive);
        meta.queueRev = updated;
        saveMeta();
        return;
      } catch (e) {
        if (e.message !== 'http-409') throw e; // 409: the server holds another queue: send ours whole
      }
    }
    const { updated } = await api.putQueue(q, keepalive);
    lastQueueShape = shapeOf(q);
    queueDirty = false;
    meta.queueRev = updated;
    saveMeta();
  } catch { /* offline: the next change or heartbeat tries again */ }
}

function scheduleQueue(structural) {
  if (restoring || !player.queue.length) return;
  if (structural) queueDirty = true;
  clearTimeout(queueTimer);
  queueTimer = setTimeout(pushQueue, QUEUE_DELAY);
}

function syncQueue(server) {
  if (!server || server.updated <= meta.queueRev) return;
  // another device wrote later: take it over unless this one is playing right now
  if (player.playing || player.loading) return;
  restoring = true;
  try {
    player.restore(server.value);
    lastQueueShape = shapeOf(server.value);
    queueDirty = false;
    meta.queueRev = server.updated;
    saveMeta();
  } finally {
    setTimeout(() => { restoring = false; }, 0);
  }
}

// ---------- pulling ----------

/** Ask the server what the account looks like now, and take what is newer. */
export function pull() {
  pulling ||= (async () => {
    try {
      const state = await api.state();
      lastPull = Date.now();
      await syncSettings(state.settings);
      syncQueue(state.queue);
    } catch { /* offline or the server is restarting: this device keeps its own */ } finally {
      pulling = null;
    }
  })();
  return pulling;
}

/** Call once the user is known. Resolves when the first pull is done. */
export function initSync() {
  if (started || !api.user) return Promise.resolve();
  started = true;
  meta = loadMeta();
  if (meta.uid !== api.user.id) meta = { uid: api.user.id, settingsRev: 0, settingsDirty: false, queueRev: 0 }; // another account on this device
  saveMeta();

  onSettings((_, info) => {
    if (info?.remote || JSON.stringify(sharedSettings()) === lastSettings) return; // a device-only change is not the account's
    meta.settingsDirty = true;
    saveMeta();
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(pushSettings, SETTINGS_DELAY);
  });

  // the queue changed (structural), or the track changed within it, or shuffle / repeat: write soon
  for (const ev of ['queue', 'modes']) player.addEventListener(ev, () => scheduleQueue(true));
  player.addEventListener('track', () => scheduleQueue(false));
  let wasPlaying = false;
  player.addEventListener('state', () => { // paused: the place in the track is worth keeping
    if (wasPlaying && !player.playing && !restoring) scheduleQueue(false);
    wasPlaying = player.playing;
  });
  setInterval(() => { if (player.playing && !restoring) pushQueue(); }, HEARTBEAT_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { // the app is leaving the front: write what is pending, at once
      if (settingsTimer) pushSettings();
      if (queueTimer || player.playing) pushQueue({ keepalive: true });
    } else if (Date.now() - lastPull > PULL_EVERY_MS) {
      pull(); // back at the front: see whether another device moved on
    }
  });
  addEventListener('online', () => pull());

  return pull();
}
