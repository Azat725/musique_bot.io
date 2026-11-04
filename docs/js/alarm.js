import { t } from './i18n.js';
import { player } from './player.js';
import { receiver, stationName, stations, tune } from './radio.js';
import { settings, updateSettings } from './store.js';
import { esc, h, haptic, sheet } from './ui.js';

/** The radio's alarm clock: at the chosen time the chosen station comes on, softly at first. It is kept on this device
 *  (the setting stays out of the account's look) and it only rings while Musique is open: a closed page cannot wake anyone,
 *  and the settings say so. The screen may be off if music is playing; if the browser will not start the sound on its
 *  own, the alarm asks for one tap. */

const LATE = 3 * 60000; // a phone that slept through the minute still rings, for three minutes after it
const SNOOZE = 10 * 60000;
const FADE_MS = 40000;
const LAST_KEY = 'musique.alarm-last';

export const alarmOf = () => ({ on: false, time: '07:30', station: '', ...(settings.radioAlarm || {}) });

/** The day and time an alarm is due, as one key: it rings once for each. */
const keyOf = (now, alarm) => `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${alarm.time}`;

/** Is the alarm due at `now`: on, the minute has come (or came less than three minutes ago) and it has not rung for it yet. */
export function shouldRing(alarm, now, last = '') {
  if (!alarm.on || !/^\d\d:\d\d$/.test(alarm.time)) return false;
  const [hh, mm] = alarm.time.split(':').map(Number);
  const late = now - new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);
  return late >= 0 && late <= LATE && last !== keyOf(now, alarm);
}

let last = '', snoozeAt = 0, fadeTimer = 0, ringing = false;
try { last = localStorage.getItem(LAST_KEY) || ''; } catch { /* private mode */ }

/** Ring now if it is time (`now` is for the tests). */
export function checkAlarm(now = new Date()) {
  if (ringing) return false;
  if (snoozeAt && now.getTime() >= snoozeAt) { snoozeAt = 0; ring(now); return true; }
  const alarm = alarmOf();
  if (!shouldRing(alarm, now, last)) return false;
  last = keyOf(now, alarm);
  try { localStorage.setItem(LAST_KEY, last); } catch { /* not kept: at worst it rings again after a reload */ }
  ring(now);
  return true;
}

/** The sound comes up over forty seconds (where the page may set the volume: not on iPhone). */
function fadeIn() {
  clearInterval(fadeTimer);
  const a = player.audio, target = player.baseVolume ?? 1, t0 = performance.now();
  a.volume = target * 0.05;
  fadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / FADE_MS);
    a.volume = target * (0.05 + 0.95 * k);
    if (k >= 1 || !player.playing) { clearInterval(fadeTimer); a.volume = target; }
  }, 500);
}

async function ring(now) {
  ringing = true;
  try {
    const alarm = alarmOf(), r = receiver(), station = stations(r).includes(alarm.station) ? alarm.station : r.country;
    haptic('heavy');
    await tune(station);
    fadeIn();
    await new Promise((done) => setTimeout(done, 1500));
    const silent = !player.playing; // the browser did not start the sound without a touch
    const items = [...(silent ? [{ icon: 'play', label: t('alarm_start') }] : []), { icon: 'clock', label: t('alarm_snooze') }, { icon: 'close', label: t('alarm_stop'), danger: true }];
    const i = await sheet({ title: esc(t('alarm_ring_t', { time: alarmOf().time })), content: h(`<p class="alarm__says">${esc(t('alarm_ring_s', { station: stationName(station, r) }))}</p>`), items, closeLabel: t('alarm_listen') });
    const pick = i === null ? null : items[i].icon;
    if (pick === 'play') { if (!player.playing) player.toggle(); fadeIn(); }
    else if (pick === 'clock') { clearInterval(fadeTimer); if (player.playing) player.toggle(); snoozeAt = Date.now() + SNOOZE; }
    else if (pick === 'close') { clearInterval(fadeTimer); player.audio.volume = player.baseVolume ?? 1; if (player.playing) player.toggle(); }
  } finally { ringing = false; }
}

const timeLabel = (a) => (a.on ? `${a.time} · ${stationName(stations().includes(a.station) ? a.station : receiver().country)}` : t('alarm_off'));
/** The alarm in a few words, for a settings row. */
export const alarmHint = () => timeLabel(alarmOf());

/** The alarm's own sheet: on or off, the time, the station. Every change is kept at once. */
export function openAlarm() {
  const a = alarmOf(), r = receiver();
  const content = h(`<div class="alarm"><div class="group__card">
    <label class="group__item"><span class="group__text"><span class="group__name">${esc(t('alarm_on'))}</span></span><input type="checkbox" class="switch" data-alarm="on" ${a.on ? 'checked' : ''}></label>
    <label class="group__item"><span class="group__text"><span class="group__name">${esc(t('alarm_time'))}</span></span><input type="time" class="alarm__field" data-alarm="time" value="${esc(a.time)}"></label>
    <label class="group__item"><span class="group__text"><span class="group__name">${esc(t('alarm_station'))}</span></span>
      <select class="alarm__field" data-alarm="station">${stations(r).map((s) => `<option value="${s}" ${s === (stations(r).includes(a.station) ? a.station : r.country) ? 'selected' : ''}>${esc(stationName(s, r))}</option>`).join('')}</select></label>
  </div><p class="group__note">${esc(t('alarm_hint'))}</p></div>`);
  content.addEventListener('change', (e) => {
    const key = e.target.dataset.alarm;
    if (!key) return;
    haptic('select');
    const value = key === 'on' ? e.target.checked : e.target.value;
    if (key === 'time' && !/^\d\d:\d\d$/.test(value)) return;
    updateSettings({ radioAlarm: { ...alarmOf(), [key]: value } });
  });
  return sheet({ title: esc(t('alarm_title')), content, done: true });
}

if (typeof document !== 'undefined') {
  setInterval(() => checkAlarm(), 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkAlarm(); });
  addEventListener('focus', () => checkAlarm());
}
