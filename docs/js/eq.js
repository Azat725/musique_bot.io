import { t } from './i18n.js';
import { player } from './player.js';
import { settings, updateSettings } from './store.js';
import { esc, h, haptic, sheet, toast } from './ui.js';

/** Five-band equalizer. The music goes through Web Audio only once the user has turned the EQ on:
 *  on iPhone a routed <audio> can stop in the background, so nobody pays that price unasked.
 *  A media element cannot be un-routed, so turning it off flattens the bands until the next launch. */

export const BANDS = [
  { f: 60, type: 'lowshelf', label: '60' },
  { f: 230, type: 'peaking', label: '230' },
  { f: 910, type: 'peaking', label: '910' },
  { f: 3600, type: 'peaking', label: '3.6k' },
  { f: 14000, type: 'highshelf', label: '14k' },
];
const MAX_DB = 12;
export const PRESETS = {
  flat: [0, 0, 0, 0, 0],
  bass: [7, 4, 0, -1, 0],
  warm: [3, 2, 0, -2, -5], // like an old record: round lows, soft highs
  vocal: [-2, -1, 3, 4, 1],
  rock: [5, 2, -2, 2, 5],
  jazz: [3, 1, -1, 2, 3],
  electro: [6, 3, -1, 2, 5],
};

let ctx = null, filters = null;

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
  // a running context with a routed element is what keeps the music audible; let it sleep on pause
  player.addEventListener('state', syncContext);
  syncContext();
  return true;
}

/** For diagnostics: whether the music is routed through the filters and the context is running. */
export const eqStatus = () => ({ routed: !!filters, state: ctx?.state || 'none' });

function syncContext() {
  if (!ctx) return;
  if (player.playing) ctx.resume().catch(() => {});
  else ctx.suspend().catch(() => {});
}

function apply() {
  if (!filters) return;
  const { on, gains } = settings.eq;
  filters.forEach((f, i) => f.gain.setTargetAtTime(on ? gains[i] : 0, ctx.currentTime, 0.04));
}

/** On launch with the EQ left on: route on the first tap (iOS only starts audio inside a gesture). */
export function initEq() {
  if (settings.eq.on) document.addEventListener('pointerdown', () => { if (connect()) apply(); }, { once: true, capture: true });
}

function setEq(patch) {
  const eq = { ...settings.eq, ...patch };
  if (eq.on && !filters) {
    if (!connect()) { toast(t('toast_error')); return; }
    if (!settings.eqNoted) { toast(t('eq_note')); updateSettings({ eqNoted: true }); }
  }
  updateSettings({ eq });
  ctx?.resume().catch(() => {});
  apply();
}

// ---------- panel ----------

/** Approximate response of the five bands in dB at frequency f (for the drawn curve only). */
function response(f, gains) {
  return BANDS.reduce((sum, b, i) => {
    const x = Math.log2(f / b.f);
    if (b.type === 'lowshelf') return sum + gains[i] / (1 + Math.exp(3 * x));
    if (b.type === 'highshelf') return sum + gains[i] / (1 + Math.exp(-3 * x));
    return sum + gains[i] * Math.exp(-(x * x) / (2 * 0.55 * 0.55));
  }, 0);
}

function curvePath(gains) {
  let d = '';
  for (let i = 0; i <= 60; i++) {
    const f = 20 * Math.pow(1000, i / 60); // 20 Hz .. 20 kHz on a log scale
    const y = 40 - (Math.max(-MAX_DB, Math.min(MAX_DB, response(f, gains))) / MAX_DB) * 34;
    d += `${i ? 'L' : 'M'}${(i * 5).toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

function ticks() {
  let s = '';
  for (let db = -MAX_DB; db <= MAX_DB; db += 3) {
    const y = 50 - (db / MAX_DB) * 46;
    const w = db === 0 ? 12 : db % 6 === 0 ? 8 : 5;
    s += `<line x1="${8 - w / 2}" x2="${8 + w / 2}" y1="${y}" y2="${y}" class="${db === 0 ? 'zero' : ''}"/>`;
  }
  return `<svg class="fader__ticks" viewBox="0 0 16 100" preserveAspectRatio="none" aria-hidden="true">${s}</svg>`;
}

const fmtDb = (g) => (g > 0 ? `+${g}` : `${g}`);

export function openEqualizer() {
  const panel = h(`<div class="eqp">
    <div class="eqp__head">
      <span class="eqp__title">${esc(t('eq_title'))}</span>
      <label class="eqp__power"><span>${esc(t('eq_on'))}</span><input type="checkbox" class="switch"></label>
    </div>
    <svg class="eqp__curve" viewBox="0 0 300 80" preserveAspectRatio="none" aria-hidden="true">
      <path class="eqp__zero" d="M0 40H300"/><path class="eqp__line"/>
    </svg>
    <div class="eqp__faders">${BANDS.map((b, i) => `
      <div class="fader" data-i="${i}">
        <span class="fader__db"></span>
        <div class="fader__track" role="slider" aria-label="${b.label} Hz" aria-valuemin="-${MAX_DB}" aria-valuemax="${MAX_DB}" tabindex="0">
          ${ticks()}<span class="fader__slot"></span><span class="fader__cap"></span>
        </div>
        <span class="fader__label">${b.label}</span>
      </div>`).join('')}
    </div>
    <div class="eqp__presets">${Object.keys(PRESETS).map((k) => `<button class="eqp__preset" data-p="${k}">${esc(t('eq_' + k))}</button>`).join('')}</div>
  </div>`);
  const power = panel.querySelector('input');
  const line = panel.querySelector('.eqp__line');
  const faders = [...panel.querySelectorAll('.fader')];

  function draw() {
    const { on, gains, preset } = settings.eq;
    power.checked = on;
    panel.classList.toggle('is-off', !on);
    line.setAttribute('d', curvePath(on ? gains : PRESETS.flat));
    faders.forEach((el, i) => {
      el.style.setProperty('--v', gains[i] / MAX_DB);
      el.querySelector('.fader__db').textContent = fmtDb(gains[i]);
      el.querySelector('.fader__track').setAttribute('aria-valuenow', gains[i]);
    });
    panel.querySelectorAll('.eqp__preset').forEach((b) => b.classList.toggle('is-on', b.dataset.p === preset));
  }

  power.addEventListener('change', () => { haptic('select'); setEq({ on: power.checked }); draw(); });
  panel.querySelector('.eqp__presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    haptic('select');
    setEq({ on: true, preset: b.dataset.p, gains: PRESETS[b.dataset.p].slice() });
    draw();
  });

  faders.forEach((el, i) => {
    const track = el.querySelector('.fader__track');
    let rect = null;
    const setGain = (g) => {
      g = Math.max(-MAX_DB, Math.min(MAX_DB, Math.round(g)));
      if (g === settings.eq.gains[i] && settings.eq.on) return;
      if (g % 3 === 0) haptic(g === 0 ? 'medium' : 'select'); // a detent at 0 dB and every 3 dB
      const gains = settings.eq.gains.slice();
      gains[i] = g;
      setEq({ on: true, preset: 'custom', gains });
      draw();
    };
    const at = (e) => MAX_DB - ((e.clientY - rect.top) / rect.height) * 2 * MAX_DB;
    track.addEventListener('pointerdown', (e) => {
      rect = track.getBoundingClientRect();
      track.setPointerCapture(e.pointerId);
      el.classList.add('is-drag');
      setGain(at(e));
    });
    track.addEventListener('pointermove', (e) => { if (rect) setGain(at(e)); });
    const end = () => { rect = null; el.classList.remove('is-drag'); };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    track.addEventListener('keydown', (e) => {
      const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (step) { e.preventDefault(); setGain(settings.eq.gains[i] + step); }
    });
  });

  draw();
  return sheet({ content: panel, done: true });
}
