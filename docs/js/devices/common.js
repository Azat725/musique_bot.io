/** What the players other than the record share (devices/*.js). A device module describes one player: its deck (the
 *  machine drawn behind), the medium the track is on (a cassette, a reel, a disc, a cylinder), how the medium moves with
 *  the track, how it is swapped and revealed, and its sounds. vinyl.js drives whichever is chosen. */

export const NS = 'http://www.w3.org/2000/svg';
export const SLEEVE_MS = 1900; // the first-listen reveal (a case, a box, a tube)
export const IO = 'cubic-bezier(.65, 0, .35, 1)';

export function svg(viewBox, cls, html) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.classList.add(cls);
  el.innerHTML = html;
  return el;
}

/** Several turning parts as one animation, so a device is driven exactly like the record (vinyl.js rampTo, scrubbing).
 *  `dir` -1 turns them anticlockwise. Each part keeps its own share of the speed (setShares): a reel holding little tape
 *  turns faster than a full one. */
export function spinAnim(parts, turnMs, dir = -1, frames = null) {
  // `frames` replaces the turn: a cylinder seen from the front shows its rotation as marks running past, not as a turn
  const turn = frames || [{ transform: 'rotate(0deg)' }, { transform: `rotate(${dir * 360}deg)` }];
  const anims = parts.map((p) => p.animate(turn, { duration: turnMs, iterations: Infinity }));
  let base = 0;
  const k = parts.map(() => 1);
  const apply = () => anims.forEach((a, i) => { a.playbackRate = base * k[i]; });
  return {
    get playbackRate() { return base; },
    set playbackRate(v) { base = v; apply(); },
    get playState() { return anims[0].playState; },
    get currentTime() { return anims[0].currentTime; },
    set currentTime(v) { anims.forEach((a) => { a.currentTime = v; }); },
    play() { anims.forEach((a) => a.play()); },
    pause() { anims.forEach((a) => a.pause()); },
    setShares(...shares) { shares.forEach((s, i) => { k[i] = s; }); apply(); },
  };
}

/** Radii of the tape on two reels with a share p (0..1) of it wound onto the second: the same length of tape on both
 *  sides, so areas, not radii, are shared. Returns [first, second, share of speed of each]. */
export function tapePacks(p, min, max) {
  const q = Math.min(1, Math.max(0, p));
  const area = (share) => Math.sqrt(min ** 2 + (max ** 2 - min ** 2) * share);
  const l = area(1 - q), r = area(q);
  const mid = (min + max) / 2;
  return [l, r, mid / l, mid / r];
}

/** The keys of a deck: <span class="… " data-key="…"> with an icon; vinyl.js makes every [data-key] work. */
export const KEY_ICONS = {
  rec: '<circle cx="12" cy="12" r="5"/>',
  rew: '<path d="M11.5 6v12L3 12zM21 6v12l-8.5-6z"/>',
  play: '<path d="M7 5.5v13l11-6.5z"/>',
  toggle: '<path d="M4 5.5v13l9-6.5zM14.5 6h2.6v12h-2.6zM19 6h2.6v12H19z"/>',
  ff: '<path d="M12.5 6v12l8.5-6zM3 6v12l8.5-6z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  eject: '<path d="M12 5l7 8H5zM5 15.5h14V19H5z"/>',
  prev: '<path d="M5 6h2.6v12H5zM20 6v12l-11-6z"/>',
  next: '<path d="M16.4 6H19v12h-2.6zM4 6v12l11-6z"/>',
};

export const keySvg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${KEY_ICONS[name]}</svg>`;
