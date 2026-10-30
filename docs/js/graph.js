import { t } from './i18n.js';
import { player } from './player.js';
import { settings, updateSettings } from './store.js';
import { toast } from './ui.js';

/** The one Web Audio graph: equalizer, then reverb. A media element can be routed only once, so both live here.
 *  The music goes through Web Audio only once the user has turned the EQ or the reverb on:
 *  on iPhone a routed <audio> can stop in the background, so nobody pays that price unasked.
 *  A media element cannot be un-routed, so turning them off flattens the bands and closes the reverb until the next launch. */

export const BANDS = [
  { f: 60, type: 'lowshelf', label: '60' },
  { f: 230, type: 'peaking', label: '230' },
  { f: 910, type: 'peaking', label: '910' },
  { f: 3600, type: 'peaking', label: '3.6k' },
  { f: 14000, type: 'highshelf', label: '14k' },
];

// seconds of tail, how fast it dies, and how much of the sound is the room (the rest stays dry)
const ROOMS = {
  room: { seconds: 1.3, decay: 2.6, wet: 0.3 },
  hall: { seconds: 3.4, decay: 2.1, wet: 0.5 },
};

let ctx = null, filters = null, dry = null, wet = null, conv = null, irKind = '';

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
    const eqOut = filters.reduce((prev, f) => prev.connect(f), src);
    dry = ctx.createGain();
    eqOut.connect(dry).connect(ctx.destination);
    // the room: a convolver, darkened by a low-pass so the tail sounds warm, not hissy
    conv = ctx.createConvolver();
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4800;
    wet = ctx.createGain();
    wet.gain.value = 0;
    eqOut.connect(conv).connect(tone).connect(wet).connect(ctx.destination);
  } catch {
    filters = null;
    return false;
  }
  // a running context with a routed element is what keeps the music audible; let it sleep on pause
  player.addEventListener('state', syncContext);
  syncContext();
  return true;
}

/** For diagnostics: whether the music is routed through the graph and the context is running. */
export const fxStatus = () => ({ routed: !!filters, state: ctx?.state || 'none', reverb: irKind, wet: wet?.gain.value ?? 0 });

function syncContext() {
  if (!ctx) return;
  if (player.playing) ctx.resume().catch(() => {});
  else ctx.suspend().catch(() => {});
}

/** Noise that fades away: the sound of an empty room. */
function impulse({ seconds, decay }) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

/** Make the graph match the settings (EQ bands and reverb). Safe to call at any time. */
export function applyFx() {
  if (!filters) return;
  const { on, gains } = settings.eq;
  filters.forEach((f, i) => f.gain.setTargetAtTime(on ? gains[i] : 0, ctx.currentTime, 0.04));
  const room = ROOMS[settings.reverb];
  if (room) {
    if (irKind !== settings.reverb) { conv.buffer = impulse(room); irKind = settings.reverb; }
    wet.gain.setTargetAtTime(room.wet, ctx.currentTime, 0.12);
    dry.gain.setTargetAtTime(1 - room.wet * 0.45, ctx.currentTime, 0.12);
  } else {
    wet.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
    dry.gain.setTargetAtTime(1, ctx.currentTime, 0.12);
    // a closed room costs nothing: drop the impulse once the tail has faded out
    setTimeout(() => { if (!ROOMS[settings.reverb] && conv) { conv.buffer = null; irKind = ''; } }, 700);
  }
}

/** Route the music through the graph (once), telling the user about the iPhone caveat the first time. */
export function enableFx() {
  if (!filters) {
    if (!connect()) { toast(t('toast_error')); return false; }
    if (!settings.fxNoted && !settings.eqNoted) { toast(t('fx_note')); updateSettings({ fxNoted: true }); }
  }
  ctx.resume().catch(() => {});
  return true;
}

/** On launch with the EQ or reverb left on: route on the first tap (iOS only starts audio inside a gesture). */
export function initFx() {
  if (settings.eq.on || settings.reverb !== 'off') {
    document.addEventListener('pointerdown', () => { if (connect()) applyFx(); }, { once: true, capture: true });
  }
}
