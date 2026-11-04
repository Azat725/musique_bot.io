import { phonoMode, radioMode, settings, tapeMode } from './store.js';

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

// the phonograph's crackle is part of its sound, not an effect: it plays even with the sounds switched off
const wanted = () => settings.sounds || settings.vinylNoise > 0 || phonoMode();

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

/** A soft band-limited aerial hiss, generated locally; returns an idempotent stop function. */
function startRadioNoise(volume = 1, background = false) {
  if (!hold(background)) return () => {};
  const now = ctx.currentTime, src = noise(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
  filter.type = 'bandpass'; filter.frequency.value = 1800; filter.Q.value = 0.45;
  gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(volume * 0.025, now + 0.5);
  src.connect(filter).connect(gain).connect(ctx.destination); src.start();
  let stopped = false;
  return () => { if (stopped) return; stopped = true; const at = ctx.currentTime;
    gain.gain.cancelScheduledValues(at); gain.gain.setValueAtTime(gain.gain.value, at); gain.gain.linearRampToValueAtTime(0, at + 0.3);
    src.onended = release; src.stop(at + 0.32);
  };
}

// ---------- record noise under the music (Settings) ----------

// indices are what Settings store; 4 ("whisper", 35 % of low) came later, so it is appended rather than inserted
const NOISE_LEVELS = [0, 0.45, 0.8, 1.3, 0.16];
let bgNoise = null; // { level, stop }

/** Keep the noise under the music in step with playback and the chosen level: a record's crackle, a tape's hiss
 *  (cassette and reels), nothing from a CD, and always the wax crackle of the phonograph, whatever the setting. */
export function syncVinylNoise(playing) {
  const kind = phonoMode() ? 'phono' : radioMode() ? 'radio' : tapeMode() ? 'tape' : settings.playerMode === 'cd' ? 'none' : 'vinyl';
  const level = !playing || kind === 'none' ? 0 : kind === 'phono' ? 1 : NOISE_LEVELS[settings.vinylNoise] || 0;
  if (bgNoise && bgNoise.level === level && bgNoise.kind === kind) return;
  bgNoise?.stop();
  const start = { phono: startPhonoNoise, radio: startRadioNoise, tape: startTapeNoise, vinyl: startSpinNoise }[kind];
  bgNoise = level ? { level, kind, stop: start(level, true) } : null;
}

// the first tap of a session unlocks audio for the background noise even if the player is never opened
document.addEventListener('pointerdown', () => { if (settings.vinylNoise > 0 || phonoMode()) initSfx(); }, { once: true, capture: true });

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

// ---------- small synthesised parts for the other players ----------

/** A burst of filtered noise: the body of most mechanical sounds. */
function burst(t, { freq, q = 1, dur, gain, type = 'bandpass' }) {
  const src = noise();
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t, Math.random());
  src.stop(t + dur + 0.02);
  return src;
}

/** A short tone that dies away. */
function tone(t, { freq, dur, gain, type = 'sine', to = null }) {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0008, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
  return o;
}

/** One sound made of parts started now; the context is held until the last part ends. */
function play(parts, total) {
  if (!hold()) return;
  const t = ctx.currentTime;
  parts(t);
  setTimeout(release, total * 1000 + 60);
}

// reel-to-reel: the metal toggle, and the motor
export function clack() {
  play((t) => { burst(t, { freq: 2600, q: 1.4, dur: 0.05, gain: 0.5 }); tone(t, { freq: 140, dur: 0.07, gain: 0.25, type: 'triangle' }); }, 0.1);
}

/** The capstan motor spinning up: a low hum rising to speed, and the click of the pinch roller. */
export function motorStart() {
  play((t) => {
    tone(t, { freq: 30, to: 100, dur: 0.9, gain: 0.12, type: 'sawtooth' });
    burst(t, { freq: 400, q: 0.8, dur: 0.9, gain: 0.08 });
    burst(t + 0.85, { freq: 3000, q: 1.6, dur: 0.04, gain: 0.35 });
  }, 1);
}

export function motorStop() {
  play((t) => {
    burst(t, { freq: 2600, q: 1.4, dur: 0.04, gain: 0.35 });
    tone(t, { freq: 100, to: 28, dur: 0.7, gain: 0.1, type: 'sawtooth' });
  }, 0.75);
}

// portable CD player: the button beep, the lid, the disc spinning up, and the digital whirr of seeking
export function beep(freq = 2400) {
  play((t) => tone(t, { freq, dur: 0.07, gain: 0.08, type: 'square' }), 0.1);
}

export function lidClick() {
  play((t) => { burst(t, { freq: 3500, q: 2, dur: 0.035, gain: 0.45 }); burst(t + 0.09, { freq: 1800, q: 1.2, dur: 0.05, gain: 0.3 }); }, 0.2);
}

export function spinUp() {
  play((t) => {
    tone(t, { freq: 180, to: 1900, dur: 0.75, gain: 0.035, type: 'sine' });
    burst(t, { freq: 900, q: 3, dur: 0.75, gain: 0.04 });
    burst(t + 0.05, { freq: 5000, q: 4, dur: 0.02, gain: 0.12 }); // the laser sled ticking
    burst(t + 0.2, { freq: 5000, q: 4, dur: 0.02, gain: 0.1 });
  }, 0.8);
}

/** Holding a CD player's search key: a quick ticking, faster with speed. Same interface as startScratch(). */
export function startCdSeek() {
  if (!hold()) return null;
  let speed = 0, done = false, timer = 0;
  const tick = () => {
    if (done) return;
    if (speed > 0.05) burst(ctx.currentTime, { freq: 4200, q: 5, dur: 0.018, gain: 0.08 });
    timer = setTimeout(tick, speed > 0.05 ? Math.max(45, 160 - speed * 60) : 120);
  };
  tick();
  return {
    update(v) { speed = Math.min(Math.abs(v), 2); },
    stop() { if (done) return; done = true; clearTimeout(timer); release(); },
  };
}

// the phonograph: the crank being wound, the stylus put down and lifted, and the noise of wax
export function crank() {
  play((t) => {
    for (let i = 0; i < 9; i++) burst(t + i * 0.065, { freq: 1500 + (i % 2) * 400, q: 3, dur: 0.03, gain: 0.22 });
    tone(t, { freq: 70, to: 110, dur: 0.6, gain: 0.06, type: 'triangle' });
  }, 0.7);
}

export function needleDrop() {
  play((t) => { tone(t, { freq: 90, dur: 0.12, gain: 0.3, type: 'triangle' }); burst(t, { freq: 1200, q: 0.7, dur: 0.25, gain: 0.25 }); }, 0.3);
}

export function needleLift() {
  play((t) => burst(t, { freq: 1800, q: 1, dur: 0.12, gain: 0.2 }), 0.15);
}

/** The surface of a wax cylinder: heavy hiss in a narrow band, dense crackle, the rumble of the mandrel and the
 *  governor's whirr. Returns stop(). Always under the phonograph's music (syncVinylNoise). */
export function startPhonoNoise(volume = 1, background = false) {
  if (!hold(background)) return () => {};
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(volume, t + (background ? 1 : 0.3));
  out.connect(ctx.destination);
  const hiss = noise();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.9;
  const hissGain = ctx.createGain(); hissGain.gain.value = 0.05;
  hiss.connect(bp).connect(hissGain).connect(out);
  const dust = crackles();
  dust.playbackRate.value = 1.8; // twice the crackle of a record
  const dbp = ctx.createBiquadFilter();
  dbp.type = 'bandpass'; dbp.frequency.value = 1600; dbp.Q.value = 0.6;
  const dustGain = ctx.createGain(); dustGain.gain.value = 0.5;
  dust.connect(dbp).connect(dustGain).connect(out);
  const whirr = ctx.createOscillator(); // the governor balls spinning
  whirr.type = 'triangle'; whirr.frequency.value = 118;
  const wg = ctx.createGain(); wg.gain.value = 0.012;
  const wob = ctx.createOscillator(); wob.frequency.value = 2.7;
  const wobDepth = ctx.createGain(); wobDepth.gain.value = 0.008;
  wob.connect(wobDepth).connect(wg.gain);
  whirr.connect(wg).connect(out);
  const sources = [hiss, dust, whirr, wob];
  sources.forEach((src) => src.start(t, src === hiss || src === dust ? Math.random() : 0));
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0, now + 0.4);
    sources.forEach((src) => src.stop(now + 0.45));
    whirr.onended = release;
  };
}

// ---------- the radio: tuning between stations, and a car's rain and road ----------

/** Turning the dial: a sweep of static and whistles between two stations (about `secs` long). */
export function tuneStatic(secs = 0.7) {
  play((t) => {
    const src = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(3800, t + secs * 0.5); f.frequency.exponentialRampToValueAtTime(900, t + secs);
    g.gain.setValueAtTime(0.0008, t); g.gain.linearRampToValueAtTime(0.16, t + 0.05); g.gain.setValueAtTime(0.16, t + secs * 0.8); g.gain.exponentialRampToValueAtTime(0.0008, t + secs);
    src.connect(f).connect(g).connect(ctx.destination); src.start(t, Math.random()); src.stop(t + secs + 0.05);
    tone(t + secs * 0.2, { freq: 1900, to: 700, dur: secs * 0.4, gain: 0.04 }); // a heterodyne whistle
  }, secs + 0.1);
}

/** A car's surroundings under the music: rain on the roof and glass, the wipers, the engine and the tyres, now and
 *  then a car going past. `rain`, `road`: which ones. Synthesised; returns a stop function that fades them out. */
export function startCarAmbience({ rain = false, road = false } = {}) {
  if ((!rain && !road) || !hold()) return () => {};
  const now = ctx.currentTime, out = ctx.createGain(), nodes = [], timers = [];
  out.gain.setValueAtTime(0, now); out.gain.linearRampToValueAtTime(1, now + 1.2);
  out.connect(ctx.destination);
  const loop = (filterType, freq, q, gain) => {
    const src = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q; g.gain.value = gain;
    src.connect(f).connect(g).connect(out); src.start(now, Math.random() * 1.5);
    nodes.push(src);
    return g;
  };
  if (rain) {
    loop('highpass', 900, 0.4, 0.05); // the patter on the roof
    loop('bandpass', 4200, 0.6, 0.03); // the hiss on the glass
    const drop = () => { // single heavier drops on the windshield
      const t = ctx.currentTime;
      const src = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'bandpass'; f.frequency.value = 1400 + Math.random() * 2600; f.Q.value = 3;
      g.gain.setValueAtTime(0.06 + Math.random() * 0.05, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
      src.connect(f).connect(g).connect(out); src.start(t, Math.random()); src.stop(t + 0.07);
      timers.push(setTimeout(drop, 40 + Math.random() * 180));
    };
    drop();
    const wipe = () => { // the wiper's soft thump and rubber squeak at each turn
      const t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.2);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.22);
      const s = noise(), f = ctx.createBiquadFilter(), sg = ctx.createGain();
      f.type = 'bandpass'; f.frequency.setValueAtTime(1800, t + 0.3); f.frequency.linearRampToValueAtTime(2600, t + 0.9); f.Q.value = 8;
      sg.gain.setValueAtTime(0.0008, t + 0.3); sg.gain.linearRampToValueAtTime(0.018, t + 0.6); sg.gain.exponentialRampToValueAtTime(0.0008, t + 1.1);
      s.connect(f).connect(sg).connect(out); s.start(t + 0.3, Math.random()); s.stop(t + 1.15);
      timers.push(setTimeout(wipe, 3000));
    };
    timers.push(setTimeout(wipe, 900));
  }
  if (road) {
    loop('lowpass', 420, 0.7, road && rain ? 0.11 : 0.08); // the tyres (louder on a wet road)
    const engine = ctx.createOscillator(), e2 = ctx.createOscillator(), ef = ctx.createBiquadFilter(), eg = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    engine.type = 'sawtooth'; engine.frequency.value = 46; e2.type = 'triangle'; e2.frequency.value = 92.6;
    ef.type = 'lowpass'; ef.frequency.value = 240; eg.gain.value = 0.035;
    lfo.frequency.value = 0.13; lg.gain.value = 3; lfo.connect(lg).connect(engine.frequency); // the revs breathe a little
    engine.connect(ef); e2.connect(ef); ef.connect(eg).connect(out);
    [engine, e2, lfo].forEach((o) => { o.start(now); nodes.push(o); });
    const pass = () => { // a car going the other way: a swell of air and tyres, falling in pitch as it goes by
      const t = ctx.currentTime, d = 2.4;
      const src = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(380, t + d);
      g.gain.setValueAtTime(0.0008, t); g.gain.linearRampToValueAtTime(0.09, t + d * 0.45); g.gain.exponentialRampToValueAtTime(0.0008, t + d);
      src.connect(f).connect(g).connect(out); src.start(t, Math.random()); src.stop(t + d + 0.05);
      timers.push(setTimeout(pass, 9000 + Math.random() * 16000));
    };
    timers.push(setTimeout(pass, 4000 + Math.random() * 6000));
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    timers.forEach(clearTimeout);
    const at = ctx.currentTime;
    out.gain.cancelScheduledValues(at); out.gain.setValueAtTime(out.gain.value, at); out.gain.linearRampToValueAtTime(0, at + 0.8);
    nodes.forEach((n) => { try { n.stop(at + 0.85); } catch {} });
    setTimeout(release, 900);
  };
}

/** The driving game's sounds: the engine follows the revs, the tyres the speed; a thud for the kerb, a horn. Returns null
 *  (silence) with the sounds switched off. `update({ rpm, red, speed, throttle })` is called every frame. */
export function startDriveAudio() {
  if (!hold()) return null;
  const now = ctx.currentTime, out = ctx.createGain(), nodes = [];
  out.gain.setValueAtTime(0, now); out.gain.linearRampToValueAtTime(0.9, now + 0.6);
  out.connect(ctx.destination);
  const saw = ctx.createOscillator(), tri = ctx.createOscillator(), lp = ctx.createBiquadFilter(), eg = ctx.createGain();
  saw.type = 'sawtooth'; tri.type = 'triangle'; lp.type = 'lowpass'; lp.frequency.value = 260; eg.gain.value = 0.04;
  saw.connect(lp); tri.connect(lp); lp.connect(eg).connect(out);
  const road = noise(), rf = ctx.createBiquadFilter(), rg = ctx.createGain();
  rf.type = 'lowpass'; rf.frequency.value = 520; rg.gain.value = 0;
  road.connect(rf).connect(rg).connect(out);
  [saw, tri].forEach((o) => { o.start(now); nodes.push(o); });
  road.start(now, Math.random()); nodes.push(road);
  let horn = null, stopped = false;
  return {
    update({ rpm, red, speed, throttle }) {
      if (stopped) return;
      const t = ctx.currentTime, k = Math.min(1.2, rpm / red);
      saw.frequency.setTargetAtTime(24 + 78 * k, t, 0.05); tri.frequency.setTargetAtTime(48 + 156 * k, t, 0.05);
      lp.frequency.setTargetAtTime(180 + 900 * k, t, 0.08); eg.gain.setTargetAtTime(0.03 + 0.05 * throttle + 0.02 * k, t, 0.08);
      rg.gain.setTargetAtTime(Math.min(0.14, speed / 30 * 0.14), t, 0.1); rf.frequency.setTargetAtTime(400 + speed * 22, t, 0.1);
    },
    bump(strength) { // the kerb: a short low thud
      const t = ctx.currentTime, s = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'lowpass'; f.frequency.value = 260; g.gain.setValueAtTime(0.28 * Math.min(1, strength / 6), t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.22);
      s.connect(f).connect(g).connect(out); s.start(t, Math.random()); s.stop(t + 0.25);
    },
    horn(on) {
      const t = ctx.currentTime;
      if (on && !horn) {
        const g = ctx.createGain(), a = ctx.createOscillator(), b = ctx.createOscillator();
        a.type = b.type = 'sawtooth'; a.frequency.value = 410; b.frequency.value = 515;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.03);
        a.connect(g); b.connect(g); g.connect(out); a.start(t); b.start(t);
        horn = { g, a, b };
      } else if (!on && horn) {
        const h = horn; horn = null;
        h.g.gain.cancelScheduledValues(t); h.g.gain.setValueAtTime(h.g.gain.value, t); h.g.gain.linearRampToValueAtTime(0, t + 0.06);
        h.a.stop(t + 0.1); h.b.stop(t + 0.1);
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      this.horn(false);
      const at = ctx.currentTime;
      out.gain.cancelScheduledValues(at); out.gain.setValueAtTime(out.gain.value, at); out.gain.linearRampToValueAtTime(0, at + 0.5);
      nodes.forEach((n) => { try { n.stop(at + 0.55); } catch {} });
      setTimeout(release, 650);
    },
  };
}
