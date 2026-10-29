import { t } from './i18n.js';
import { player } from './player.js';
import { likes, toggleLike } from './store.js';
import { EASE_IO, chooseAndAddToPlaylist, esc, fmt, h, haptic, icon, openArtist, reducedMotion, toast, trackMenu } from './ui.js';
import { api } from './api.js';
import { openEqualizer } from './eq.js';
import { initSfx, playSfx, startScratch, startSpinNoise, whoosh } from './sfx.js';

const RPM_MS = 1800; // one revolution at 33⅓ rpm
const SECONDS_PER_TURN = 15; // turning the record by hand: one revolution moves the track by 15 s
const NS = 'http://www.w3.org/2000/svg';

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
    else if (!target) rec.anim.pause(); // a stopped record must not keep an animation ticking
  };
  if (target && rec.anim.playState === 'paused') rec.anim.play();
  rec.raf = requestAnimationFrame(step);
}

// ---------- full-screen player ----------

let root, stage, bubble, el, rec = null, open = false, swapping = 0, closeTimer = 0;
let stopSpinNoise = null, scrubbing = false;

export function isPlayerOpen() { return open; }

export function initFullPlayer() {
  root = h(`<div class="fp" aria-hidden="true">
    <header class="fp__top">
      <button class="icon-btn" data-close aria-label="close">${icon('down')}</button>
      <div class="fp__kicker"></div>
      <button class="icon-btn" data-more aria-label="more">${icon('more')}</button>
    </header>
    <div class="fp__stage"><div class="scrub" aria-hidden="true"><b class="scrub__time"></b><span class="scrub__delta"></span></div></div>
    <div class="fp__info">
      <div class="fp__titles"><div class="fp__title"></div><button class="fp__artist"></button></div>
      <button class="icon-btn fp__like" data-like aria-label="like">${icon('heart')}</button>
    </div>
    <div class="progress">
      <div class="progress__bar"><div class="progress__fill"></div><div class="progress__thumb"><div class="progress__knob"></div></div></div>
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
      <button class="pill pill--icon" data-eq aria-label="equalizer">${icon('eq')}</button>
    </div>
  </div>`);
  document.body.append(root);
  stage = root.querySelector('.fp__stage');
  bubble = root.querySelector('.scrub');
  el = { bar: root.querySelector('.progress__bar'), cur: root.querySelector('[data-cur]'), dur: root.querySelector('[data-dur]'),
    play: root.querySelector('[data-play]'), title: root.querySelector('.fp__title'), artist: root.querySelector('.fp__artist') };

  const $ = (s) => root.querySelector(s);
  $('[data-close]').addEventListener('click', closePlayer);
  $('.fp__artist').addEventListener('click', () => openArtist(player.current));
  $('[data-play]').addEventListener('click', () => { haptic('medium'); player.toggle(); });
  $('[data-next]').addEventListener('click', () => { haptic('light'); player.next(); });
  $('[data-prev]').addEventListener('click', () => { haptic('light'); player.prev(); });
  $('[data-shuffle]').addEventListener('click', () => { haptic('select'); player.toggleShuffle(); });
  $('[data-repeat]').addEventListener('click', () => { haptic('select'); player.cycleRepeat(); });
  $('[data-more]').addEventListener('click', () => player.current && trackMenu(player.current).then(syncLike));
  $('[data-eq]').addEventListener('click', () => { haptic('light'); openEqualizer(); });
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
  setupIdle();

  player.addEventListener('track', (e) => onTrack(e.detail));
  player.addEventListener('state', syncState);
  player.addEventListener('time', syncTime);
  player.addEventListener('modes', syncModes);
  document.addEventListener('likes-changed', syncLike);
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
  clearTimeout(closeTimer);
  initSfx(); // opened by a tap: the one moment iOS lets audio start
  rec?.el.getAnimations().forEach((a) => a.cancel()); // a record that flew back into the mini player
  const fromMini = miniCoverRect();
  root.classList.add('is-open');
  root.setAttribute('aria-hidden', 'false');
  if (!rec || rec.track?.id !== player.current.id) placeRecord(player.current);
  if (fromMini) fly(fromMini, true).then(syncState);
  syncState();
  syncTime();
  syncModes();
  armIdle();
  document.dispatchEvent(new CustomEvent('player-open', { detail: true }));
}

export function closePlayer() {
  open = false;
  wake();
  syncSpinNoise();
  rec?.el.getAnimations().forEach((a) => a.cancel()); // closed mid-flight: measure the record where it really stands
  const toMini = miniCoverRect();
  if (toMini) fly(toMini, false);
  root.classList.remove('is-open');
  root.setAttribute('aria-hidden', 'true');
  // stop the record once the slide-down has finished: nobody sees it spin
  closeTimer = setTimeout(() => { if (!open && rec) { cancelAnimationFrame(rec.raf); rec.rate = 0; rec.anim.pause(); } }, 450);
  document.dispatchEvent(new CustomEvent('player-open', { detail: false }));
}

function miniCoverRect() {
  const r = document.querySelector('#mini .mini__cover')?.getBoundingClientRect();
  return r?.width && !reducedMotion() ? r : null;
}

/** The record grows out of the mini player's cover (or shrinks back into it) while the player fades. */
function fly(miniRect, opening) {
  if (!rec) return Promise.resolve();
  const box = rec.el.getBoundingClientRect(); // includes the player's own slide at this moment
  const endLift = opening ? 0 : root.offsetHeight * 0.06; // closing: the player itself sinks by 6% meanwhile
  const dx = miniRect.left + miniRect.width / 2 - (box.left + box.width / 2);
  const dy = miniRect.top + miniRect.height / 2 - (box.top + box.height / 2) - endLift;
  const small = { transform: `translate(${dx}px, ${dy}px) scale(${miniRect.width / box.width})`, opacity: opening ? 0.6 : 0 };
  const full = { transform: 'none', opacity: 1 };
  const anim = rec.el.animate(opening ? [small, full] : [full, small],
    { duration: opening ? 600 : 460, easing: EASE_IO, fill: opening ? 'none' : 'forwards' });
  return anim.finished.catch(() => {});
}

function clearRecords() {
  stage.querySelectorAll('.record').forEach((r) => r.remove());
}

function placeRecord(track) {
  clearRecords();
  rec = makeRecord(track);
  stage.append(rec.el);
}

function onTrack({ track, dir }) {
  syncInfo();
  syncLike();
  syncTime();
  if (!open) { rec = null; clearRecords(); return; } // openPlayer builds the record when it is needed
  if (!rec) { placeRecord(track); return; }
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
  el.title.textContent = tr?.title || t('player_nothing');
  el.artist.textContent = tr?.artist || '';
}

function syncLike() {
  const liked = !!player.current && likes.has(player.current.id);
  const btn = root.querySelector('[data-like]');
  btn.innerHTML = icon(liked ? 'heartFill' : 'heart');
  btn.classList.toggle('is-on', liked);
}

let shownPlaying = null;

/** The quiet crackle of a spinning record while the track is still loading. */
function syncSpinNoise() {
  const want = open && player.loading && !!player.current;
  if (want && !stopSpinNoise) stopSpinNoise = startSpinNoise();
  else if (!want && stopSpinNoise) { stopSpinNoise(); stopSpinNoise = null; }
}

function syncState() {
  if (!open || scrubbing) return; // while scrubbing the hand, not the player, drives the record
  syncSpinNoise();
  if (shownPlaying !== player.playing) {
    shownPlaying = player.playing;
    el.play.innerHTML = icon(player.playing ? 'pause' : 'play');
  }
  root.classList.toggle('is-loading', player.loading);
  if (!player.playing || player.loading) wake(); else armIdle();
  if (!rec || rec.el.getAnimations().some((a) => a.playState === 'running' && a !== rec.anim)) return;
  const spinning = player.playing && !player.loading;
  rampTo(rec, spinning ? 1 : player.loading ? 0.3 : 0, spinning ? 900 : 700); // turns slowly while loading
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function syncTime() {
  if (!open) return;
  const d = player.duration, c = player.time;
  if (!dragging) el.bar.style.setProperty('--p', d ? Math.min(1, c / d) : 0);
  setText(el.cur, fmt(dragging ? dragValue * d : c));
  setText(el.dur, fmt(d));
}

function syncModes() {
  root.querySelector('[data-shuffle]').classList.toggle('is-on', player.shuffle);
  const rep = root.querySelector('[data-repeat]');
  rep.classList.toggle('is-on', player.repeat !== 'off');
  rep.innerHTML = icon(player.repeat === 'one' ? 'repeat1' : 'repeat');
}

// ---------- idle: after a while only the spinning record stays, centred ----------

// ?musique_idle=3 shortens the wait to 3 s for testing
const IDLE_MS = (Number(new URLSearchParams(location.search).get('musique_idle')) || 20) * 1000;
let idleTimer = 0, idle = false;

function armIdle() {
  clearTimeout(idleTimer);
  if (open && !idle && player.playing && !player.loading) idleTimer = setTimeout(enterIdle, IDLE_MS);
}

function enterIdle() {
  if (!open || !player.playing || player.loading || dragging) return;
  // move the stage so the record sits in the middle of the screen, slightly larger
  const r = stage.getBoundingClientRect();
  const size = rec?.el.offsetWidth || r.width;
  root.style.setProperty('--idle-dy', `${Math.round(innerHeight / 2 - (r.top + r.height / 2))}px`);
  root.style.setProperty('--idle-scale', Math.min(1.16, (innerWidth * 0.94) / size).toFixed(3));
  idle = true;
  root.classList.add('is-idle');
}

function wake() {
  clearTimeout(idleTimer);
  if (idle) {
    idle = false;
    root.classList.remove('is-idle');
  }
  armIdle();
}

function setupIdle() {
  // the first touch while idle only brings the interface back: it must not pause or skip
  let swallowClick = false;
  root.addEventListener('pointerdown', (e) => {
    if (idle) {
      e.stopPropagation();
      e.preventDefault();
      swallowClick = true;
      wake();
      return;
    }
    armIdle();
  }, true);
  root.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  root.addEventListener('pointermove', () => { if (!idle) armIdle(); }, { passive: true });
  document.addEventListener('keydown', () => { if (open) wake(); });
}

// ---------- seeking ----------

let dragging = false, dragValue = 0;

function setupSeek(bar) {
  const progress = bar.parentElement;
  let rect = null; // measured once per drag: reading layout on every move forces a reflow
  const valueAt = (e) => Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    rect = bar.getBoundingClientRect();
    bar.setPointerCapture(e.pointerId);
    dragValue = valueAt(e);
    progress.classList.add('is-drag');
    bar.style.setProperty('--p', dragValue);
    syncTime();
  });
  bar.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dragValue = valueAt(e);
    bar.style.setProperty('--p', dragValue);
    syncTime();
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    progress.classList.remove('is-drag');
    const target = dragValue * player.duration;
    if (Math.abs(target - player.time) > 3) whoosh(target > player.time);
    player.seek(target);
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
}

// ---------- press and hold the record, then turn it to rewind or fast-forward ----------

let scrub = null;

function angleAt(x, y) {
  return (Math.atan2(y - scrub.cy, x - scrub.cx) * 180) / Math.PI;
}

function beginScrub(x, y) {
  // not while a record is still flying in
  if (!rec || !player.current || !player.duration || rec.el.getAnimations().some((a) => a.playState === 'running')) return;
  const r = rec.el.getBoundingClientRect();
  scrub = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: r.width / 2, turns: 0, start: player.time,
    target: player.time, wasPlaying: player.playing, lastT: performance.now(), anim0: Number(rec.anim.currentTime) || 0,
    step: Math.floor(player.time / 5), quiet: 0, sound: startScratch() };
  scrub.last = angleAt(x, y);
  scrubbing = true;
  cancelAnimationFrame(rec.raf); // the record stops under the hand
  rec.rate = 0;
  rec.anim.pause();
  if (scrub.wasPlaying) player.audio.pause();
  haptic('medium');
  root.classList.add('is-scrubbing');
  showBubble();
}

function moveScrub(e) {
  const dx = e.clientX - scrub.cx, dy = e.clientY - scrub.cy;
  if (Math.hypot(dx, dy) < scrub.radius * 0.15) return; // too close to the spindle: the angle jumps around
  const a = angleAt(e.clientX, e.clientY);
  let d = a - scrub.last;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  scrub.last = a;
  scrub.turns += d / 360; // clockwise (the way the record plays) is forward
  const now = performance.now();
  scrub.sound?.update(d / 360 / (Math.max(8, now - scrub.lastT) / 1000));
  scrub.lastT = now;
  clearTimeout(scrub.quiet);
  scrub.quiet = setTimeout(() => scrub?.sound?.update(0), 70); // the finger stopped: so does the sound
  rec.anim.currentTime = (((scrub.anim0 + scrub.turns * RPM_MS) % RPM_MS) + RPM_MS) % RPM_MS; // the record follows the finger
  scrub.target = Math.min(Math.max(0, scrub.start + scrub.turns * SECONDS_PER_TURN), Math.max(0, player.duration - 1));
  const step = Math.floor(scrub.target / 5);
  if (step !== scrub.step) { scrub.step = step; haptic('select'); }
  showBubble();
}

function endScrub() {
  const s = scrub;
  scrub = null;
  scrubbing = false;
  clearTimeout(s.quiet);
  s.sound?.stop();
  root.classList.remove('is-scrubbing');
  player.seek(s.target);
  rec?.anim.play();
  if (s.wasPlaying) player.audio.play().catch(() => {});
  syncState();
  syncTime();
}

function showBubble() {
  const delta = Math.round(scrub.target - scrub.start);
  bubble.querySelector('.scrub__time').textContent = fmt(scrub.target);
  bubble.querySelector('.scrub__delta').textContent = delta ? `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))}` : '';
}

// ---------- swipe the record to change tracks, tap to pause ----------

function setupGestures() {
  let x0 = null, y0 = 0, dx = 0, moved = false, holdTimer = 0;
  stage.addEventListener('pointerdown', (e) => {
    if (!rec) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; moved = false;
    stage.setPointerCapture(e.pointerId);
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => beginScrub(x0, y0), 300); // a finger that stays put grabs the record
  });
  stage.addEventListener('pointermove', (e) => {
    if (x0 === null || !rec) return;
    if (scrub) { moveScrub(e); return; }
    dx = e.clientX - x0;
    if (Math.hypot(dx, e.clientY - y0) > 8) clearTimeout(holdTimer); // moving right away: a swipe, not a hold
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - y0)) moved = true;
    if (moved) rec.el.style.transform = `translateX(${dx * 0.7}px) rotate(${dx * 0.08}deg)`;
  });
  const end = () => {
    clearTimeout(holdTimer);
    if (x0 === null || !rec) return;
    x0 = null;
    if (scrub) { endScrub(); return; }
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
