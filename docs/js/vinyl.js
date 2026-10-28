import { t } from './i18n.js';
import { player } from './player.js';
import { likes, settings, toggleLike } from './store.js';
import { chooseAndAddToPlaylist, esc, fmt, h, haptic, icon, toast, trackMenu } from './ui.js';
import { api } from './api.js';

const RPM_MS = 1800; // one revolution at 33⅓ rpm
const NS = 'http://www.w3.org/2000/svg';

// ---------- sound effects (Web Audio, so they mix with the music instead of interrupting it) ----------

const sfx = { ctx: null, buffers: {} };

async function initSfx() {
  if (sfx.ctx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  sfx.ctx = new Ctx();
  for (const name of ['swipe', 'needle']) {
    try {
      const data = await (await fetch(`assets/sfx/${name}.mp3`)).arrayBuffer();
      sfx.buffers[name] = await sfx.ctx.decodeAudioData(data);
    } catch {}
  }
}

function playSfx(name, volume = 0.55) {
  if (!settings.sounds || !sfx.ctx || !sfx.buffers[name]) return;
  if (sfx.ctx.state === 'suspended') sfx.ctx.resume();
  const src = sfx.ctx.createBufferSource();
  const gain = sfx.ctx.createGain();
  gain.gain.value = volume;
  src.buffer = sfx.buffers[name];
  src.connect(gain).connect(sfx.ctx.destination);
  src.start();
}

// ---------- the record ----------

function discSvg() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.classList.add('record__disc');
  let html = '<circle cx="100" cy="100" r="99.5" class="disc__body"/>';
  html += '<circle cx="100" cy="100" r="98" class="disc__edge"/>';
  for (let r = 42; r <= 95; r += 2.4) html += `<circle cx="100" cy="100" r="${r.toFixed(1)}" class="disc__groove"/>`;
  for (const r of [58, 73, 86]) html += `<circle cx="100" cy="100" r="${r}" class="disc__gap"/>`;
  // irregular groove arcs: concentric circles alone would hide the rotation
  const arcs = [[48, 20, 95], [55, 160, 230], [64, 300, 350], [70, 40, 70], [79, 190, 280], [84, 110, 140], [91, 250, 330]];
  for (const [r, a0, a1] of arcs) {
    const p = (a) => [100 + r * Math.cos((a * Math.PI) / 180), 100 + r * Math.sin((a * Math.PI) / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    html += `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" class="disc__arc"/>`;
  }
  svg.innerHTML = html;
  return svg;
}

function sheenSvg() {
  // static reflection — stays put while the record spins under it
  const wedge = (a0, a1) => {
    const pt = (r, a) => `${(100 + r * Math.cos((a * Math.PI) / 180)).toFixed(2)} ${(100 + r * Math.sin((a * Math.PI) / 180)).toFixed(2)}`;
    return `<path d="M${pt(40, a0)} L${pt(97, a0)} A97 97 0 0 1 ${pt(97, a1)} L${pt(40, a1)} A40 40 0 0 0 ${pt(40, a0)}Z" class="sheen"/>`;
  };
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.classList.add('record__sheen');
  svg.innerHTML = wedge(-70, -42) + wedge(110, 138) + wedge(-38, -30) + wedge(142, 150);
  return svg;
}

function makeRecord(track) {
  const el = h(`<div class="record">
    <div class="record__spin">
      <div class="record__label">${track?.cover ? `<img src="${esc(track.cover)}" alt="" referrerpolicy="no-referrer">` : '<span class="record__blank">Musique</span>'}</div>
      <span class="record__hole"></span>
    </div>
  </div>`);
  const spin = el.querySelector('.record__spin');
  spin.prepend(discSvg());
  el.append(sheenSvg());
  const anim = spin.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: RPM_MS, iterations: Infinity });
  anim.playbackRate = 0;
  return { el, anim, track, rate: 0, raf: 0 };
}

function rampTo(rec, target, ms) {
  cancelAnimationFrame(rec.raf);
  const from = rec.rate;
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / ms);
    const eased = target > from ? 1 - (1 - k) ** 2 : 1 - (1 - k) ** 3;
    rec.rate = from + (target - from) * eased;
    rec.anim.playbackRate = rec.rate;
    if (k < 1) rec.raf = requestAnimationFrame(step);
  };
  rec.raf = requestAnimationFrame(step);
}

// ---------- full-screen player ----------

let root, stage, rec = null, open = false, swapping = 0;

export function isPlayerOpen() { return open; }

export function initFullPlayer() {
  root = h(`<div class="fp" aria-hidden="true">
    <header class="fp__top">
      <button class="icon-btn" data-close aria-label="close">${icon('down')}</button>
      <div class="fp__kicker"></div>
      <button class="icon-btn" data-more aria-label="more">${icon('more')}</button>
    </header>
    <div class="fp__stage"></div>
    <div class="fp__info">
      <div class="fp__titles"><div class="fp__title"></div><div class="fp__artist"></div></div>
      <button class="icon-btn fp__like" data-like aria-label="like">${icon('heart')}</button>
    </div>
    <div class="progress">
      <div class="progress__bar"><div class="progress__fill"></div><div class="progress__knob"></div></div>
      <div class="progress__times"><span data-cur>0:00</span><span data-dur>0:00</span></div>
    </div>
    <div class="controls">
      <button class="icon-btn" data-shuffle aria-label="shuffle">${icon('shuffle')}</button>
      <button class="icon-btn icon-btn--lg" data-prev aria-label="previous">${icon('prev')}</button>
      <button class="play-btn" data-play aria-label="play">${icon('play')}</button>
      <button class="icon-btn icon-btn--lg" data-next aria-label="next">${icon('next')}</button>
      <button class="icon-btn" data-repeat aria-label="repeat">${icon('repeat')}</button>
    </div>
    <div class="fp__extra">
      <button class="pill" data-add>${icon('listPlus')}<span></span></button>
      <button class="pill" data-send>${icon('send')}<span></span></button>
    </div>
  </div>`);
  document.body.append(root);
  stage = root.querySelector('.fp__stage');

  const $ = (s) => root.querySelector(s);
  $('[data-close]').addEventListener('click', closePlayer);
  $('[data-play]').addEventListener('click', () => { haptic('medium'); player.toggle(); });
  $('[data-next]').addEventListener('click', () => { haptic('light'); player.next(); });
  $('[data-prev]').addEventListener('click', () => { haptic('light'); player.prev(); });
  $('[data-shuffle]').addEventListener('click', () => { haptic('select'); player.toggleShuffle(); });
  $('[data-repeat]').addEventListener('click', () => { haptic('select'); player.cycleRepeat(); });
  $('[data-more]').addEventListener('click', () => player.current && trackMenu(player.current).then(syncLike));
  $('[data-add]').addEventListener('click', () => player.current && chooseAndAddToPlaylist(player.current).catch(() => toast(t('toast_error'))));
  $('[data-send]').addEventListener('click', async () => {
    if (!player.current) return;
    try { await api.send(player.current); haptic('success'); toast(t('toast_sending')); } catch { toast(t('toast_error')); }
  });
  $('[data-like]').addEventListener('click', async () => {
    if (!player.current) return;
    haptic('light');
    try {
      await toggleLike(player.current);
      document.dispatchEvent(new CustomEvent('likes-changed'));
    } catch { toast(t('toast_error')); }
    syncLike();
  });

  setupSeek($('.progress__bar'));
  setupGestures();

  player.addEventListener('track', (e) => onTrack(e.detail));
  player.addEventListener('state', syncState);
  player.addEventListener('time', syncTime);
  player.addEventListener('modes', syncModes);
  document.addEventListener('likes-changed', syncLike);
  document.addEventListener('pointerdown', initSfx, { once: true });
  translate();
}

export function translate() {
  if (!root) return;
  root.querySelector('.fp__kicker').textContent = t('player_now');
  root.querySelector('[data-add] span').textContent = t('pill_playlist');
  root.querySelector('[data-send] span').textContent = t('pill_send');
  syncInfo();
}

export function openPlayer() {
  if (!player.current) return;
  open = true;
  root.classList.add('is-open');
  root.setAttribute('aria-hidden', 'false');
  if (!rec || rec.track?.id !== player.current.id) placeRecord(player.current);
  syncState();
  syncTime();
  syncModes();
  document.dispatchEvent(new CustomEvent('player-open', { detail: true }));
}

export function closePlayer() {
  open = false;
  root.classList.remove('is-open');
  root.setAttribute('aria-hidden', 'true');
  document.dispatchEvent(new CustomEvent('player-open', { detail: false }));
}

function placeRecord(track) {
  stage.innerHTML = '';
  rec = makeRecord(track);
  stage.append(rec.el);
}

function onTrack({ track, dir }) {
  syncInfo();
  syncLike();
  syncTime();
  if (!open || !rec) { placeRecord(track); return; }
  if (rec.track?.id === track.id) return;
  swapRecord(track, dir < 0 ? -1 : 1);
}

function swapRecord(track, dir) {
  const my = ++swapping;
  // finish any half-done swap immediately
  stage.querySelectorAll('.record.is-leaving').forEach((el) => el.remove());

  const old = rec;
  old.el.classList.add('is-leaving');
  const from = old.el.style.transform || 'translateX(0) rotate(0deg)';
  old.el.style.transform = '';
  rampTo(old, 2.2, 250); // the record is flicked away, spinning faster
  playSfx('swipe', 0.45);
  old.el.animate([
    { transform: from, opacity: 1 },
    { transform: `translateX(${-dir * 125}%) rotate(${-dir * 50}deg) scale(.86)`, opacity: 0 },
  ], { duration: 520, easing: 'cubic-bezier(.55,0,.8,.3)', fill: 'forwards' }).finished
    .then(() => { cancelAnimationFrame(old.raf); old.el.remove(); }).catch(() => {});

  rec = makeRecord(track);
  stage.append(rec.el);
  rec.el.animate([
    { transform: `translateX(${dir * 125}%) rotate(${dir * 40}deg) scale(.86)`, opacity: 0 },
    { transform: 'translateX(0) rotate(0deg) scale(1)', opacity: 1 },
  ], { duration: 620, delay: 160, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' }).finished
    .then(() => {
      if (my !== swapping) return;
      playSfx('needle', 0.6);
      syncState();
    }).catch(() => {});
}

// ---------- sync ----------

function syncInfo() {
  const tr = player.current;
  root.querySelector('.fp__title').textContent = tr?.title || t('player_nothing');
  root.querySelector('.fp__artist').textContent = tr?.artist || '';
}

function syncLike() {
  const liked = !!player.current && likes.has(player.current.id);
  const btn = root.querySelector('[data-like]');
  btn.innerHTML = icon(liked ? 'heartFill' : 'heart');
  btn.classList.toggle('is-on', liked);
}

function syncState() {
  root.querySelector('[data-play]').innerHTML = icon(player.playing ? 'pause' : 'play');
  root.classList.toggle('is-loading', player.loading);
  if (!rec || rec.el.getAnimations().some((a) => a.playState === 'running' && a !== rec.anim)) return;
  const spinning = player.playing && !player.loading;
  rampTo(rec, spinning ? 1 : 0, spinning ? 900 : 700);
}

function syncTime() {
  if (!open) return;
  const d = player.duration, c = player.time;
  if (!dragging) root.querySelector('.progress').style.setProperty('--p', d ? Math.min(1, c / d) : 0);
  root.querySelector('[data-cur]').textContent = fmt(dragging ? dragValue * d : c);
  root.querySelector('[data-dur]').textContent = fmt(d);
}

function syncModes() {
  root.querySelector('[data-shuffle]').classList.toggle('is-on', player.shuffle);
  const rep = root.querySelector('[data-repeat]');
  rep.classList.toggle('is-on', player.repeat !== 'off');
  rep.innerHTML = icon(player.repeat === 'one' ? 'repeat1' : 'repeat');
}

// ---------- seeking ----------

let dragging = false, dragValue = 0;

function setupSeek(bar) {
  const progress = bar.parentElement;
  const valueAt = (e) => {
    const r = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    dragValue = valueAt(e);
    progress.classList.add('is-drag');
    progress.style.setProperty('--p', dragValue);
    syncTime();
  });
  bar.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dragValue = valueAt(e);
    progress.style.setProperty('--p', dragValue);
    syncTime();
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    progress.classList.remove('is-drag');
    player.seek(dragValue * player.duration);
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
}

// ---------- swipe the record to change tracks, tap to pause ----------

function setupGestures() {
  let x0 = null, y0 = 0, dx = 0, moved = false;
  stage.addEventListener('pointerdown', (e) => {
    if (!rec) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; moved = false;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (x0 === null || !rec) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - y0)) moved = true;
    if (moved) rec.el.style.transform = `translateX(${dx * 0.7}px) rotate(${dx * 0.08}deg)`;
  });
  const end = () => {
    if (x0 === null || !rec) return;
    x0 = null;
    if (!moved) { haptic('medium'); player.toggle(); return; }
    if (Math.abs(dx) > 70 && player.queue.length > 1) {
      haptic('light');
      if (dx < 0) player.next(); else player.prev();
      if (rec.el.style.transform) {
        // prev() within the first seconds restarts the same track: spring back
        rec.el.animate([{ transform: rec.el.style.transform }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
        rec.el.style.transform = '';
      }
    } else {
      rec.el.animate([{ transform: rec.el.style.transform }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
      rec.el.style.transform = '';
    }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
}
