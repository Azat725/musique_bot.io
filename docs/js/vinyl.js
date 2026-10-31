import { t } from './i18n.js';
import { player } from './player.js';
import { heard, heardReady, likes, onSettings, settings, toggleLike, updateSettings } from './store.js';
import { EASE_IO, chooseAndAddToPlaylist, esc, fitMarquee, fmt, h, haptic, icon, openArtist, reducedMotion, sheet, toast, trackMenu } from './ui.js';
import { api } from './api.js';
import { openControlPanel } from './eq.js';
import { initSfx, playSfx, rustle, startScratch, startSpinNoise, whoosh } from './sfx.js';
import { openQueue } from './queue.js';
import { SLEEP_OPTIONS, setSleep, sleepLeft, sleepMode, sleepTimer } from './sleep.js';

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
      <div class="fp__head"><div class="fp__kicker"></div><button class="fp__marker" hidden></button></div>
      <div class="fp__end">
        <button class="icon-btn" data-queue aria-label="queue">${icon('queue')}</button>
        <button class="icon-btn" data-more aria-label="more">${icon('more')}</button>
      </div>
    </header>
    <div class="fp__stage">
      <div class="deck" aria-hidden="true">
        <div class="deck__plinth"><span class="deck__light"></span><span class="deck__knob"></span><span class="deck__speed">33</span></div>
        <div class="deck__platter"></div>
        <div class="deck__arm"><span class="arm__weight"></span><span class="arm__tube"></span><span class="arm__head"></span><span class="arm__base"></span></div>
      </div>
      <div class="scrub" aria-hidden="true"><b class="scrub__time"></b><span class="scrub__delta"></span></div>
    </div>
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
      <button class="pill" data-lyrics hidden>${icon('lyrics')}<span></span></button>
      <button class="pill pill--icon" data-eq aria-label="${esc(t('panel_title'))}">${icon('eq')}</button>
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
  $('[data-more]').addEventListener('click', () => {
    if (!player.current) return;
    trackMenu(player.current, { player: { sleep: sleepLabel() } }).then((r) => {
      if (r === 'sleep') openSleep();
      syncLike();
    });
  });
  $('[data-queue]').addEventListener('click', openQueue);
  $('.fp__marker').addEventListener('click', () => (sleepMode() ? openSleep() : openControlPanel()));
  $('[data-eq]').addEventListener('click', () => { haptic('light'); openControlPanel(); });
  $('[data-add]').addEventListener('click', () => player.current && chooseAndAddToPlaylist(player.current).catch(() => toast(t('toast_error'), 'error')));
  $('[data-send]').addEventListener('click', async () => {
    if (!player.current) return;
    try { await api.send(player.current); toast(t('toast_sending'), 'send'); } catch { toast(t('toast_error'), 'error'); }
  });
  $('[data-lyrics]').addEventListener('click', openLyrics);
  $('[data-like]').addEventListener('click', async () => {
    if (!player.current) return;
    haptic('light');
    try {
      await toggleLike(player.current);
      document.dispatchEvent(new CustomEvent('likes-changed'));
    } catch { toast(t('toast_error'), 'error'); }
    syncLike();
  });

  setupSeek($('.progress__bar'));
  setupGestures();
  setupIdle();
  applyMode();
  let idleSeen = settings.idleDelay;
  onSettings(() => {
    applyMode();
    syncSpeed();
    if (settings.idleDelay !== idleSeen) { idleSeen = settings.idleDelay; wake(); }
  });

  player.addEventListener('track', (e) => onTrack(e.detail));
  player.addEventListener('state', syncState);
  player.addEventListener('state', syncMarker);
  player.addEventListener('time', syncTime);
  player.addEventListener('modes', syncModes);
  document.addEventListener('likes-changed', syncLike);
  sleepTimer.addEventListener('change', syncMarker);
  sleepTimer.addEventListener('tick', syncMarker);
  translate();
  syncSpeed();
}

export function translate() {
  if (!root) return;
  root.querySelector('.fp__kicker').textContent = t('player_now');
  root.querySelector('[data-add] span').textContent = t('pill_playlist');
  root.querySelector('[data-send] span').textContent = t('pill_send');
  root.querySelector('[data-lyrics] span').textContent = t('pill_lyrics');
  syncInfo();
  syncMarker();
}

// ---------- sleep timer and 33 / 45: menu items, and a marker under "Now playing" while either is on ----------

function sleepLabel() {
  const m = sleepMode();
  if (!m) return t('sleep_menu_off');
  return t('sleep_menu_on', { v: m === 'track' ? t('sleep_track_short') : fmt(sleepLeft()) });
}

async function openSleep() {
  const m = sleepMode();
  const opts = [...SLEEP_OPTIONS, ...(m ? [null] : [])];
  const items = opts.map((o) => ({
    icon: o === null ? 'close' : o === m ? 'check' : o === 'track' ? 'vinyl' : 'clock',
    label: o === null ? t('sleep_off') : o === 'track' ? t('sleep_track') : t('sleep_min', { n: o }),
    danger: o === null,
  }));
  const i = await sheet({ title: esc(t('sleep_title')), items });
  if (i === null) return;
  haptic('select');
  setSleep(opts[i]);
  if (opts[i]) toast(opts[i] === 'track' ? t('sleep_set_track') : t('sleep_set', { n: opts[i] }), 'done');
}

// ---------- the sound: speed and reverb are set in the control panel (eq.js); the marker names what is on ----------

const DECK_RPM = { slow: '28', normal: '33', fast: '45' }; // slowed: 33⅓ × 0.85 ≈ 28

/** What the current sound is called: "slowed + reverb", "45 rpm", "reverb"… or '' when it is plain. */
function soundTag() {
  const slow = settings.speed === 'slow', reverb = settings.reverb !== 'off';
  if (slow && reverb) return t('sound_slowrev');
  return [slow ? t('sound_slow_tag') : settings.speed === 'fast' ? t('sound_fast_tag') : '', reverb ? t('sound_reverb_tag') : '']
    .filter(Boolean).join(' · ');
}

function syncSpeed() {
  if (!root) return;
  root.querySelector('.deck__speed').textContent = DECK_RPM[settings.speed] || '33';
  syncMarker();
  syncState(); // the record speeds up or slows down to the new rate
}

function syncMarker() {
  const btn = root?.querySelector('.fp__marker');
  if (!btn) return;
  const m = sleepMode();
  const parts = [];
  // a first play with an effect waits for the server to render it: say so instead of a silent pause
  const preparing = player.loading && player.fx !== 'normal-off' && !!player.current;
  btn.classList.toggle('is-busy', preparing);
  if (preparing) parts.push(`<span>${esc(t('fx_preparing'))}</span>`);
  if (m) parts.push(`${icon('moon')}<span>${esc(m === 'track' ? t('sleep_track_short') : fmt(sleepLeft()))}</span>`);
  const tag = soundTag();
  if (tag && !preparing) parts.push(`<span>${esc(tag)}</span>`);
  btn.hidden = !parts.length;
  const html = parts.join('<i>·</i>');
  if (btn.innerHTML !== html) btn.innerHTML = html;
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
  // a first listen opens in its sleeve; otherwise the record flies out of the mini player
  if (takeSleeve(player.current)) unsleeve(++swapping, 200);
  else if (fromMini) fly(fromMini, true).then(syncState);
  syncState();
  syncTime();
  syncModes();
  fitMarquee(el.title); // measured now that the player has its real width
  syncLyrics();
  armIdle();
  document.dispatchEvent(new CustomEvent('player-open', { detail: true }));
}

export function closePlayer() {
  open = false;
  armLifted = false;
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
  stage.querySelectorAll('.record, .sleeve').forEach((r) => r.remove());
}

function placeRecord(track) {
  clearRecords();
  rec = makeRecord(track);
  stage.append(rec.el);
}

function onTrack({ track, dir }) {
  notePending(track);
  syncInfo();
  syncLike();
  syncTime();
  syncLyrics();
  if (!open) { rec = null; clearRecords(); return; } // openPlayer builds the record when it is needed
  if (!rec) { placeRecord(track); if (takeSleeve(track)) unsleeve(++swapping); return; }
  if (rec.track?.id === track.id) return;
  swapRecord(track, dir < 0 ? -1 : 1, takeSleeve(track));
}

function swapRecord(track, dir, sleeved = false) {
  const my = ++swapping;
  // finish any half-done swap immediately
  stage.querySelectorAll('.record.is-leaving, .sleeve').forEach((el) => el.remove());

  const old = rec;
  armLifted = true; // the arm swings off before the record is taken away
  syncArm();
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
  if (sleeved) { unsleeve(my, 220); return; } // a new record comes out of its sleeve instead of sliding in
  rec.el.animate([
    { transform: `translateX(${dir * 125}%) rotate(${dir * 40}deg) scale(.86)`, opacity: 0 },
    { transform: 'translateX(0) rotate(0deg) scale(1)', opacity: 1 },
  ], { duration: 620, delay: 160, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' }).finished
    .then(() => {
      if (my !== swapping) return;
      playSfx('needle', 0.6);
      armLifted = false; // and drops back onto the new one with the needle sound
      syncState();
    }).catch(() => { if (my === swapping) { armLifted = false; syncArm(); } });
}

// ---------- sleeve: a track heard for the first time comes out of its sleeve ----------

const pendingSleeve = new Set(); // the current track, if it is new and its sleeve has not been opened yet

function notePending(track) {
  pendingSleeve.clear(); // a sleeve nobody opened before the next track simply stays closed
  if (settings.sleeve && heardReady && track && !heard.has(track.id) && !reducedMotion()) pendingSleeve.add(track.id);
}

function takeSleeve(track) {
  if (!track || !pendingSleeve.has(track.id)) return false;
  pendingSleeve.delete(track.id);
  return true;
}

const SLEEVE_MS = 1900;
const IO = 'cubic-bezier(.65, 0, .35, 1)';

/** The sleeve rises with the cover on it, the record is drawn out of its open side, the sleeve is put away. */
function unsleeve(my, delay = 0) {
  const r = rec;
  if (!r) return;
  stage.querySelectorAll('.sleeve').forEach((s) => s.remove());
  const tr = r.track;
  const sleeve = h(`<div class="sleeve" aria-hidden="true">
    ${tr?.cover ? `<img src="${esc(tr.cover)}" alt="" referrerpolicy="no-referrer">` : '<span class="sleeve__brand">Musique</span>'}
    <span class="sleeve__slot"></span>
  </div>`);
  stage.append(sleeve); // after the record, so it covers it
  armLifted = true; // the arm waits until the record lies on the platter
  syncArm();
  const kicker = root.querySelector('.fp__kicker');
  kicker.textContent = t('player_new');
  const opts = { duration: SLEEVE_MS, delay, fill: 'both' };
  sleeve.animate([
    { offset: 0, transform: 'translateY(55%) scale(.88) rotate(5deg)', opacity: 0, easing: IO },
    { offset: 0.24, transform: 'translateY(0) scale(.88) rotate(0deg)', opacity: 1 },
    { offset: 0.32, transform: 'translateY(0) scale(.88) rotate(0deg)', opacity: 1, easing: IO },
    { offset: 0.62, transform: 'translateX(-10%) scale(.88) rotate(-3deg)', opacity: 1, easing: 'cubic-bezier(.55, 0, .8, .3)' },
    { offset: 1, transform: 'translate(-70%, 30%) scale(.88) rotate(-14deg)', opacity: 0 },
  ], opts);
  // the record waits hidden behind the sleeve, slides half out to the right, then settles in the middle
  const anim = r.el.animate([
    { offset: 0, transform: 'translateX(0) scale(.84)', opacity: 0 },
    { offset: 0.2, transform: 'translateX(0) scale(.84)', opacity: 0 },
    { offset: 0.21, transform: 'translateX(0) scale(.84)', opacity: 1 },
    { offset: 0.32, transform: 'translateX(0) scale(.84) rotate(0deg)', opacity: 1, easing: IO },
    { offset: 0.62, transform: 'translateX(44%) scale(.84) rotate(70deg)', opacity: 1, easing: IO },
    { offset: 1, transform: 'translateX(0) scale(1) rotate(0deg)', opacity: 1 },
  ], { ...opts, fill: 'backwards' });
  setTimeout(() => { if (my === swapping) rustle(); }, delay + SLEEVE_MS * 0.3);
  anim.finished.then(() => {
    sleeve.remove();
    if (my !== swapping) return;
    kicker.textContent = t('player_now');
    playSfx('needle', 0.6);
    armLifted = false;
    syncState();
  }).catch(() => {
    sleeve.remove();
    kicker.textContent = t('player_now');
    if (my === swapping) { armLifted = false; syncArm(); }
  });
}

// ---------- lyrics: the button shows up only for a track that has some ----------

let lyricsSeq = 0, lyricsFound = null;

function syncLyrics() {
  const btn = root.querySelector('[data-lyrics]');
  const tr = player.current;
  const my = ++lyricsSeq; // an answer for a track already gone must not show the button
  if (lyricsFound?.track.id !== tr?.id) { btn.hidden = true; lyricsFound = null; }
  if (!tr || !open) return; // asked again when the player opens
  api.lyrics(tr).then((r) => {
    if (my !== lyricsSeq || !r?.lyrics) return;
    lyricsFound = { track: tr, text: r.lyrics, source: r.source, synced: r.synced?.length ? r.synced : null };
    btn.hidden = false;
  }).catch(() => {});
}

function openLyrics() {
  if (!lyricsFound) return;
  haptic('light');
  const { track, text, source, synced } = lyricsFound;
  const body = synced
    ? `<div class="lyrics__lines">${synced.map(([, line], i) => (line
      ? `<p class="lyrics__line" data-i="${i}">${esc(line)}</p>` : '<p class="lyrics__gap"></p>')).join('')}</div>`
    : `<p class="lyrics__text">${esc(text)}</p>`;
  const content = h(`<div class="lyrics ${synced ? 'lyrics--synced' : ''}">
    <div class="sheet__head"><div class="lyrics__title">${esc(track.title)}</div><div class="lyrics__artist">${esc(track.artist)}</div></div>
    <div class="sheet__scroll">${body}
      ${source ? `<p class="lyrics__source">${esc(t('lyrics_source', { s: source }))}</p>` : ''}</div>
  </div>`);
  const stop = synced ? followLyrics(content, track, synced) : null;
  sheet({ content, swipe: true, closeLabel: t('close'), cls: 'sheet--lyrics' }).then(() => stop?.());
}

const LYRICS_LEAD_MS = 250; // a line lights up a moment early: it reads as on time
const LYRICS_HANDS_OFF_MS = 4000; // after the reader scrolls, the text stays where they left it this long

/** Light up the line being sung and keep it in the middle; tap a line to jump there. Returns the cleanup. */
function followLyrics(content, track, synced) {
  const scroller = content.querySelector('.sheet__scroll');
  const lines = [...content.querySelectorAll('.lyrics__line')];
  const starts = lines.map((p) => synced[Number(p.dataset.i)][0]);
  let active = -1, handsOffUntil = 0, first = true;
  const hands = () => { handsOffUntil = performance.now() + LYRICS_HANDS_OFF_MS; };
  scroller.addEventListener('touchstart', hands, { passive: true });
  scroller.addEventListener('wheel', hands, { passive: true });
  scroller.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') hands(); });
  scroller.addEventListener('click', (e) => {
    const p = e.target.closest('.lyrics__line');
    if (!p || player.current?.id !== track.id) return;
    haptic('select');
    handsOffUntil = 0;
    player.seek(starts[lines.indexOf(p)] / 1000 / player.rate);
    if (!player.playing) player.toggle();
  });
  const sync = () => {
    // the file may be slowed or sped up: its time times the rate is the song's own
    const ms = player.current?.id === track.id ? player.time * player.rate * 1000 + LYRICS_LEAD_MS : -1;
    let lo = 0, hi = starts.length - 1, at = -1; // the last line that has started
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= ms) { at = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (at === active) return;
    lines[active]?.classList.remove('is-active');
    active = at;
    const p = lines[at];
    if (!p) return;
    p.classList.add('is-active');
    if (performance.now() < handsOffUntil) return;
    const top = p.offsetTop - scroller.clientHeight / 2 + p.offsetHeight / 2;
    scroller.scrollTo({ top: Math.max(0, top), behavior: first || reducedMotion() ? 'auto' : 'smooth' });
    first = false;
  };
  requestAnimationFrame(sync); // once the sheet has its size
  player.addEventListener('time', sync);
  return () => player.removeEventListener('time', sync);
}

// ---------- turntable mode: the record lies on a platter, a tonearm plays it ----------

const ARM_REST = 8, ARM_START = 34, ARM_END = 46; // degrees: off the record, outer groove, inner groove
let armLifted = false, armShown = '';

function turntable() { return settings.playerMode === 'turntable'; }

function applyMode() {
  if (!root) return;
  const on = turntable();
  if (root.classList.contains('is-turntable') === on) return;
  root.classList.toggle('is-turntable', on);
  armShown = '';
  syncArm();
  fitMarquee(el.title);
}

/** The arm rests beside the record unless the music really plays; on the record it creeps inwards with the track. */
function syncArm() {
  if (!root || !turntable()) return;
  const down = open && player.playing && !player.loading && !scrubbing && !armLifted;
  const p = player.duration ? Math.min(1, player.time / player.duration) : 0;
  const angle = down ? ARM_START + (ARM_END - ARM_START) * p : ARM_REST;
  const value = `${angle.toFixed(1)}deg`;
  if (value === armShown) return;
  armShown = value;
  root.style.setProperty('--arm', value);
  root.classList.toggle('is-arm-down', down);
}

// ---------- sync ----------

function syncInfo() {
  const tr = player.current;
  el.title.innerHTML = `<span class="marquee">${esc(tr?.title || t('player_nothing'))}</span>`;
  el.artist.textContent = tr?.artist || '';
  fitMarquee(el.title);
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
  syncArm();
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
  rampTo(rec, spinning ? player.rate : player.loading ? 0.3 : 0, spinning ? 900 : 700); // turns slowly while loading
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
  syncArm();
}

function syncModes() {
  root.querySelector('[data-shuffle]').classList.toggle('is-on', player.shuffle);
  const rep = root.querySelector('[data-repeat]');
  rep.classList.toggle('is-on', player.repeat !== 'off');
  rep.innerHTML = icon(player.repeat === 'one' ? 'repeat1' : 'repeat');
}

// ---------- idle: after a while only the spinning record stays, centred ----------

// the wait is a setting (0 = never); ?musique_idle=3 shortens it to 3 s for testing
const IDLE_TEST = Number(new URLSearchParams(location.search).get('musique_idle')) || 0;
const idleMs = () => (IDLE_TEST || Number(settings.idleDelay) || 0) * 1000;
let idleTimer = 0, idle = false;

function armIdle() {
  clearTimeout(idleTimer);
  if (open && !idle && idleMs() && player.playing && !player.loading) idleTimer = setTimeout(enterIdle, idleMs());
}

/** Seeking ticks, unless switched off in Settings → Customization. */
function seekHaptic(kind) {
  if (settings.hapticSeek) haptic(kind);
}

function enterIdle() {
  if (!open || !player.playing || player.loading || dragging) return;
  // move the stage so the record sits in the middle of the screen, slightly larger
  const r = stage.getBoundingClientRect();
  const size = (rec?.el.offsetWidth || r.width) * (turntable() ? 1.5 : 1); // the whole turntable must fit
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

const SEEK_STEPS = 40; // a tick every 2.5 % of the bar

function setupSeek(bar) {
  const progress = bar.parentElement;
  let rect = null; // measured once per drag: reading layout on every move forces a reflow
  let step = 0, lastTick = 0;
  const valueAt = (e) => Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  // detents along the bar, a firmer one at both ends; never more often than every 40 ms
  const tick = () => {
    const s = Math.round(dragValue * SEEK_STEPS);
    if (s === step) return;
    step = s;
    const now = performance.now();
    if (now - lastTick < 40) return;
    lastTick = now;
    seekHaptic(s === 0 || s === SEEK_STEPS ? 'medium' : 'select');
  };
  bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    rect = bar.getBoundingClientRect();
    bar.setPointerCapture(e.pointerId);
    dragValue = valueAt(e);
    step = Math.round(dragValue * SEEK_STEPS);
    seekHaptic('light');
    progress.classList.add('is-drag');
    bar.style.setProperty('--p', dragValue);
    syncTime();
  });
  bar.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dragValue = valueAt(e);
    tick();
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
  syncArm(); // the arm lifts off while the record is turned by hand
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
  if (step !== scrub.step) { scrub.step = step; seekHaptic('select'); }
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
