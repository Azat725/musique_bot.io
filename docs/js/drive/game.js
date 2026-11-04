import { t } from '../i18n.js';
import { esc, h, haptic, icon, sheet } from '../ui.js';
import { initSfx, startCarAmbience, startDriveAudio } from '../sfx.js';
import { settings } from '../store.js';
import { receiver, tuneBy } from '../radio.js';
import { makeWorld, rng, startSpot } from './world.js';
import { carSpec, styleFor } from './styles.js';
import { makeCar, outline, stepCar } from './physics.js';
import { makeTraffic, overlap, pedHit, stepTraffic } from './traffic.js';
import { createRenderer } from './render.js';
import { dashParts, mountDash } from './dash.js';
import { createControls } from './controls.js';
import { PENALTY, clock, courseTotal, endRun, finishCourse, loadRecords, makeCourse, makeRun, saveRecords, stepCourse } from './records.js';

/** "At the wheel": a little game inside the player, only on this device: drive the chosen car round a small night town
 *  of its country and age, with its own dashboard, free or in a race through checkpoints; the records (how far without a
 *  touch, the best race) stay on this device. It talks to nobody: nothing here uses the network (changing the
 *  station by holding the radio is the radio's own tuning, the same as its button in the player). */

let session = null;
export const isDriveOpen = () => !!session;
/** The running game (its car, its traffic), for a look from the tests. */
export const driveState = () => session;

const LIGHTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5.5a6.5 6.5 0 0 0 0 13c1.2 0 2.3-.3 3.2-.9V6.4A6.4 6.4 0 0 0 13 5.5z"/><path d="M19 8.5h2.5M19 12h2.5M19 15.5h2.5"/></svg>';
const HORN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5l5.5 4v-13l-5.5 4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
const ENV_ICONS = {
  night: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  dusk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 18h17M7 18a5 5 0 0 1 10 0M12 7v2.5M5.4 10.4l1.8 1.8M18.6 10.4l-1.8 1.8"/></svg>',
  day: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',
};
const RAIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 15a4 4 0 0 1 .5-8 5 5 0 0 1 9.5 1.5A3.3 3.3 0 0 1 17 15H7zM9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5"/></svg>';
const TIMES = ['night', 'dusk', 'day'];
const ENV_KEY = 'musique.drive-env'; // the time of day and the rain you left it with, on this device
const PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/></svg>';

/** Asks first (the game leaves the player), then starts. */
export async function openDrive() {
  if (session) return;
  const pick = await sheet({
    title: esc(t('drive_warn_title')),
    content: h(`<p class="drive-warn">${esc(t('drive_warn_text'))}</p>`),
    items: [{ icon: 'steering', label: t('drive_play') }, { icon: 'clock', label: t('drive_race') }],
    closeLabel: t('drive_not_now'),
  });
  if (pick === 0 || pick === 1) start(pick === 1 ? 'race' : 'free');
}

function start(mode = 'free') {
  const r = receiver('car');
  const style = styleFor(r.country, r.year), spec = carSpec(r.id);
  const world = makeWorld(r.id, style), traffic = makeTraffic(world, rng(r.id + 'traffic'), style);
  const car = makeCar(spec, startSpot(style.lht));
  const store = { getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not kept */ } } };
  const rec = loadRecords(store), run = makeRun();
  let course = mode === 'race' ? makeCourse(world, rng(r.id + 'race'), car) : null, attempt = 0;
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
    <div class="drive__env">
      <button class="drive__tool" data-env-time aria-label="${esc(t('drive_time'))}"></button>
      <button class="drive__tool" data-env-rain aria-pressed="false" aria-label="${esc(t('drive_rain'))}">${RAIN}</button>
    </div>
    <div class="drive__pedals">
      <button class="drive__pedal drive__pedal--brake" aria-label="${esc(t('drive_brake'))}"><span>${esc(t('drive_brake'))}</span></button>
      <button class="drive__pedal drive__pedal--gas" aria-label="${esc(t('drive_gas'))}"><span>${esc(t('drive_gas'))}</span></button>
    </div>
    <button class="drive__exit icon-btn" aria-label="${esc(t('drive_exit'))}">${icon('close')}</button>
    <div class="drive__hud"><svg class="drive__arrow" viewBox="-12 -12 24 24" aria-hidden="true"><path d="M0 -10 L8 7 L0 3 L-8 7 Z"/></svg><div><b class="drive__hud1"></b><span class="drive__hud2"></span></div></div>
    <div class="drive__result" role="dialog" aria-modal="true" hidden></div>
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
  // the time of day and the rain: a button each; they start as they were left (the rain as the car radio has it by default)
  let env = { time: 'night', rain: !!settings.radioRain }, rainAudio = null;
  try { const v = JSON.parse(store.getItem(ENV_KEY) || 'null'); if (v && TIMES.includes(v.time)) env = { time: v.time, rain: !!v.rain }; } catch { /* the default */ }
  initSfx();
  let quality = 1, audio = startDriveAudio(), lights = false, horn = false, shake = 0, raf = 0, last = 0, acc = 0, time = 0, slow = 0, frames = 0, closed = false, paused = false;

  const controls = createControls(
    { wheel: $('.drive__wheelhit'), gas: $('.drive__pedal--gas'), brake: $('.drive__pedal--brake'), horn: $('[data-horn]'), lights: $('[data-lights]') },
    {
      lights: () => { lights = !lights; haptic('select'); $('[data-lights]').setAttribute('aria-pressed', String(lights)); $('[data-lights]').classList.toggle('is-on', lights); },
      horn: (on) => { horn = on; audio?.horn(on); },
      station: (dir) => { haptic('medium'); tuneBy(dir).catch(() => {}); }, // N: the next station, Shift+N: the one before
      time: () => nextTime(), rain: () => toggleRain(),
    },
  );

  const applyEnv = () => {
    renderer.setEnv(env);
    const tb = $('[data-env-time]'), rb = $('[data-env-rain]');
    tb.innerHTML = ENV_ICONS[env.time]; tb.setAttribute('aria-label', `${t('drive_time')}: ${t('drive_t_' + env.time)}`);
    rb.classList.toggle('is-on', env.rain); rb.setAttribute('aria-pressed', String(env.rain));
    if (env.rain && !rainAudio && !document.hidden) rainAudio = startCarAmbience({ rain: true });
    else if (!env.rain && rainAudio) { rainAudio(); rainAudio = null; }
  };
  const changeEnv = (next, word) => { env = { ...env, ...next }; store.setItem(ENV_KEY, JSON.stringify(env)); applyEnv(); haptic('select'); say(word()); };
  const nextTime = () => changeEnv({ time: TIMES[(TIMES.indexOf(env.time) + 1) % TIMES.length] }, () => t('drive_t_' + env.time));
  const toggleRain = () => changeEnv({ rain: !env.rain }, () => t(env.rain ? 'drive_rain_on' : 'drive_rain_off'));
  $('[data-env-time]').addEventListener('click', nextTime);
  $('[data-env-rain]').addEventListener('click', toggleRain);

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

  // a few words over the road now and then (the first hint is the same line)
  const hintEl = $('.drive__hint');
  let hintTimer = 0;
  const say = (text) => { hintEl.textContent = text; hintEl.classList.remove('is-gone'); clearTimeout(hintTimer); hintTimer = setTimeout(() => hintEl.classList.add('is-gone'), 3500); };

  const resultEl = $('.drive__result');
  const finishRace = () => {
    const { total, best } = finishCourse(course, rec);
    saveRecords(store, rec);
    haptic('medium');
    resultEl.innerHTML = `<h2>${esc(t('drive_done_t'))}</h2><p>${esc(t('drive_done_s', { time: clock(course.time), pen: course.touches * PENALTY, total: clock(total) }))}</p>
      <p class="${best ? 'drive__resultbest' : ''}">${esc(best ? t('drive_new_best') : t('drive_best_t', { t: clock(rec.race) }))}</p>
      <div class="drive__resultbtns"><button class="btn btn--accent" data-again>${esc(t('drive_again'))}</button><button class="btn btn--outline" data-keep>${esc(t('drive_keep'))}</button></div>`;
    resultEl.hidden = false;
    const again = resultEl.querySelector('[data-again]');
    again.focus({ preventScroll: true });
    again.addEventListener('click', () => { resultEl.hidden = true; attempt += 1; course = makeCourse(world, rng(`${r.id}race${attempt}`), car); run.clean = 0; });
    resultEl.querySelector('[data-keep]').addEventListener('click', () => { resultEl.hidden = true; course = null; mode = 'free'; });
  };

  // the numbers over the road: the run without a touch, or the next checkpoint with the time and an arrow to it
  const hud = { one: $('.drive__hud1'), two: $('.drive__hud2'), arrow: $('.drive__arrow'), text: '' };
  const updateHud = () => {
    const racing = course && !course.done;
    const one = racing ? t('drive_point', { n: course.next + 1, total: course.points.length }) : t('drive_clean', { m: Math.floor(run.clean) });
    const two = racing ? clock(courseTotal(course)) + (rec.race ? ` · ${t('drive_best_t', { t: clock(rec.race) })}` : '') : rec.clean ? t('drive_best_m', { m: rec.clean }) : '';
    if (one + two !== hud.text) { hud.text = one + two; hud.one.textContent = one; hud.two.textContent = two; }
    hud.arrow.style.display = racing ? '' : 'none';
    if (racing) {
      const p = course.points[course.next], dx = p.x - car.x, dy = p.y - car.y;
      const ahead = dx * Math.cos(car.h) + dy * Math.sin(car.h), right = dx * Math.sin(car.h) - dy * Math.cos(car.h);
      hud.arrow.style.transform = `rotate(${(Math.atan2(right, ahead) * 180 / Math.PI).toFixed(0)}deg)`;
    }
  };
  updateHud();
  applyEnv();

  const step = (dt) => {
    time += dt;
    const inp = controls.read(dt);
    const { bump } = stepCar(car, inp, dt, world.onRoad);
    stepTraffic(traffic, car, dt);
    let hit = bump, touched = bump >= 0.8; // a scrape along the kerb counts too
    for (const c of traffic.cars) { // a bump with another car: both are in the way of each other, the player is pushed back
      if (Math.abs(c.x - car.x) > 8 || Math.abs(c.y - car.y) > 8) continue;
      const push = overlap({ x: car.x, y: car.y, h: car.h, len: spec.len, wid: spec.wid }, c);
      if (!push) continue;
      const nx = car.x + push.x * push.depth, ny = car.y + push.y * push.depth;
      if (outline(car, nx, ny).every(([px, py]) => world.onRoad(px, py))) { car.x = nx; car.y = ny; }
      hit = Math.max(hit, Math.abs(car.v)); touched = true;
      car.v *= 0.3;
    }
    for (const p of traffic.peds) { // someone on a zebra in the way: they are shaken, the car loses its speed
      if (!p.cross || !pedHit({ x: car.x, y: car.y, h: car.h, len: spec.len, wid: spec.wid }, p)) continue;
      p.state = 'hit'; p.timer = 2.5;
      hit = Math.max(hit, Math.abs(car.v), 3); touched = true; car.v *= 0.3;
      say(t('drive_ped'));
    }
    if (hit > 1.5) { audio?.bump(hit); shake = Math.min(7, hit * 0.9); haptic('light'); }
    run.clean += Math.abs(car.v) * dt;
    if (touched && time - run.lastTouch > 0.8) { // the clean run ends; a race loses seconds
      run.lastTouch = time;
      const m = endRun(run, rec);
      if (m) { saveRecords(store, rec); say(t('drive_new_clean', { m })); }
      if (course && course.started && !course.done) course.touches += 1;
    }
    if (course) {
      const ev = stepCourse(course, car, dt);
      if (ev === 'point') { haptic('select'); say(t('drive_point', { n: course.next + 1, total: course.points.length })); } else if (ev === 'finish') finishRace();
    }
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
    renderer.draw({ car, traffic, lights, time, shake: shake < 0.2 ? 0 : shake, beacon: course && !course.done ? course.points[course.next] : null });
    dash.update({ car, kmh: Math.abs(car.v) * 3.6, lights, hand: inp.hand, time });
    wheelArt.style.transform = `rotate(${inp.wheelDeg.toFixed(1)}deg)`;
    audio?.update({ rpm: car.rpm, red: spec.red, speed: Math.abs(car.v), throttle: inp.throttle || 0 });
    // a slow phone draws fewer pixels: if frames take long for a second, the picture gets coarser
    if (frames % 4 === 0) updateHud();
    frames++; if (dt > 0.034) slow++;
    if (frames >= 60) { if (slow > 36 && quality > 0.5) { quality = quality > 0.7 ? 0.7 : 0.5; renderer.setQuality(quality); } frames = 0; slow = 0; }
  };

  const onVisible = () => {
    if (document.hidden) { cancelAnimationFrame(raf); audio?.stop(); audio = null; rainAudio?.(); rainAudio = null; }
    else if (!closed) { last = performance.now(); raf = requestAnimationFrame(frame); audio = startDriveAudio(); applyEnv(); }
  };
  document.addEventListener('visibilitychange', onVisible);

  const close = () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf); stopHold(); clearTimeout(hintTimer);
    if (endRun(run, rec)) saveRecords(store, rec); // a run still going when the game is left may be a record too
    controls.destroy(); audio?.stop(); rainAudio?.(); dash.destroy();
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
  session = { close, car, traffic, world, course: () => course };
  last = performance.now();
  raf = requestAnimationFrame(frame);
  hintTimer = setTimeout(() => hintEl.classList.add('is-gone'), 7000);
  $('.drive__exit').focus({ preventScroll: true });
}
