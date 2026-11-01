import { settings, tapeMode } from './store.js';

/** Sound effects through Web Audio, so they mix with the music instead of interrupting it.
 *  The context is created lazily (only with sounds on) and suspended whenever nothing is playing:
 *  a running AudioContext keeps iOS rendering silence for the whole session.
 *  Recorded samples: the needle and the swipe of a record, and the keys and cassette of a tape deck (CC0 recordings by
 *  Joseph Sardin, bigsoundbank.com: assets/sfx/CREDITS.md). The noises (crackle, scratch, tape hiss, rewinding) are synthesised. */

let ctx = null;
const buffers = {};
let active = 0;

function context() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  for (const name of ['swipe', 'needle', 'tape-play', 'tape-pause', 'tape-stop', 'tape-eject', 'tape-insert']) {
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

// indices are what Settings store; 4 ("whisper", 35 % of low) came later, so it is appended rather than inserted
const NOISE_LEVELS = [0, 0.45, 0.8, 1.3, 0.16];
let bgNoise = null; // { level, stop }

/** Keep the background crackle (or the tape hiss, in the cassette view) in step with playback and the chosen level. */
export function syncVinylNoise(playing) {
  const level = playing ? NOISE_LEVELS[settings.vinylNoise] || 0 : 0;
  const tape = tapeMode();
  if (bgNoise && bgNoise.level === level && bgNoise.tape === tape) return;
  bgNoise?.stop();
  bgNoise = level ? { level, tape, stop: tape ? startTapeNoise(level, true) : startSpinNoise(level, true) } : null;
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

/** Paper sliding on cardboard: a record drawn out of its sleeve. */
export function rustle() {
  if (!hold()) return;
  const t = ctx.currentTime;
  const src = noise();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(1800, t);
  bp.frequency.linearRampToValueAtTime(3200, t + 0.5);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 700;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.16, t + 0.08);
  gain.gain.setValueAtTime(0.16, t + 0.35);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
  src.connect(bp).connect(hp).connect(gain).connect(ctx.destination);
  src.onended = release;
  src.start(t, Math.random());
  src.stop(t + 0.65);
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

// ---------- the tape deck ----------

/** Quiet noise of a running cassette: hiss, the wow and flutter of the capstan, a faint mains hum. Returns stop(). */
export function startTapeNoise(volume = 1, background = false) {
  if (!hold(background)) return () => {};
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(volume, t + (background ? 1.2 : 0.35));
  out.connect(ctx.destination);

  const hiss = noise();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 1800;
  const air = ctx.createBiquadFilter(); // tape hiss sits high, a soft hump around 6 kHz
  air.type = 'peaking'; air.frequency.value = 6000; air.Q.value = 0.6; air.gain.value = 5;
  const hissGain = ctx.createGain(); hissGain.gain.value = 0.026;
  // wow (slow) and flutter (fast) breathe in the hiss as the tape speed wavers
  const wow = ctx.createOscillator(); wow.frequency.value = 0.55;
  const wowDepth = ctx.createGain(); wowDepth.gain.value = 0.004;
  const flutter = ctx.createOscillator(); flutter.frequency.value = 6.3;
  const flutterDepth = ctx.createGain(); flutterDepth.gain.value = 0.002;
  wow.connect(wowDepth).connect(hissGain.gain);
  flutter.connect(flutterDepth).connect(hissGain.gain);
  hiss.connect(hp).connect(air).connect(hissGain).connect(out);

  const hum = ctx.createOscillator(); // 50 Hz mains, barely there
  hum.frequency.value = 50;
  const humGain = ctx.createGain(); humGain.gain.value = 0.006;
  hum.connect(humGain).connect(out);

  const sources = [hiss, wow, flutter, hum];
  sources.forEach((s) => s.start(t, s === hiss ? Math.random() : 0));
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0, now + 0.4);
    sources.forEach((s) => s.stop(now + 0.45));
    hum.onended = release;
  };
}

/** The motor and the tape racing past the heads, for winding: a whine and a rush of noise whose pitch follows `speed`. */
function whirr() {
  const t = ctx.currentTime;
  const motor = ctx.createOscillator();
  motor.type = 'sawtooth'; motor.frequency.value = 90;
  const motorLp = ctx.createBiquadFilter();
  motorLp.type = 'lowpass'; motorLp.frequency.value = 1400;
  const motorGain = ctx.createGain(); motorGain.gain.value = 0;
  const wobble = ctx.createOscillator(); wobble.frequency.value = 9; // the reels never turn quite evenly
  const wobbleDepth = ctx.createGain(); wobbleDepth.gain.value = 6;
  wobble.connect(wobbleDepth).connect(motor.frequency);
  motor.connect(motorLp).connect(motorGain).connect(ctx.destination);
  const rush = noise();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 1.6; bp.frequency.value = 900;
  const rushGain = ctx.createGain(); rushGain.gain.value = 0;
  rush.connect(bp).connect(rushGain).connect(ctx.destination);
  [motor, wobble, rush].forEach((s) => s.start(t));
  return {
    set(speed, now, tc) { // speed 0..1: the share of full winding speed
      motor.frequency.setTargetAtTime(90 + speed * 520, now, tc);
      motorGain.gain.setTargetAtTime(speed * 0.07, now, tc);
      bp.frequency.setTargetAtTime(700 + speed * 2600, now, tc);
      rushGain.gain.setTargetAtTime(speed * 0.22, now, tc);
    },
    stop(at) { [motor, wobble, rush].forEach((s) => s.stop(at)); motor.onended = release; },
  };
}

/** Winding the tape by hand: the "вжжж" follows the finger. Same interface as startScratch(). */
export function startTapeWhirr() {
  if (!hold()) return null;
  const w = whirr();
  let done = false;
  return {
    /** speed in reel turns per second, negative when wound back */
    update(speed) {
      if (done) return;
      w.set(Math.min(Math.abs(speed) / 2.5, 1), ctx.currentTime, 0.04);
    },
    stop() {
      if (done) return;
      done = true;
      const now = ctx.currentTime;
      w.set(0, now, 0.05);
      w.stop(now + 0.3);
    },
  };
}

/** A short fast-forward or rewind for a jump made with the progress bar: the motor spins up, races and stops. */
export function tapeWind(forward = true) {
  if (!hold()) return;
  const w = whirr();
  const t = ctx.currentTime;
  w.set(forward ? 0.85 : 0.7, t, 0.06);
  w.set(0, t + 0.45, 0.07);
  w.stop(t + 0.8);
  setTimeout(() => playSfx('tape-stop', 0.45), 520);
}


/** A key of the tape deck clicks: 'play', 'pause', 'stop' (only in the cassette view). */
export function tapeKey(name) {
  if (tapeMode()) playSfx('tape-' + name, 0.6);
}
