import { esc, h } from '../ui.js';
import { clack, startTapeNoise, tapeWind } from '../sfx.js';
import { settings } from '../store.js';
import { radioProfile } from '../radio.js';
import { keySvg, spinAnim } from './common.js';

// These are original, stylised receivers inspired by an era, not replicas of any particular manufacturer's model.
function radio(id, car) {
  return {
    id, family: 'radio', turnMs: 3000, scrub: 'x', idleScale: 1.15,
    speed: { slow: '', normal: '', fast: '' }, speedUnit: '',
    deck: () => `<div class="dk dk--radio ${car ? 'rd--car' : 'rd--home'}" aria-hidden="true">
      <div class="rd__cabinet"><div class="rd__brand">MUSIQUE · RADIO</div><div class="rd__dial"><span>AM &nbsp; 540 &nbsp; 700 &nbsp; 900 &nbsp; 1200 &nbsp; 1600</span><i></i></div>
        <div class="rd__face"><span class="rd__knob" data-key="toggle">${keySvg('toggle')}</span><div class="rd__display"><b data-radio-title>Musique</b><small data-radio-era></small></div><span class="rd__knob" data-key="next">${keySvg('next')}</span></div>
        <div class="rd__speaker"></div><div class="rd__keys"><span data-key="prev">${keySvg('prev')}</span><span data-key="toggle">${keySvg('toggle')}</span><span data-key="next">${keySvg('next')}</span></div>
      </div></div>`,
    media(track) {
      const el = h('<div class="record radio-medium"><span></span></div>');
      const anim = spinAnim([el.firstElementChild], this.turnMs);
      anim.playbackRate = 0; anim.pause();
      return { el, anim, track, rate: 0, raf: 0 };
    },
    show(root, track) {
      const box = root.querySelector(`[data-dev="${id}"]`);
      if (!box) return;
      const profile=radioProfile(); box.querySelector('.rd__cabinet').dataset.design=profile.design;
      box.querySelector('.rd__brand').textContent=profile.name;
      box.querySelector('[data-radio-title]').textContent = track ? `${track.artist} — ${track.title}` : 'Musique';
      box.querySelector('[data-radio-era]').textContent = `${settings.radioDecade} · ${settings.radioCountry.toUpperCase()}`;
    },
    leave: [{ opacity: 1 }, { opacity: 0 }], arrive: [{ opacity: 0 }, { opacity: 1 }],
    sounds: { key: () => clack(), leave: () => {}, arrive: () => {}, open: () => clack(), wind: tapeWind,
      scrub: () => null, loading: () => () => {} },
  };
}

export const carRadio = radio('radio-car', true);
export const homeRadio = radio('radio-home', false);
