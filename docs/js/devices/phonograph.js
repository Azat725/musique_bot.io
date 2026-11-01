import { esc, h } from '../ui.js';
import { crank, needleDrop, needleLift, startPhonoNoise, startScratch, whoosh } from '../sfx.js';
import { spinAnim, svg } from './common.js';

/** Edison's phonograph: a wooden case, a brass horn, a brown wax cylinder turning on its mandrel, the reproducer with its
 *  stylus travelling along the cylinder as the record plays. Its music is its own shelf of 50 cylinders (1890s–1920s),
 *  and its sound is the phonograph's own: narrow, crackling, a little unsteady (the server renders it, fx "phono"). */

// the wax surface: fine grooves across, and a few glints that run past as the cylinder turns (its rotation, seen
// from the front); drawn twice one above the other, so the loop has no seam
function cylinder() {
  const grooves = Array.from({ length: 46 }, (_, i) => `<line class="ph__groove" x1="${14 + i * 3.7}" y1="6" x2="${14 + i * 3.7}" y2="54"/>`).join('');
  const glints = [[30, 8, 40], [96, 20, 30], [150, 34, 36], [62, 44, 26], [124, 52, 22]]
    .map(([x, y, w]) => `<rect class="ph__glint" x="${x}" y="${y}" width="${w}" height="2.4" rx="1.2"/><rect class="ph__glint" x="${x}" y="${y + 60}" width="${w}" height="2.4" rx="1.2"/>`).join('');
  return svg('0 0 200 60', 'ph__cylinder', `<defs><clipPath id="ph-clip"><rect x="10" y="5" width="180" height="50" rx="6"/></clipPath></defs>
    <rect class="ph__wax" x="10" y="5" width="180" height="50" rx="6"/>
    <g clip-path="url(#ph-clip)">${grooves}<g class="ph__run">${glints}</g></g>
    <rect class="ph__end" x="4" y="9" width="8" height="42" rx="2"/><rect class="ph__end" x="188" y="9" width="8" height="42" rx="2"/>`);
}

export default {
  id: 'phonograph',
  family: 'disc',
  turnMs: 1500, // a cylinder turned about 160 times a minute: here a calmer pace
  scrub: 'x', // the stylus is moved along the cylinder
  idleScale: 1.15,
  speed: { slow: '160', normal: '160', fast: '160' }, // the governor holds it: the sound is not set here
  speedUnit: 'sound_rpm',
  fixedSound: true, // the control panel cannot change it

  deck: () => `<div class="dk dk--phonograph" aria-hidden="true">
    <svg class="ph__horn" viewBox="0 0 200 170" aria-hidden="true">
      <path class="ph__bell" d="M113 150 C 110 120, 102 98, 86 82 C 72 68, 48 62, 10 74 L 64 2 C 66 38, 86 56, 102 70 C 120 86, 130 112, 127 150 Z"/>
      <path class="ph__shine" d="M60 14 C 64 42, 82 60, 100 74 L 96 80 C 78 66, 58 48, 52 22 Z"/>
      <ellipse class="ph__mouth" cx="37" cy="38" rx="44" ry="15" transform="rotate(-53 37 38)"/>
      <ellipse class="ph__lip" cx="37" cy="38" rx="44" ry="15" transform="rotate(-53 37 38)"/>
      <rect class="ph__neck" x="112" y="146" width="16" height="22" rx="3"/>
    </svg>
    <span class="ph__carriage" data-carriage><span class="ph__reproducer"></span><span class="ph__stylus"></span></span>
    <span class="ph__mandrel"></span>
    <div class="ph__case">
      <span class="ph__plate"><b>Musique</b><small data-t="ph_plate"></small></span>
      <span class="ph__card"><b data-title></b><small data-meta></small></span>
      <span class="ph__crank" data-crank><i></i></span>
    </div>
  </div>`,

  media(track) {
    const el = h('<div class="record phonograph"></div>');
    el.prepend(cylinder());
    const anim = spinAnim([el.querySelector('.ph__run')], this.turnMs, -1, [{ transform: 'translateY(0)' }, { transform: 'translateY(-60px)' }]);
    anim.playbackRate = 0;
    anim.pause();
    return { el, anim, track, rate: 0, raf: 0 };
  },

  /** The reproducer travels along the cylinder with the record. */
  wind(media, p, root) {
    if (!root) return;
    const v = Math.min(1, Math.max(0, p)).toFixed(3);
    const c = root.querySelector('.dk--phonograph [data-carriage]');
    if (c.style.getPropertyValue('--at') !== v) c.style.setProperty('--at', v);
  },

  /** The paper card in front: the title, and the year and country of the recording. */
  show(root, track) {
    root.querySelector('.dk--phonograph [data-title]').textContent = track?.title || '';
    root.querySelector('.dk--phonograph [data-meta]').textContent = [track?.artist, track?.year, track?.country].filter(Boolean).join(' · ');
  },

  // changing cylinders: the old one slides off the mandrel, the new one slides on and the crank is wound
  leave: [{ transform: 'translateX(-115%)', opacity: 0 }],
  arrive: [
    { transform: 'translateX(115%)', opacity: 0 },
    { transform: 'translateX(-3%)', opacity: 1, offset: 0.8 },
    { transform: 'none', opacity: 1 },
  ],

  // a first listen: the cylinder comes out of its round cardboard box
  caseHtml: (track) => `<div class="sleeve is-case is-tube" aria-hidden="true">
    <span class="sleeve__brand">${esc(track?.year || 'Musique')}</span><span class="sleeve__hinge"></span>
  </div>`,

  sounds: {
    key: () => needleLift(),
    leave: () => needleLift(),
    arrive: () => { crank(); setTimeout(needleDrop, 650); },
    open: () => crank(),
    wind: () => whoosh(true),
    scrub: startScratch,
    loading: () => startPhonoNoise(1),
  },
};
