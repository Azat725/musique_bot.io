import { settings } from './store.js';

/** Sound effects through Web Audio, so they mix with the music instead of interrupting it.
 *  The context is created lazily (only with sounds on) and suspended whenever nothing is playing:
 *  a running AudioContext keeps iOS rendering silence for the whole session. */

let ctx = null;
const buffers = {};
let active = 0;

function context() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  for (const name of ['swipe', 'needle']) {
    fetch(`assets/sfx/${name}.mp3`).then((r) => r.arrayBuffer()).then((d) => ctx.decodeAudioData(d))
      .then((b) => { buffers[name] = b; }).catch(() => {});
  }
  return ctx;
}

/** Call from a user gesture (iOS only unlocks audio there). */
export function initSfx() {
  if (settings.sounds) context();
}

/** Mark a sound as started: wakes the context and keeps it awake until release(). */
export function hold() {
  if (!settings.sounds || !context()) return null;
  active += 1;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function release() {
  active = Math.max(0, active - 1);
  if (!active && ctx?.state === 'running') ctx.suspend().catch(() => {});
}

export function playSfx(name, volume = 0.55) {
  if (!buffers[name] || !hold()) return;
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.buffer = buffers[name];
  src.connect(gain).connect(ctx.destination);
  src.onended = release;
  src.start();
}
