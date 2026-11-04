import { settings } from '../store.js';
import { frequency, onAir, stationName } from '../radio.js';
import { player } from '../player.js';

/** The dashboard of the game is the dashboard of the chosen car, the very drawing the radio view shows (its dials, its
 *  radio, its colours), with the needles and bars now alive: the first dial is the speedometer, the second the rev
 *  counter, then the fuel and the engine heat. The steering wheel is lifted out of the drawing so it can turn on its own. */

const HOLD_MS = 2500;
// dials that are not the usual round 240° ones: the Bel Air's half-moon and the Volga's bar
const ODD = { belair: { span: 140, slide: false }, volga: { span: 76, slide: true } };
// the E-Type has its rev counter on the left, the speedometer to the right of it
const SWAP = new Set(['etype']);

/** The parts of a car's drawing: the dashboard without its wheel, the wheel, and the colour of the dashboard. */
export function dashParts(r) {
  const art = r.art(), wheel = (art.match(/<g class="rx-wheel">[\s\S]*?<\/g>/) || [''])[0];
  return { dash: art.replace(wheel, ''), wheel, base: (art.match(/fill="(#[0-9A-Fa-f]{6})"/) || [])[1] || '#1E1C1B' };
}

/**
 * Puts the dashboard into `box` (the dashboard's own element) and `wheelBox` (the turning wheel). Returns
 * { update(state), radio, destroy }; `radio` is the element to press and hold to change the station.
 */
export function mountDash(box, wheelBox, r) {
  const { dash, wheel } = dashParts(r);
  const [sx, sy, sw, sh, type] = r.screen;
  const kind = type.startsWith('lcd') ? 'lcd' : type, tone = type.includes('-') ? type.split('-')[1] : '';
  box.innerHTML = `<svg viewBox="0 30 400 210" aria-hidden="true">${dash}</svg>
    <div class="dv-radio dv-radio--${kind} ${tone ? 'dv-radio--' + tone : ''}" style="left:${sx / 4}%;top:${(sy - 30) / 2.1}%;width:${sw / 4}%;height:${sh / 2.1}%">
      <span class="dv-radio__a"></span><span class="dv-radio__b"><span></span></span><i class="dv-radio__needle"></i><i class="dv-radio__bar"></i></div>
    <div class="dv-lamps"><span class="dv-lamp dv-lamp--lights" data-lamp="lights"></span><span class="dv-lamp dv-lamp--brake" data-lamp="brake"></span></div>`;
  wheelBox.innerHTML = `<svg viewBox="-28 148 240 240" aria-hidden="true">${wheel}</svg>`;
  const needles = [...box.querySelectorAll('.rx-needle')];
  if (SWAP.has(r.id) && needles.length > 1) needles.reverse();
  const segs = { speed: [...box.querySelectorAll('.rx-seg[data-bar="speed"]')], rev: [...box.querySelectorAll('.rx-seg[data-bar="rev"]')] };
  const odd = ODD[r.id], screen = box.querySelector('.dv-radio'), a = screen.querySelector('.dv-radio__a'), b = screen.querySelector('.dv-radio__b > span');
  const needle = screen.querySelector('.dv-radio__needle'), lamps = { lights: box.querySelector('[data-lamp="lights"]'), brake: box.querySelector('[data-lamp="brake"]') };
  const last = new Map();
  const turn = (el, frac) => {
    const f = Math.max(0, Math.min(1, frac)), key = Math.round(f * 400);
    if (last.get(el) === key) return;
    last.set(el, key);
    el.style.transform = odd ? (odd.slide ? `translateX(${(f * odd.span).toFixed(1)}px)` : `rotate(${(f * odd.span).toFixed(1)}deg)`) : `rotate(${(-10 + f * 240).toFixed(1)}deg)`;
  };
  const bars = (list, frac) => list.forEach((el, i) => { el.style.opacity = i / list.length < frac ? 1 : 0.14; });

  let text = '', shown = 0;
  const showRadio = () => {
    const station = onAir() || settings.radioStation || r.country, f = frequency(station, r), track = player.current;
    const first = `${r.band === 'am' ? 'AM' : 'FM'} ${f.text} ${stationName(station, r)}`, second = track ? `${track.artist} — ${track.title}` : '';
    if (text !== first + second) { text = first + second; a.textContent = first; b.textContent = second; b.parentElement.classList.toggle('is-long', second.length > 22); }
    needle.style.left = `${Math.min(96, Math.max(4, f.at * 100))}%`;
  };
  showRadio();

  return {
    radio: screen,
    holdMs: HOLD_MS,
    /** Called every frame: { car, kmh, lights, hand }. */
    update({ car, kmh, lights, hand, time }) {
      const spec = car.spec, topScale = spec.top * 1.35;
      const speed = kmh / topScale, rev = car.rpm / (spec.red * 1.1);
      if (needles[0]) turn(needles[0], speed);
      if (needles[1]) turn(needles[1], rev);
      if (needles[2]) turn(needles[2], car.fuel);
      if (needles[3]) turn(needles[3], car.temp);
      for (let i = 4; i < needles.length; i++) turn(needles[i], 0.5 + 0.02 * Math.sin(time * 0.8 + i));
      bars(segs.speed, speed); bars(segs.rev, rev);
      lamps.lights.classList.toggle('is-on', lights); lamps.brake.classList.toggle('is-on', hand);
      if (time - shown > 0.35) { shown = time; showRadio(); }
    },
    destroy() { box.innerHTML = ''; wheelBox.innerHTML = ''; },
  };
}
