import { t } from '../i18n.js';
import { esc, h, haptic, icon, sheet } from '../ui.js';
import { initSfx, startDriveAudio } from '../sfx.js';
import { receiver, tuneBy } from '../radio.js';
import { makeWorld, rng, startSpot } from './world.js';
import { carSpec, styleFor } from './styles.js';
import { makeCar, outline, stepCar } from './physics.js';
import { makeTraffic, overlap, stepTraffic } from './traffic.js';
import { createRenderer } from './render.js';
import { dashParts, mountDash } from './dash.js';
import { createControls } from './controls.js';

/** "At the wheel": a little game inside the player, only on this device: drive the chosen car round a small night town
 *  of its country and age, with its own dashboard. It talks to nobody: nothing here uses the network (changing the
 *  station by holding the radio is the radio's own tuning, the same as its button in the player). */

let session = null;
export const isDriveOpen = () => !!session;
/** The running game (its car, its traffic), for a look from the tests. */
export const driveState = () => session;

const LIGHTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5.5a6.5 6.5 0 0 0 0 13c1.2 0 2.3-.3 3.2-.9V6.4A6.4 6.4 0 0 0 13 5.5z"/><path d="M19 8.5h2.5M19 12h2.5M19 15.5h2.5"/></svg>';
const HORN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l5.5 4v-13l-5.5 4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
const PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/></svg>';

/** Asks first (the game leaves the player), then starts. */
export async function openDrive() {
  if (session) return;
  const pick = await sheet({
    title: esc(t('drive_warn_title')),
    content: h(`<p class="drive-warn">${esc(t('drive_warn_text'))}</p>`),
    items: [{ icon: 'steering', label: t('drive_play') }],
    closeLabel: t('drive_not_now'),
  });
  if (pick === 0) start();
}

function start() {
  const r = receiver('car');
  const style = styleFor(r.country, r.year), spec = carSpec(r.id);
  const world = makeWorld(r.id, style), traffic = makeTraffic(world, rng(r.id + 'traffic'), style);
  const car = makeCar(spec, startSpot(style.lht));
  const { base } = dashParts(r);
  const root = h(`<div class="drive" role="dialog" aria-modal="true" aria-label="${esc(t('drive_title'))}" style="--base:${base}">
    <canvas class="drive__view" aria-hidden="true"></canvas>
    <div class="drive__cowl"></div>
    <div class="drive__dash"></div>
    <div class="drive__wheel"><div class="drive__wheelart"></div><div class="drive__wheelhit" aria-label="${esc(t('drive_wheel'))}"></div></div>
    <div class="drive__tools">
      <button class="drive__tool" data-lights aria-pressed="false" aria-label="${esc(t('drive_lights'))}">${LIGHTS}</button>
      <button class="drive__tool" data-horn aria-label="${esc(t('drive_horn'))}">${HORN}</button>
    </div>
    <div class="drive__pedals">
      <button class="drive__pedal drive__pedal--brake" aria-label="${esc(t('drive_brake'))}"><span>${esc(t('drive_brake'))}</span></button>
      <button class="drive__pedal drive__pedal--gas" aria-label="${esc(t('drive_gas'))}"><span>${esc(t('drive_gas'))}</span></button>
    </div>
    <button class="drive__exit icon-btn" aria-label="${esc(t('drive_exit'))}">${icon('close')}</button>
    <p class="drive__hint">${esc(t('drive_hint'))}</p>
    <p class="drive__keys">${esc(t('drive_keys'))}</p>
    <div class="drive__rotate"><span>${PHONE}</span><p>${esc(t('drive_rotate'))}</p></div>
  </div>`);
  const $ = (s) => root.querySelector(s);
  document.body.append(root);
  document.body.classList.add('drive-open');
  document.dispatchEvent(new CustomEvent('drive-open', { detail: true })); // the radio's rain and road sounds step aside

  const canvas = $('.drive__view'), wheelArt = $('.drive__wheelart');
  const dash = mountDash($('.drive__dash'), wheelArt, r);
  const renderer = createRenderer(canvas, world, style);
  initSfx();
  let quality = 1, audio = startDriveAudio(), lights = false, horn = false, shake = 0, raf = 0, last = 0, acc = 0, time = 0, slow = 0, frames = 0, closed = false, paused = false;

  const controls = createControls(
    { wheel: $('.drive__wheelhit'), gas: $('.drive__pedal--gas'), brake: $('.drive__pedal--brake'), horn: $('[data-horn]'), lights: $('[data-lights]') },
    {
      lights: () => { lights = !lights; haptic('select'); $('[data-lights]').setAttribute('aria-pressed', String(lights)); $('[data-lights]').classList.toggle('is-on', lights); },
      horn: (on) => { horn = on; audio?.horn(on); },
      station: (dir) => { haptic('medium'); tuneBy(dir).catch(() => {}); }, // N: the next station, Shift+N: the one before
    },
  );

  // holding the radio for 2.5 seconds tunes the next station
  let hold = null;
  const radio = dash.radio;
  const stopHold = () => { clearTimeout(hold); hold = null; radio.classList.remove('is-holding'); };
  radio.addEventListener('pointerdown', (e) => {
    e.preventDefault(); radio.setPointerCapture(e.pointerId);
    radio.classList.remove('is-holding'); void radio.offsetWidth; radio.classList.add('is-holding');
    hold = setTimeout(() => { stopHold(); haptic('medium'); tuneBy(1).catch(() => {}); }, dash.holdMs);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) radio.addEventListener(type, stopHold);

  // the size of everything follows the screen: the dashboard is 40 % of its height, as wide as its drawing is
  const layout = () => {
    const dh = Math.min(innerHeight * 0.4, (innerWidth * 210) / 400), dw = (dh * 400) / 210;
    root.style.setProperty('--dw', `${dw}px`); root.style.setProperty('--dh', `${dh}px`);
    paused = innerWidth < innerHeight && innerWidth < 820; // a phone held upright: asks to turn it
    root.classList.toggle('is-portrait', paused);
    renderer.resize();
  };
  layout();
  addEventListener('resize', layout);
  addEventListener('orientationchange', layout);

  const step = (dt) => {
    time += dt;
    const inp = controls.read(dt);
    const { bump } = stepCar(car, inp, dt, world.onRoad);
    stepTraffic(traffic, car, dt);
    let hit = bump;
    for (const c of traffic.cars) { // a bump with another car: both are in the way of each other, the player is pushed back
      if (Math.abs(c.x - car.x) > 8 || Math.abs(c.y - car.y) > 8) continue;
      const push = overlap({ x: car.x, y: car.y, h: car.h, len: spec.len, wid: spec.wid }, c);
      if (!push) continue;
      const nx = car.x + push.x * push.depth, ny = car.y + push.y * push.depth;
      if (outline(car, nx, ny).every(([px, py]) => world.onRoad(px, py))) { car.x = nx; car.y = ny; }
      hit = Math.max(hit, Math.abs(car.v));
      car.v *= 0.3;
    }
    if (hit > 1.5) { audio?.bump(hit); shake = Math.min(7, hit * 0.9); haptic('light'); }
    return inp;
  };

  let inp = { wheelDeg: 0, hand: false };
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (paused) return;
    acc += dt;
    while (acc >= 1 / 60) { inp = step(1 / 60); acc -= 1 / 60; }
    shake *= 0.86;
    renderer.draw({ car, traffic, lights, time, shake: shake < 0.2 ? 0 : shake });
    dash.update({ car, kmh: Math.abs(car.v) * 3.6, lights, hand: inp.hand, time });
    wheelArt.style.transform = `rotate(${inp.wheelDeg.toFixed(1)}deg)`;
    audio?.update({ rpm: car.rpm, red: spec.red, speed: Math.abs(car.v), throttle: inp.throttle || 0 });
    // a slow phone draws fewer pixels: if frames take long for a second, the picture gets coarser
    frames++; if (dt > 0.034) slow++;
    if (frames >= 60) { if (slow > 36 && quality > 0.5) { quality = quality > 0.7 ? 0.7 : 0.5; renderer.setQuality(quality); } frames = 0; slow = 0; }
  };

  const onVisible = () => {
    if (document.hidden) { cancelAnimationFrame(raf); audio?.stop(); audio = null; }
    else if (!closed) { last = performance.now(); raf = requestAnimationFrame(frame); audio = startDriveAudio(); }
  };
  document.addEventListener('visibilitychange', onVisible);

  const close = () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf); stopHold();
    controls.destroy(); audio?.stop(); dash.destroy();
    removeEventListener('resize', layout); removeEventListener('orientationchange', layout);
    document.removeEventListener('visibilitychange', onVisible); document.removeEventListener('drive-close', close); removeEventListener('keydown', onKey, true);
    root.classList.add('is-leaving');
    setTimeout(() => root.remove(), 250);
    document.body.classList.remove('drive-open');
    document.dispatchEvent(new CustomEvent('drive-open', { detail: false }));
    session = null;
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  document.addEventListener('drive-close', close); // the Back button of Telegram or of the browser
  $('.drive__exit').addEventListener('click', close);
  session = { close, car, traffic, world };
  last = performance.now();
  raf = requestAnimationFrame(frame);
  setTimeout(() => root.querySelector('.drive__hint')?.classList.add('is-gone'), 7000);
  $('.drive__exit').focus({ preventScroll: true });
}
