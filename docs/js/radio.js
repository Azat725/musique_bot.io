import { api } from './api.js';
import { player } from './player.js';
import { settings, updateSettings } from './store.js';
import { t } from './i18n.js';
import { RECEIVERS, receiverById } from './devices/receivers.js';
import { esc, h, haptic, sheet, toast } from './ui.js';

/** The radio as a time machine: the receiver sets the era and its home country (a Fiat 500 of 1965 plays Italy's
 *  sixties). Its stations are the same decade in seven countries, plus "Your wave" (picked from what you play).
 *  The receiver, not a menu, decides what you hear: one model, one era, countries on its buttons. */

export const COUNTRIES = ['us', 'uk', 'ussr', 'de', 'fr', 'it', 'jp'];
const DEFAULT = { car: 'fiat500', home: 'spidola' };
// where each station sits on the dial: medium wave (kHz) for the sets of the 30s-60s, FM (MHz) for the later ones
const AM = { us: 770, uk: 908, ussr: 548, de: 1017, fr: 1206, it: 846, jp: 594, mine: 1440 };
const FM = { us: 101.1, uk: 98.8, ussr: 104.2, de: 93.6, fr: 95.2, it: 92.4, jp: 80.0, mine: 107.7 };

export const radioKind = () => (settings.playerMode === 'radio-car' ? 'car' : 'home');
export const receiver = (kind = radioKind()) => receiverById(settings[kind === 'car' ? 'radioCar' : 'radioHome']) || receiverById(DEFAULT[kind]);
export const decadeOf = (r = receiver()) => Math.floor(r.year / 10) * 10;
export const stations = (r = receiver()) => [r.country, ...COUNTRIES.filter((c) => c !== r.country), 'mine'];

/** The figure on the dial, and where on the scale (0..1) the needle stands for it. */
export function frequency(id, r = receiver()) {
  if (r.band === 'am') return { text: `${AM[id]}`, unit: t('radio_khz'), at: (AM[id] - 530) / (1610 - 530) };
  return { text: FM[id].toFixed(1), unit: t('radio_mhz'), at: (FM[id] - 76) / (108 - 76) };
}

/** A station's name: the country's radio of that time (after 1991 the Soviet one is Russia's, said as such). */
export function stationName(id, r = receiver()) {
  if (id === 'mine') return t('station_mine');
  if (id === 'ussr' && decadeOf(r) >= 1990) return t('station_ru');
  return t('station_' + id);
}

export const countryName = (c, r = receiver()) => t(c === 'ussr' && decadeOf(r) >= 1990 ? 'country_ru' : 'country_' + c);

/** The drawing of a receiver at any size (Settings, the Garage, Home). */
export const receiverArt = (r) => `<svg class="rx-art" viewBox="0 0 400 ${r.kind === 'car' ? 240 : 300}" aria-hidden="true">${r.art()}</svg>`;

// ---------- on air ----------

let onAirSession = -1; // the player's queue that a station put on: the station stays on air while it plays
export const onAir = () => (player.queueSession === onAirSession && settings.radioStation ? settings.radioStation : null);
const events = new EventTarget(); // 'tuning' (a station is being found), 'tuned', 'failed'
export const radioEvents = events;
let tuning = 0;

/** Tune in a station: its songs (the country's decade, in a fresh order) start playing. */
export async function tune(id = settings.radioStation || receiver().country) {
  const r = receiver();
  if (!stations(r).includes(id)) id = r.country;
  const seq = ++tuning;
  updateSettings({ radioStation: id });
  events.dispatchEvent(new CustomEvent('tuning', { detail: { id } }));
  try {
    const { tracks = [] } = id === 'mine' ? await api.recommend() : await api.radio(id, decadeOf(r));
    if (seq !== tuning) return false; // tuned elsewhere meanwhile
    if (!tracks.length) throw new Error('empty');
    player.playQueue(tracks, 0);
    onAirSession = player.queueSession;
    events.dispatchEvent(new CustomEvent('tuned', { detail: { id } }));
    return true;
  } catch {
    if (seq !== tuning) return false;
    events.dispatchEvent(new CustomEvent('failed', { detail: { id } }));
    toast(t(id === 'mine' ? 'radio_mine_empty' : 'radio_no_match'), 'error');
    return false;
  }
}

/** The next station on the dial (dir 1) or the previous one (-1). */
export function tuneBy(dir) {
  const list = stations();
  const i = list.indexOf(onAir() || settings.radioStation);
  return tune(list[(i + dir + list.length) % list.length]);
}

// ---------- choosing a receiver: the Garage (cars) or the Living room (home sets), by decade ----------

export async function openReceivers(kind = radioKind()) {
  const list = RECEIVERS.filter((r) => r.kind === kind).sort((a, b) => a.year - b.year);
  const current = receiver(kind).id;
  const decades = [...new Set(list.map((r) => decadeOf(r)))];
  const countries = [...new Set(list.map((r) => r.country))];
  const content = h(`<div class="garage"><div class="garage__filter" role="group">${['', ...countries].map((c) => `<button class="chip ${c ? '' : 'is-on'}" data-country="${c}">${esc(c ? t('country_' + c) : t('radio_all_countries'))}</button>`).join('')}</div>${decades.map((d) => `<section class="garage__decade"><h3 class="garage__year">${esc(t('radio_decade_label', { d }))}</h3>
    <div class="garage__row">${list.filter((r) => decadeOf(r) === d).map((r) => `<button class="garage__item ${r.id === current ? 'is-on' : ''}" data-id="${r.id}" data-from="${r.country}" aria-pressed="${r.id === current}">
      <span class="garage__art">${receiverArt(r)}</span><span class="garage__name">${esc(r.name)}</span>
      <span class="garage__meta">${r.year} · ${esc(countryName(r.country, r))} · ${esc(r.unit)}</span></button>`).join('')}</div></section>`).join('')}</div>`);
  content.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-country]');
    if (chip) { // show one country's sets, or all
      haptic('select');
      content.querySelectorAll('[data-country]').forEach((b) => b.classList.toggle('is-on', b === chip));
      content.querySelectorAll('[data-from]').forEach((b) => { b.hidden = !!chip.dataset.country && b.dataset.from !== chip.dataset.country; });
      content.querySelectorAll('.garage__decade').forEach((d) => { d.hidden = !d.querySelector('[data-from]:not([hidden])'); });
      return;
    }
    const item = e.target.closest('[data-id]');
    if (!item) return;
    haptic('select');
    const r = receiverById(item.dataset.id);
    updateSettings({ [kind === 'car' ? 'radioCar' : 'radioHome']: r.id, radioStation: r.country });
    content.closest('.sheet')?.querySelector('.sheet__cancel')?.click();
    if (player.playing && onAir()) tune(r.country); // a new era on air at once
  });
  return sheet({ title: esc(t(kind === 'car' ? 'radio_garage' : 'radio_room')), content, done: true, swipe: true, cls: 'sheet--garage' });
}
