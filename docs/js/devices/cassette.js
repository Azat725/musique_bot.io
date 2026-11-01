import { esc, h } from '../ui.js';
import { playSfx, startTapeNoise, startTapeWhirr, tapeWind } from '../sfx.js';
import { keySvg, spinAnim, svg, tapePacks } from './common.js';

/** The tape deck of the 80s and its cassette: two reels behind a window, the tape passing from one to the other. */

const REEL_L = 76, REEL_R = 124, REEL_Y = 53, PACK_MIN = 9.5, PACK_MAX = 20; // in the cassette's 200 × 126 drawing
let seq = 0;

function hub(cx) {
  const teeth = [0, 60, 120, 180, 240, 300].map((a) => `<rect class="cs__tooth" x="${cx - 0.9}" y="${REEL_Y - 7}" width="1.8" height="2.6" transform="rotate(${a} ${cx} ${REEL_Y})"/>`).join('');
  return `<g class="cs__reel"><circle class="cs__hub" cx="${cx}" cy="${REEL_Y}" r="7.4"/><circle class="cs__core" cx="${cx}" cy="${REEL_Y}" r="4.4"/>${teeth}</g>`;
}

function body(id) {
  const screws = [[8, 8], [192, 8], [8, 118], [192, 118], [100, 116]].map(([x, y]) => `<circle class="cs__screw" cx="${x}" cy="${y}" r="2.6"/>`).join('');
  return svg('0 0 200 126', 'cassette__body', `<defs><clipPath id="cs-win-${id}"><rect x="58" y="40" width="84" height="26" rx="4"/></clipPath></defs>
    <rect class="cs__shell" x="1" y="1" width="198" height="124" rx="7"/>
    <rect class="cs__label" x="13" y="9" width="174" height="74" rx="4"/>
    <rect class="cs__band" x="13" y="25" width="174" height="5"/>
    <rect class="cs__window" x="58" y="40" width="84" height="26" rx="4"/>
    <g clip-path="url(#cs-win-${id})">
      <circle class="cs__pack" cx="${REEL_L}" cy="${REEL_Y}" r="${PACK_MAX}"/><circle class="cs__pack" cx="${REEL_R}" cy="${REEL_Y}" r="${PACK_MIN}"/>
    </g>
    ${hub(REEL_L)}${hub(REEL_R)}
    <path class="cs__foot" d="M44 125 L53 99 H147 L156 125 Z"/>
    <circle class="cs__hole" cx="69" cy="113" r="3.6"/><circle class="cs__hole" cx="131" cy="113" r="3.6"/>
    <rect class="cs__hole" x="88" y="108" width="6" height="6" rx="1"/><rect class="cs__hole" x="106" y="108" width="6" height="6" rx="1"/>
    ${screws}`);
}

const KEYS = [['rec', 'like'], ['rew', 'rew'], ['play', 'play'], ['ff', 'ff'], ['stop', 'pause'], ['eject', 'next']];

export default {
  id: 'cassette',
  family: 'tape',
  turnMs: 2600, // one turn of a reel at normal speed
  scrub: 'x', // wound by dragging sideways
  idleScale: 1.3,
  speed: { slow: '4,0', normal: '4,76', fast: '6,4' }, // cm/s: 4.76 is the cassette standard
  speedUnit: 'sound_rpm_tape',

  deck: () => `<div class="recorder" aria-hidden="true">
    <div class="rec__top"><span class="rec__counter" data-counter>000</span><span class="rec__brand">Musique-302 <small data-t="rec_stereo"></small></span>
      <span class="rec__speed" data-speed></span><span class="rec__led"></span></div>
    <div class="rec__bay"></div>
    <div class="rec__keys">${KEYS.map(([k, action]) => `<span class="rec__key" data-k="${k}" data-key="${action}">${keySvg(k)}</span>`).join('')}</div>
  </div>`,

  media(track) {
    const id = ++seq;
    const el = h(`<div class="record cassette">
      <span class="cassette__title">${esc(track?.title || 'Musique')}</span>
      <span class="cassette__art">${track?.cover ? `<img src="${esc(track.cover)}" alt="" referrerpolicy="no-referrer">` : ''}</span>
      <span class="cassette__side">A</span>
    </div>`);
    el.prepend(body(id));
    const anim = spinAnim([...el.querySelectorAll('.cs__reel')], this.turnMs);
    anim.playbackRate = 0;
    anim.pause();
    const media = { el, anim, track, rate: 0, raf: 0, packs: [...el.querySelectorAll('.cs__pack')], shown: -1 };
    this.wind(media, 0);
    return media;
  },

  /** The tape moves from the left reel to the right one as the track plays (p from 0 to 1). */
  wind(media, p, root, time) {
    if (root) {
      const counter = root.querySelector('.recorder [data-counter]');
      const text = String(Math.floor(time || 0) % 1000).padStart(3, '0');
      if (counter.textContent !== text) counter.textContent = text;
    }
    const q = Math.round(Math.min(1, Math.max(0, p)) * 200) / 200;
    if (q === media.shown) return;
    media.shown = q;
    const [l, r, kl, kr] = tapePacks(q, PACK_MIN, PACK_MAX);
    media.packs[0].setAttribute('r', l.toFixed(2));
    media.packs[1].setAttribute('r', r.toFixed(2));
    media.anim.setShares(kl, kr);
  },

  // changing tracks: the cassette pops up out of the bay, the next one drops in
  leave: [
    { transform: 'translateY(-14%)', opacity: 1, offset: 0.3 },
    { transform: 'translateY(-120%) scale(.9)', opacity: 0 },
  ],
  arrive: [
    { transform: 'translateY(-110%) scale(.92)', opacity: 0 },
    { transform: 'translateY(4%) scale(1)', opacity: 1, offset: 0.78 },
    { transform: 'none', opacity: 1 },
  ],

  // a first listen: the cassette comes out of its case
  caseHtml: (track) => `<div class="sleeve is-case" aria-hidden="true">
    ${track?.cover ? `<img src="${esc(track.cover)}" alt="" referrerpolicy="no-referrer">` : '<span class="sleeve__brand">Musique</span>'}
    <span class="sleeve__hinge"></span>
  </div>`,

  sounds: {
    key: (name) => playSfx(name === 'pause' || name === 'stop' ? 'tape-pause' : 'tape-play', 0.6),
    leave: () => playSfx('tape-eject', 0.7),
    arrive: () => playSfx('tape-insert', 0.6),
    open: () => playSfx('tape-eject', 0.6),
    wind: tapeWind,
    scrub: startTapeWhirr,
    loading: () => startTapeNoise(),
  },
};
