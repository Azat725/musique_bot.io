import { esc, h } from '../ui.js';
import { clack, motorStart, motorStop, startTapeNoise, startTapeWhirr, tapeWind } from '../sfx.js';
import { keySvg, spinAnim, svg, tapePacks } from './common.js';

/** A reel-to-reel tape recorder: two big reels, the tape running between them past the heads, a mechanical counter,
 *  metal toggles and needle level meters. The "medium" is the pair of reels with the tape; the deck stays put. */

const L = 50, R = 150, Y = 48, PACK_MIN = 12, PACK_MAX = 40; // in the reels' 200 × 100 drawing
let seq = 0, vuTimer = 0, vuShown = false;

/** A reel's flange: a metal disc with three windows the tape shows through (evenodd holes, no masks). */
function flange(cx) {
  const sector = (a0) => {
    const pt = (r, a) => `${(cx + r * Math.cos((a * Math.PI) / 180)).toFixed(2)} ${(Y + r * Math.sin((a * Math.PI) / 180)).toFixed(2)}`;
    const a1 = a0 + 72;
    return `M${pt(15, a0)} L${pt(41, a0)} A41 41 0 0 1 ${pt(41, a1)} L${pt(15, a1)} A15 15 0 0 0 ${pt(15, a0)}Z`;
  };
  const outer = `M${cx - 46} ${Y} a46 46 0 1 0 92 0 a46 46 0 1 0 -92 0Z`;
  return `<g class="rl__reel"><path class="rl__flange" fill-rule="evenodd" d="${outer} ${sector(-90)} ${sector(30)} ${sector(150)}"/>
    <circle class="rl__hub" cx="${cx}" cy="${Y}" r="9"/>
    ${[0, 120, 240].map((a) => `<rect class="rl__slot" x="${cx - 1.4}" y="${Y - 8}" width="2.8" height="4.4" transform="rotate(${a} ${cx} ${Y})"/>`).join('')}
    <circle class="rl__spindle" cx="${cx}" cy="${Y}" r="2.6"/></g>`;
}

function reels() {
  return svg('0 0 200 100', 'reel__body', `
    <circle class="rl__pack" cx="${L}" cy="${Y}" r="${PACK_MAX}"/><circle class="rl__pack" cx="${R}" cy="${Y}" r="${PACK_MIN}"/>
    <path class="rl__tape" d=""/>
    ${flange(L)}${flange(R)}`);
}

// four drums of the mechanical counter: each a column of digits moved by transform
const drum = () => `<span class="rl__drum"><span class="rl__digits">${[...'0123456789'].map((d) => `<i>${d}</i>`).join('')}</span></span>`;
const meter = (side) => `<span class="rl__vu" data-vu="${side}"><span class="rl__scale"><i>-20</i><i>-7</i><i>0</i><b>+3</b></span><span class="rl__needle"></span><small>VU</small></span>`;
const toggle = (k, action) => `<span class="rl__toggle" data-k="${k}" data-key="${action}"><span class="rl__lever"></span><span class="rl__sign">${keySvg(k)}</span></span>`;

export default {
  id: 'reel',
  family: 'tape',
  turnMs: 3600,
  scrub: 'x',
  idleScale: 1.25,
  speed: { slow: '16', normal: '19', fast: '25,7' }, // cm/s: 19.05 is the studio speed
  speedUnit: 'sound_rpm_tape',

  deck: () => `<div class="dk dk--reel" aria-hidden="true">
    <div class="rl__heads"><span class="rl__guide"></span><span class="rl__head"></span><span class="rl__head"></span><span class="rl__head"></span><span class="rl__guide"></span>
      <span class="rl__capstan"></span><span class="rl__roller"></span></div>
    <div class="rl__panel">
      <span class="rl__counter" data-counter>${drum()}${drum()}${drum()}${drum()}</span>
      ${meter('l')}${meter('r')}
    </div>
    <div class="rl__controls">${toggle('rew', 'rew')}${toggle('stop', 'pause')}${toggle('play', 'play')}${toggle('ff', 'ff')}
      <span class="rl__speed"><b data-speed></b><span class="rl__lamp"></span></span></div>
    <span class="rl__brand">MUSIQUE · <span data-t="rl_model"></span></span>
  </div>`,

  media(track) {
    ++seq;
    const el = h(`<div class="record reel">
      <span class="reel__tag">${esc(track?.title || 'Musique')}<small>${esc(track?.artist || '')}</small></span>
    </div>`);
    el.prepend(reels());
    const anim = spinAnim([...el.querySelectorAll('.rl__reel')], this.turnMs);
    anim.playbackRate = 0;
    anim.pause();
    const media = { el, anim, track, rate: 0, raf: 0, packs: [...el.querySelectorAll('.rl__pack')], tape: el.querySelector('.rl__tape'), shown: -1 };
    this.wind(media, 0);
    return media;
  },

  wind(media, p, root, time) {
    if (root) { // the counter turns one step per second of tape
      const n = Math.floor(time || 0) % 10000;
      root.querySelectorAll('.dk--reel .rl__digits').forEach((col, i) => {
        const d = Math.floor(n / 10 ** (3 - i)) % 10;
        const v = `translateY(${-d * 10}%)`;
        if (col.style.transform !== v) col.style.transform = v;
      });
    }
    const q = Math.round(Math.min(1, Math.max(0, p)) * 200) / 200;
    if (q === media.shown) return;
    media.shown = q;
    const [l, r, kl, kr] = tapePacks(q, PACK_MIN, PACK_MAX);
    media.packs[0].setAttribute('r', l.toFixed(2));
    media.packs[1].setAttribute('r', r.toFixed(2));
    media.anim.setShares(kl, kr);
    // the tape leaves the left pack at its bottom, runs down past the heads and up into the right pack
    media.tape.setAttribute('d', `M${L} ${(Y + l).toFixed(1)} L72 99 H128 L${R} ${(Y + r).toFixed(1)}`);
  },

  /** The level meters swing while the music plays (a smoothed random walk: the music itself is not analysed, so the
   *  iPhone keeps playing in the background) and fall back to rest when it stops. */
  sync(root, s) {
    const on = s.open && s.playing && !s.loading;
    if (on === vuShown) return;
    vuShown = on;
    clearInterval(vuTimer);
    const needles = [...root.querySelectorAll('.dk--reel .rl__needle')];
    const level = [0.5, 0.5];
    const show = (i, v) => needles[i].style.setProperty('--vu', `${(-48 + v * 86).toFixed(1)}deg`);
    if (!on) { needles.forEach((n) => n.style.setProperty('--vu', '-48deg')); return; }
    vuTimer = setInterval(() => {
      for (let i = 0; i < 2; i++) {
        level[i] += (Math.random() - 0.48) * 0.28;
        level[i] = Math.min(1, Math.max(0.25, level[i] * 0.92 + 0.62 * 0.08));
        show(i, level[i]);
      }
    }, 140);
  },

  // changing tracks: the reels are lifted off and a fresh pair is put on
  leave: [
    { transform: 'scale(1.04)', opacity: 1, offset: 0.25 },
    { transform: 'translateY(-30%) scale(.9)', opacity: 0 },
  ],
  arrive: [
    { transform: 'translateY(-30%) scale(.9)', opacity: 0 },
    { transform: 'scale(1.03)', opacity: 1, offset: 0.75 },
    { transform: 'none', opacity: 1 },
  ],

  // a first listen: the reel comes out of its cardboard box
  caseHtml: (track) => `<div class="sleeve is-case is-box" aria-hidden="true">
    ${track?.cover ? `<img src="${esc(track.cover)}" alt="" referrerpolicy="no-referrer">` : '<span class="sleeve__brand">Musique</span>'}
    <span class="sleeve__hinge"></span>
  </div>`,

  sounds: {
    key: () => clack(),
    leave: () => motorStop(),
    arrive: () => motorStart(),
    open: () => clack(),
    wind: tapeWind,
    scrub: startTapeWhirr,
    loading: () => startTapeNoise(),
  },
};
