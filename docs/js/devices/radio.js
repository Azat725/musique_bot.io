import { esc, h } from '../ui.js';
import { clack, startCarAmbience, tuneStatic } from '../sfx.js';
import { settings, updateSettings } from '../store.js';
import { frequency, onAir, radioEvents, receiver, receiverArt, stationName, stations, tune, tuneBy } from '../radio.js';
import { spinAnim } from './common.js';
import { glassHTML } from './scenery.js';

/** The radios as a player: the chosen receiver drawn whole (a car's dashboard under its windshield, or a home set on
 *  its shelf) with its dial or display showing the station, its keys and knobs working: the preset keys tune the
 *  stations, the tuning knob moves to the next one, power plays and pauses. In a car the wiper stalk brings the rain
 *  and the ignition key the road. */

let ambience = null, ambienceKey = '', wasPlaying = false;

/** Rain and road sounds: on while a car radio plays with them switched on, faded out otherwise. */
function syncAmbience(playing) {
  wasPlaying = playing;
  const car = settings.playerMode === 'radio-car';
  const key = car && playing && !document.body.classList.contains('drive-open') ? `${settings.radioRain ? 'rain' : ''}${settings.radioRoad ? 'road' : ''}` : '';
  if (key === ambienceKey) return;
  ambience?.();
  ambienceKey = key;
  ambience = key ? startCarAmbience({ rain: settings.radioRain, road: settings.radioRoad }) : null;
}

// the driving game has its own engine and road: the car radio's rain and road step aside while it is open
document.addEventListener('drive-open', () => syncAmbience(wasPlaying));

/** The scale under the needle: kHz or MHz figures across, the needle at the station. */
function dialScale(r) {
  const figures = r.band === 'am' ? ['55', '70', '90', '120', '160'] : ['76', '88', '96', '104', '108'];
  return `<span class="rx-dial__scale">${figures.map((f) => `<i>${f}</i>`).join('')}</span><b class="rx-dial__needle"></b>`;
}

function radio(id, car) {
  let drawn = '';
  const draw = (box) => {
    const r = receiver(car ? 'car' : 'home');
    if (drawn === r.id) return r;
    drawn = r.id;
    const [x, y, w, hgt, type] = r.screen, vh = car ? 240 : 300;
    box.querySelector('.rx__draw').innerHTML = receiverArt(r);
    const glass = box.querySelector('.rx__glass');
    if (glass) glass.innerHTML = glassHTML(r); // the street this car looks at, in its country's style
    const screen = box.querySelector('.rx__screen');
    screen.className = `rx__screen rx__screen--${type.startsWith('lcd') ? 'lcd' : type} ${type.includes('-') ? 'rx__screen--' + type.split('-')[1] : ''}`;
    Object.assign(screen.style, { left: `${x / 4}%`, top: `${(y / vh) * 100}%`, width: `${w / 4}%`, height: `${(hgt / vh) * 100}%` });
    screen.innerHTML = type === 'dial'
      ? `${dialScale(r)}<span class="rx-dial__plate"></span>`
      : `<span class="rx-lcd__top"><b class="rx-lcd__band"></b><b class="rx-lcd__freq"></b></span><span class="rx-lcd__text"><span></span></span>`;
    box.querySelector('.dk').dataset.receiver = r.id;
    return r;
  };
  const display = (box, track) => {
    const r = draw(box);
    const station = onAir() || settings.radioStation || r.country;
    const f = frequency(station, r);
    const title = track ? `${track.artist} — ${track.title}${track.year ? ' · ' + track.year : ''}` : '';
    const dial = box.querySelector('.rx-dial__needle');
    if (dial) {
      dial.style.left = `${Math.min(96, Math.max(4, f.at * 100))}%`;
      box.querySelector('.rx-dial__plate').textContent = stationName(station, r);
    } else {
      box.querySelector('.rx-lcd__band').textContent = r.band === 'am' ? 'AM' : 'FM';
      box.querySelector('.rx-lcd__freq').textContent = `${f.text} ${stationName(station, r)}`;
      const line = box.querySelector('.rx-lcd__text span');
      line.textContent = title || stationName(station, r);
      line.parentElement.classList.toggle('is-long', title.length > 22);
    }
    // under an old set (no display) the song is a paper tag, like a record's label
    box.querySelector('.rx__tag').innerHTML = title ? `<b>${esc(track.title)}</b><span>${esc(track.artist)}${track.year ? ' · ' + track.year : ''}</span>` : '';
    box.querySelectorAll('[data-key="preset"]').forEach((k) => k.classList.toggle('is-lit', stations(r)[Number(k.dataset.n)] === station));
  };
  return {
    id, family: 'radio', turnMs: 3000, scrub: 'x', idleScale: 1.06,
    speed: { slow: '', normal: '', fast: '' }, speedUnit: '',
    deck: () => `<div class="dk dk--radio rx rx--${car ? 'car' : 'home'}" aria-hidden="true">
      ${car ? `<div class="rx__glass"></div>` : ''}
      <div class="rx__body"><div class="rx__draw"></div><div class="rx__screen"></div></div><div class="rx__tag"></div></div>`,
    media(track) {
      const el = h('<div class="record radio-medium"><span></span></div>');
      const anim = spinAnim([el.firstElementChild], this.turnMs);
      anim.playbackRate = 0; anim.pause();
      return { el, anim, track, rate: 0, raf: 0 };
    },
    show(root, track) {
      const box = root.querySelector(`[data-dev="${id}"]`);
      if (!box) return;
      if (settings.playerMode !== id) { drawn = ''; return; }
      display(box, track);
      const dk = box.querySelector('.dk');
      dk.classList.add('is-tuning');
      clearTimeout(dk._tuning);
      dk._tuning = setTimeout(() => dk.classList.remove('is-tuning'), 700);
    },
    sync(root, state) {
      const box = root.querySelector(`[data-dev="${id}"]`);
      if (!box || settings.playerMode !== id) return;
      const dk = box.querySelector('.dk');
      dk.classList.toggle('is-on', state.playing || state.loading);
      dk.classList.toggle('is-rain', car && settings.radioRain);
      dk.classList.toggle('is-road', car && settings.radioRoad);
      dk.classList.toggle('is-moving', state.playing && state.open);
      syncAmbience(state.playing);
      if (drawn !== receiver(car ? 'car' : 'home').id) display(box, null);
    },
    /** The receiver's own keys; true when handled here (power, prev and next are the player's usual ones). */
    onKey(action, el) {
      if (action === 'preset') { tune(stations()[Number(el?.dataset.n) || 0]); return true; }
      if (action === 'tune') { tuneBy(1); return true; }
      if (action === 'wipers') { clack(); updateSettings({ radioRain: !settings.radioRain }); return true; }
      if (action === 'drive') { clack(); updateSettings({ radioRoad: !settings.radioRoad }); return true; }
      return false;
    },
    leave: [{ opacity: 1 }, { opacity: 0 }], arrive: [{ opacity: 0 }, { opacity: 1 }],
    sounds: { key: () => clack(), leave: () => {}, arrive: () => {}, open: () => {}, wind: () => tuneStatic(0.4),
      scrub: () => { tuneStatic(0.5); return () => {}; }, loading: () => () => {} },
  };
}

radioEvents.addEventListener('tuning', () => tuneStatic(0.8));

export const carRadio = radio('radio-car', true);
export const homeRadio = radio('radio-home', false);
