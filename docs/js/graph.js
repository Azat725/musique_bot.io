import { t } from './i18n.js';
import { player } from './player.js';
import { settings, updateSettings } from './store.js';
import { toast } from './ui.js';

/** The Web Audio graph of the equalizer. A media element can be routed only once, so it lives here.
 *  The music goes through Web Audio only once the user has turned the EQ on: on iPhone a routed <audio>
 *  can fall silent in the background, so nobody pays that price unasked (slowed and reverb are rendered by
 *  the server and need no graph). A media element cannot be un-routed: turning the EQ off flattens the bands. */

export const BANDS = [
  { f: 60, type: 'lowshelf', label: '60' },
  { f: 230, type: 'peaking', label: '230' },
  { f: 910, type: 'peaking', label: '910' },
  { f: 3600, type: 'peaking', label: '3.6k' },
  { f: 14000, type: 'highshelf', label: '14k' },
];

// a context put to sleep between two tracks cannot be woken up while the app is in the background,
// and the next track would play into silence: it sleeps only after a long pause
const SLEEP_AFTER_MS = 30000;

let ctx = null, filters = null, sleepTimer = 0;

function connect() {
  if (filters) return true;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;
  try {
    ctx = new Ctx();
    const src = ctx.createMediaElementSource(player.audio);
    filters = BANDS.map((b) => {
      const f = ctx.createBiquadFilter();
      f.type = b.type;
      f.frequency.value = b.f;
      if (b.type === 'peaking') f.Q.value = 1.1;
      return f;
    });
    filters.reduce((prev, f) => prev.connect(f), src).connect(ctx.destination);
  } catch {
    filters = null;
    return false;
  }
  player.addEventListener('state', syncContext);
  // the element says it is about to play before any sound comes out: wake the context right there
  player.audio.addEventListener('play', wakeContext);
  player.audio.addEventListener('playing', wakeContext);
  document.addEventListener('visibilitychange', () => { if (player.playing) wakeContext(); });
  syncContext();
  return true;
}

/** For diagnostics: whether the music is routed through the filters and the context is running. */
export const fxStatus = () => ({ routed: !!filters, state: ctx?.state || 'none' });

function wakeContext() {
  clearTimeout(sleepTimer);
  sleepTimer = 0;
  // iOS reports 'interrupted' after a call or a lock: resume() is the way back from that too
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
}

function syncContext() {
  if (!ctx) return;
  if (player.playing || player.loading) { wakeContext(); return; }
  if (!sleepTimer) sleepTimer = setTimeout(() => { sleepTimer = 0; if (!player.playing) ctx.suspend().catch(() => {}); }, SLEEP_AFTER_MS);
}

/** Make the filters match the settings. Safe to call at any time. */
export function applyFx() {
  if (!filters) return;
  const { on, gains } = settings.eq;
  filters.forEach((f, i) => f.gain.setTargetAtTime(on ? gains[i] : 0, ctx.currentTime, 0.04));
}

/** Route the music through the filters (once), telling the user about the iPhone caveat the first time. */
export function enableFx() {
  if (!filters) {
    if (!connect()) { toast(t('toast_error')); return false; }
    if (!settings.fxNoted && !settings.eqNoted) { toast(t('fx_note')); updateSettings({ fxNoted: true }); }
  }
  wakeContext();
  return true;
}

/** On launch with the EQ left on: route on the first tap (iOS only starts audio inside a gesture). */
export function initFx() {
  if (settings.eq.on) document.addEventListener('pointerdown', () => { if (connect()) applyFx(); }, { once: true, capture: true });
}
