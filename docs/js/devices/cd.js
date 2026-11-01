import { esc, fmt, h } from '../ui.js';
import { beep, lidClick, spinUp, startCdSeek } from '../sfx.js';
import { player } from '../player.js';
import { keySvg, spinAnim, svg } from './common.js';

/** A portable CD player of the 90s: a round body under a clear or silver lid, a rainbow-sheened disc, a small
 *  monochrome display with the track number, the time and Anti-Skip, and round buttons. */

// the rainbow of a disc's data side, drawn as flat translucent sectors (no gradients), turning with the disc
const HUES = ['#FF5A5A', '#FFB347', '#FFF06A', '#7DFF8A', '#5AE8FF', '#6A8BFF', '#C77DFF', '#FF6AD5'];

function disc() {
  const wedge = (a0, a1, r0, r1) => {
    const pt = (r, a) => `${(100 + r * Math.cos((a * Math.PI) / 180)).toFixed(2)} ${(100 + r * Math.sin((a * Math.PI) / 180)).toFixed(2)}`;
    return `M${pt(r0, a0)} L${pt(r1, a0)} A${r1} ${r1} 0 0 1 ${pt(r1, a1)} L${pt(r0, a1)} A${r0} ${r0} 0 0 0 ${pt(r0, a0)}Z`;
  };
  const sheen = [];
  for (let i = 0; i < 16; i++) sheen.push(`<path class="cd__hue" style="fill:${HUES[i % HUES.length]}" d="${wedge(i * 22.5, i * 22.5 + 22.5, 30, 97)}"/>`);
  return svg('0 0 200 200', 'cd__disc', `<g class="cd__spin">
      <circle class="cd__silver" cx="100" cy="100" r="98"/>
      ${sheen.join('')}
      <circle class="cd__track" cx="100" cy="100" r="60"/><circle class="cd__track" cx="100" cy="100" r="84"/>
      <circle class="cd__clear" cx="100" cy="100" r="30"/><circle class="cd__stack" cx="100" cy="100" r="22"/>
      <circle class="cd__hole" cx="100" cy="100" r="8"/>
    </g>
    <path class="cd__glare" d="${wedge(-60, -38, 32, 96)}"/><path class="cd__glare" d="${wedge(120, 142, 32, 96)}"/>`);
}

const button = (k, action, cls = '') => `<span class="cd__btn ${cls}" data-k="${k}" data-key="${action}">${keySvg(k)}</span>`;

export default {
  id: 'cd',
  family: 'disc',
  turnMs: 520, // a disc spins fast
  scrub: 'angle',
  idleScale: 1.3,
  speed: { slow: '0.85×', normal: '1×', fast: '1.35×' },
  speedUnit: '',

  deck: () => `<div class="dk dk--cd" aria-hidden="true">
    <span class="cd__body"></span>
    <span class="cd__lid"><span class="cd__hinge"></span><span class="cd__brand">MUSIQUE <small>DIGITAL AUDIO</small></span></span>
    <div class="cd__front">
      <div class="cd__lcd">
        <span class="cd__row"><b class="cd__tr">TR <span data-track>01</span></b><b class="cd__time" data-time>0:00</b><span class="cd__bat"><i></i><i></i><i></i></span></span>
        <span class="cd__title"><span data-title></span></span>
        <span class="cd__row cd__row--small"><span class="cd__as">ANTI-SKIP</span><span class="cd__esp"><i></i><i></i><i></i><i></i></span><span class="cd__mode" data-speed></span></span>
      </div>
      <div class="cd__buttons">${button('rew', 'rew')}${button('toggle', 'toggle', 'cd__btn--big')}${button('ff', 'ff')}${button('stop', 'pause')}</div>
    </div>
  </div>`,

  media(track) {
    const el = h(`<div class="record cd"></div>`);
    el.prepend(disc());
    const anim = spinAnim([el.querySelector('.cd__spin')], this.turnMs, 1);
    anim.playbackRate = 0;
    anim.pause();
    return { el, anim, track, rate: 0, raf: 0 };
  },

  wind(media, p, root, time) {
    if (!root) return;
    const tm = root.querySelector('.dk--cd [data-time]');
    const text = fmt(time);
    if (tm.textContent !== text) tm.textContent = text;
  },

  /** The display: the track's number in the queue and its title running along. */
  show(root, track) {
    root.querySelector('.dk--cd [data-track]').textContent = String(player.index + 1).padStart(2, '0');
    const title = root.querySelector('.dk--cd [data-title]');
    title.textContent = track ? `${track.title} — ${track.artist}` : '';
    title.parentElement.classList.toggle('is-long', title.textContent.length > 22);
  },

  // changing tracks: the lid clicks, the disc is lifted out and the next one put in
  leave: [
    { transform: 'scale(1.06)', opacity: 1, offset: 0.3 },
    { transform: 'translateY(-40%) scale(.92)', opacity: 0 },
  ],
  arrive: [
    { transform: 'translateY(-40%) scale(.92)', opacity: 0 },
    { transform: 'scale(1.04)', opacity: 1, offset: 0.7 },
    { transform: 'none', opacity: 1 },
  ],

  // a first listen: the disc comes out of its jewel case
  caseHtml: (track) => `<div class="sleeve is-case is-jewel" aria-hidden="true">
    ${track?.cover ? `<img src="${esc(track.cover)}" alt="" referrerpolicy="no-referrer">` : '<span class="sleeve__brand">Musique</span>'}
    <span class="sleeve__hinge"></span>
  </div>`,

  sounds: {
    key: () => beep(),
    leave: () => lidClick(),
    arrive: () => spinUp(),
    open: () => lidClick(),
    wind: () => beep(1800),
    scrub: startCdSeek,
    loading: () => () => {}, // a disc is silent while it reads
  },
};
