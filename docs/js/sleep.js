import { player } from './player.js';

/** Sleep timer: after N minutes (or at the end of the track) the music fades out and stops.
 *  Checked on every tick of the player and once a second, so it fires with the screen off too,
 *  as long as the audio keeps the page awake. Not kept between launches. */

export const SLEEP_OPTIONS = [15, 30, 45, 60, 90, 'track'];
// ?musique_sleep=1 turns minutes into seconds, for testing
const UNIT = new URLSearchParams(location.search).get('musique_sleep') ? 1000 : 60000;
const FADE_MS = 8000;

export const sleepTimer = new EventTarget(); // 'change' when set, cleared or fired; 'tick' once a second
let mode = null, endsAt = 0, ticker = 0, fading = 0;

export function sleepMode() { return mode; }

/** Seconds left, or null when off or set to the end of the track. */
export function sleepLeft() {
  return typeof mode === 'number' ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : null;
}

export function setSleep(next) {
  stopFade(true);
  clearInterval(ticker);
  mode = next || null;
  player.stopAfter = mode === 'track';
  if (typeof mode === 'number') {
    endsAt = Date.now() + mode * UNIT;
    ticker = setInterval(check, 1000);
  }
  sleepTimer.dispatchEvent(new Event('change'));
}

function check() {
  if (typeof mode !== 'number' || fading) return;
  if (Date.now() >= endsAt) { fadeOut(); return; }
  sleepTimer.dispatchEvent(new Event('tick'));
}

/** iPhone ignores audio.volume (it is read-only there): it simply pauses. */
function fadeOut() {
  clearInterval(ticker);
  const a = player.audio;
  const start = a.volume;
  a.volume = start / 2;
  const canFade = Math.abs(a.volume - start / 2) < 0.01 && player.playing;
  a.volume = start;
  if (!canFade) { finish(); return; }
  const t0 = performance.now();
  fading = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / FADE_MS);
    a.volume = start * (1 - k) ** 2;
    if (k >= 1) finish(start);
  }, 100);
}

function finish(volume) {
  stopFade(false);
  player.audio.pause();
  if (volume !== undefined) player.audio.volume = volume;
  mode = null;
  sleepTimer.dispatchEvent(new Event('change'));
}

function stopFade(restore) {
  if (!fading) return;
  clearInterval(fading);
  fading = 0;
  if (restore) player.audio.volume = 1;
}

player.addEventListener('time', check);
player.addEventListener('stopped', () => { if (mode === 'track') { mode = null; sleepTimer.dispatchEvent(new Event('change')); } });
