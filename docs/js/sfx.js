import { settings } from './store.js';

/** Sound effects through Web Audio, so they mix with the music instead of interrupting it.
 *  The context is created lazily (only with sounds on) and suspended whenever nothing is playing:
 *  a running AudioContext keeps iOS rendering silence for the whole session.
 *  Besides two recorded samples, the vinyl noises (crackle, scratch, rewind) are synthesised. */

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

const wanted = () => settings.sounds || settings.vinylNoise > 0;

/** Call from a user gesture: iOS only unlocks audio there, so a silent sample is played right away. */
export function initSfx() {
  if (!wanted() || !context()) return;
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  src.connect(ctx.destination);
  hold();
  src.onended = release;
  src.start();
}

/** Mark a sound as started: wakes the context and keeps it awake until release(). */
function hold(always = false) {
  if (!(always ? wanted() : settings.sounds) || !context()) return null;
  active += 1;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function release() {
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

// ---------- synthesised vinyl noises ----------

let noiseBuffer = null, crackleBuffer = null;

function noise() {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  return src;
}

function crackles() {
  if (!crackleBuffer) {
    // sparse dust pops of random size, each a few samples long: the sound of an old record
    crackleBuffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = crackleBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      if (Math.random() < 0.00045) {
        const amp = (Math.random() < 0.15 ? 0.9 : 0.35) * (Math.random() < 0.5 ? -1 : 1);
        for (let k = 0; k < 24 && i + k < d.length; k++) d[i + k] += amp * Math.exp(-k / 4) * (k % 2 ? -1 : 1);
      }
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = crackleBuffer;
  src.loop = true;
  return src;
}

/** Quiet surface noise of a spinning record (hiss, dust crackle, a rumble pulsing at 33⅓ rpm). Returns stop(). */
export function startSpinNoise(volume = 1, background = false) {
  if (!hold(background)) return () => {};
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(volume, t + (background ? 1.2 : 0.35));
  out.connect(ctx.destination);

  const hiss = noise();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 2400;
  const hissGain = ctx.createGain(); hissGain.gain.value = 0.018;
  hiss.connect(hp).connect(hissGain).connect(out);

  const dust = crackles();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.7;
  const dustGain = ctx.createGain(); dustGain.gain.value = 0.32;
  dust.connect(bp).connect(dustGain).connect(out);

  const rumble = noise();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 110;
  const rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0.16;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.555; // once per revolution
  const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.08;
  lfo.connect(lfoDepth).connect(rumbleGain.gain);
  rumble.connect(lp).connect(rumbleGain).connect(out);

  const sources = [hiss, dust, rumble, lfo];
  sources.forEach((s) => s.start(t, Math.random()));
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0, now + 0.4);
    sources.forEach((s) => s.stop(now + 0.45));
    lfo.onended = release;
  };
}

// ---------- record noise under the music (Settings) ----------

const NOISE_LEVELS = [0, 0.45, 0.8, 1.3];
let bgNoise = null; // { level, stop }

/** Keep the background crackle in step with playback and the chosen level. */
export function syncVinylNoise(playing) {
  const level = playing ? NOISE_LEVELS[settings.vinylNoise] || 0 : 0;
  if (bgNoise && bgNoise.level === level) return;
  bgNoise?.stop();
  bgNoise = level ? { level, stop: startSpinNoise(level, true) } : null;
}

// the first tap of a session unlocks audio for the background noise even if the player is never opened
document.addEventListener('pointerdown', () => { if (settings.vinylNoise > 0) initSfx(); }, { once: true, capture: true });

/** A hand on the record: noise whose pitch and loudness follow the speed of the finger. */
export function startScratch() {
  if (!hold()) return null;
  const t = ctx.currentTime;
  const src = noise();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 3.5; bp.frequency.value = 400;
  const body = ctx.createOscillator(); // the "voice" of the dragged groove
  body.type = 'sawtooth'; body.frequency.value = 60;
  const bodyLp = ctx.createBiquadFilter();
  bodyLp.type = 'lowpass'; bodyLp.frequency.value = 900;
  const bodyGain = ctx.createGain(); bodyGain.gain.value = 0;
  const gain = ctx.createGain(); gain.gain.value = 0;
  src.connect(bp).connect(gain).connect(ctx.destination);
  body.connect(bodyLp).connect(bodyGain).connect(ctx.destination);
  src.start(t);
  body.start(t);
  let done = false;
  return {
    /** speed in revolutions per second, negative when turned backwards */
    update(speed) {
      if (done) return;
      const now = ctx.currentTime, v = Math.min(Math.abs(speed), 3);
      const dir = speed < 0 ? 0.75 : 1; // backwards sounds lower, like a real rewind
      bp.frequency.setTargetAtTime((350 + v * 1400) * dir, now, 0.025);
      gain.gain.setTargetAtTime(Math.min(v * 0.35, 0.55), now, 0.02);
      body.frequency.setTargetAtTime((50 + v * 220) * dir, now, 0.025);
      bodyGain.gain.setTargetAtTime(Math.min(v * 0.05, 0.08), now, 0.02);
    },
    stop() {
      if (done) return;
      done = true;
      const now = ctx.currentTime;
      gain.gain.setTargetAtTime(0, now, 0.03);
      bodyGain.gain.setTargetAtTime(0, now, 0.03);
      src.stop(now + 0.2);
      body.stop(now + 0.2);
      body.onended = release;
    },
  };
}

/** Short rewind whoosh for a jump made with the progress bar. */
export function whoosh(forward = true) {
  if (!hold()) return;
  const t = ctx.currentTime;
  const src = noise();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 2.2;
  bp.frequency.setValueAtTime(forward ? 500 : 2600, t);
  bp.frequency.exponentialRampToValueAtTime(forward ? 2600 : 450, t + 0.32);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.3, t + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
  src.connect(bp).connect(gain).connect(ctx.destination);
  src.onended = release;
  src.start(t);
  src.stop(t + 0.4);
}
