/** What a car's windshield looks at: a street in perspective, houses on both sides in the style of the receiver's country
 *  and age, lamps and trees flying by when the road is on, rain streaks and drops on the glass. Flat shapes only.
 *
 *  Everything is drawn in a 330 × 99 box (the glass is .3 of its width high). Colours carry a day and a night version
 *  (--d and --n), the page picks one by the theme's mode, so the picture follows light and dark without redrawing. */

const W = 330, H = 99, VX = 165, VY = 50, RUN = 205; // vanishing point; how far the base line runs sideways at t = 1

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => { const x = hex(a), y = hex(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
/** A flat fill that has a day colour and a night one. */
const fl = (day, night = mix(day, '#0B1118', 0.68), extra = '') => `class="sc-f ${extra}" style="--d:${day};--n:${night}"`;

function seeded(text) {
  let a = 0;
  for (const ch of text) a = (a * 31 + ch.charCodeAt(0)) | 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// what each country's streets are made of: the walls, the roofs, the kinds of building in turn, the shop fronts
const STYLE = {
  us: { walls: ['#9C4B3A', '#B5654A', '#7E6B5C', '#C9A678'], roof: '#4A3A32', kinds: ['row', 'row', 'diner', 'block'], awning: ['#B83A3A', '#F1E6D0'] },
  uk: { walls: ['#9A4F3F', '#B3694E', '#8A6F58', '#A8553F'], roof: '#3E3A3A', kinds: ['row', 'row', 'row', 'block'], awning: ['#2F5D4A', '#E6DCC4'] },
  ussr: { walls: ['#B9B3A2', '#A8A08C', '#C2B7A0', '#9AA39A'], roof: '#6A6A66', kinds: ['block', 'block', 'kiosk', 'block'], awning: ['#8F2B22', '#D8CFB0'] },
  de: { walls: ['#D6C7A6', '#C4B08A', '#B38A5E', '#D9D1C2'], roof: '#7A3B2E', kinds: ['gable', 'row', 'gable', 'row'], awning: ['#2F4E7A', '#EDE3CB'] },
  fr: { walls: ['#E4D8BE', '#D8CBAE', '#CFC2A4', '#E9E1CF'], roof: '#5C6670', kinds: ['mansard', 'mansard', 'row', 'mansard'], awning: ['#7D1F23', '#EFE6D2'] },
  it: { walls: ['#D9A55E', '#C98A4A', '#E3B97A', '#C27C55'], roof: '#A8442E', kinds: ['villa', 'villa', 'row', 'villa'], awning: ['#2E7D4F', '#F1E6D0'] },
  jp: { walls: ['#C9CED3', '#B8BFC6', '#D6D2C8', '#A9B2BA'], roof: '#4B5560', kinds: ['tower', 'row', 'tower', 'tower'], awning: ['#C0392B', '#F1E6D0'] },
};
// height (at the edge of the glass), floors, windows across; marks of the kind
const KIND = {
  row: { h: 62, rows: 3, cols: 3 }, gable: { h: 66, rows: 3, cols: 3, gable: true }, block: { h: 96, rows: 5, cols: 4 },
  tower: { h: 132, rows: 7, cols: 2, neon: true }, villa: { h: 64, rows: 3, cols: 2, shutters: true }, mansard: { h: 70, rows: 3, cols: 3, mansard: true },
  diner: { h: 36, rows: 1, cols: 4, stripe: true }, kiosk: { h: 30, rows: 1, cols: 2 }, cinema: { h: 104, rows: 2, cols: 2, cinema: true },
};

/** A point on the street: side (-1 left, 1 right), depth t (1 at the glass edge, small far away), height `up` at t = 1. */
const pt = (s, t, up = 0) => [VX + s * RUN * t, VY + (H - VY) * t - up * t];
const poly = (pts, f) => `<polygon ${f} points="${pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`;
/** A rectangle on a wall: from depth ta to tb, from height v0 to v1. */
const quad = (s, ta, tb, v0, v1, f) => poly([pt(s, ta, v0), pt(s, tb, v0), pt(s, tb, v1), pt(s, ta, v1)], f);

function building(s, tf, tn, kindName, st, rnd, old) {
  const k = KIND[kindName], hgt = k.h * (0.9 + rnd() * 0.2);
  const wall = mix(st.walls[Math.floor(rnd() * st.walls.length)], '#8B7355', old ? 0.28 : 0);
  let out = quad(s, tf, tn, 0, hgt, fl(mix(wall, '#9CC0D4', (1 - tn) * 0.4), mix(wall, '#0B1118', 0.72 + (1 - tn) * 0.12)));
  out += quad(s, tf, tn, hgt, hgt + 4, fl(st.roof));
  if (k.mansard) out += quad(s, tf, tn, hgt + 4, hgt + 13, fl('#5C6670')) + quad(s, tf + (tn - tf) * 0.2, tf + (tn - tf) * 0.4, hgt + 5, hgt + 11, fl('#B9D2DD', '#F6C65B'));
  if (k.gable) out += quad(s, tf, tn, hgt + 4, hgt + 11, fl(st.roof)) + quad(s, tf + (tn - tf) * 0.3, tf + (tn - tf) * 0.7, hgt + 11, hgt + 18, fl(st.roof));
  if (k.stripe) out += quad(s, tf, tn, hgt - 8, hgt, fl('#C0392B')) + quad(s, tf, tn, 4, hgt - 12, fl('#BFD6DE', '#F6C65B'));
  const shop = !k.stripe && hgt > 40;
  if (shop) out += quad(s, tf + (tn - tf) * 0.06, tn - (tn - tf) * 0.06, 3, hgt * 0.17, fl('#6F8794', '#F6C65B'));
  if (shop && !k.cinema && !k.neon) {
    const stripes = 4;
    for (let i = 0; i < stripes; i++) out += quad(s, tf + (tn - tf) * i / stripes, tf + (tn - tf) * (i + 1) / stripes, hgt * 0.17, hgt * 0.23, fl(st.awning[i % 2]));
  }
  const top = shop ? hgt * 0.27 : hgt * 0.12;
  const cols = k.cols, rows = k.rows;
  for (let c = 0; c < cols; c++) {
    const t0 = tf + (tn - tf) * (c + 0.2) / cols, t1 = tf + (tn - tf) * (c + 0.8) / cols;
    for (let r = 0; r < rows; r++) {
      const v0 = top + (hgt - top - 6) * r / rows + 2, v1 = v0 + (hgt - top - 6) / rows * 0.58;
      const lit = rnd() < 0.55;
      if (k.shutters) out += quad(s, t0 - (t1 - t0) * 0.28, t0, v0, v1, fl('#4F6B4A')) + quad(s, t1, t1 + (t1 - t0) * 0.28, v0, v1, fl('#4F6B4A'));
      out += quad(s, t0, t1, v0, v1, lit ? fl('#BCD3DD', '#F6C65B') : fl('#8FA9B6', '#1A2330'));
    }
  }
  if (k.cinema) { // a bright marquee over the doors and a tall sign at the corner
    out += quad(s, tf, tn, hgt * 0.19, hgt * 0.3, fl('#F6E7A8', '#FFE27A')) + quad(s, tn - (tn - tf) * 0.1, tn, hgt * 0.3, hgt, fl('#E0554A', '#FF4F5A'));
    for (let i = 0; i < 6; i++) out += quad(s, tf + (tn - tf) * (i + 0.3) / 6, tf + (tn - tf) * (i + 0.7) / 6, hgt * 0.215, hgt * 0.245, fl('#C9A44A', '#FFFFFF'));
  } else if (k.neon) {
    const neon = [['#F7B4C9', '#FF4FA0'], ['#A8E0E8', '#35E0F2'], ['#F6E08A', '#FFE24A']][Math.floor(rnd() * 3)];
    out += quad(s, tn - (tn - tf) * 0.12, tn - (tn - tf) * 0.02, hgt * 0.3, hgt * 0.85, fl(neon[0], neon[1]));
  }
  return out;
}

function tree(s, t, rnd) {
  const [x, y] = pt(s, t, 0);
  return `<rect ${fl('#5B4636')} x="${(x - 1.4 * t).toFixed(1)}" y="${(y - 14 * t).toFixed(1)}" width="${(2.8 * t).toFixed(1)}" height="${(14 * t).toFixed(1)}"/>`
    + `<circle ${fl(rnd() < 0.5 ? '#5C8A4E' : '#6E9A55')} cx="${x.toFixed(1)}" cy="${(y - 20 * t).toFixed(1)}" r="${(11 * t).toFixed(1)}"/>`;
}

const Q = 0.7, PER = 4, CYCLES = 3; // depth step from one building to the next, buildings in one repeat, repeats

/** A street lamp on the pavement at depth t, its arm reaching over the road. */
function lamp(s, t) {
  const x = VX + s * 172 * t, y = VY + (H - VY) * t, arm = -s * 6 * t, hx = x + arm;
  return `<rect ${fl('#3B3F42')} x="${(x - 0.8 * t).toFixed(2)}" y="${(y - 30 * t).toFixed(2)}" width="${(1.6 * t).toFixed(2)}" height="${(30 * t).toFixed(2)}"/>`
    + `<rect ${fl('#3B3F42')} x="${Math.min(x, hx).toFixed(2)}" y="${(y - 31 * t).toFixed(2)}" width="${(6 * t).toFixed(2)}" height="${(1.6 * t).toFixed(2)}"/>`
    + `<circle ${fl('#FFF6C8', '#FFE27A')} cx="${hx.toFixed(2)}" cy="${(y - 29 * t).toFixed(2)}" r="${(2.2 * t).toFixed(2)}"/><circle class="rx-halo" fill="#FFE27A" cx="${hx.toFixed(2)}" cy="${(y - 29 * t).toFixed(2)}" r="${(8 * t).toFixed(2)}"/>`;
}

/** The street itself and its sides, from far to near. */
function street(r) {
  const st = STYLE[r.country] || STYLE.us, rnd = seeded(r.id), old = r.year < 1960;
  const skyDay = old ? '#B7C7CC' : '#9CC0D4';
  let out = `<rect ${fl(skyDay, '#1C2733', 'sc-sky')} width="${W}" height="${VY + 1}"/>`
    + `<rect ${fl(mix(skyDay, '#FFFFFF', 0.4), '#2E3E52', 'sc-sky')} y="${VY - 11}" width="${W}" height="12"/>`;
  out += `<g class="sc-day"><circle ${fl('#FFF1B8', undefined, 'sc-cel')} cx="${40 + Math.floor(rnd() * 70)}" cy="14" r="7"/><ellipse ${fl('#F4F8FA')} cx="230" cy="14" rx="26" ry="6"/><ellipse ${fl('#F4F8FA')} cx="100" cy="24" rx="20" ry="5"/></g>`;
  out += `<g class="sc-night sc-cel"><circle fill="#F3EEDC" cx="268" cy="16" r="7"/><circle fill="#1C2733" cx="271" cy="14" r="6.2"/>${Array.from({ length: 14 }, () => `<rect fill="#F3EEDC" x="${(rnd() * W).toFixed(0)}" y="${(rnd() * 34).toFixed(0)}" width="1.2" height="1.2"/>`).join('')}</g>`;
  // the far hills and a skyline behind the rows
  out += `<path ${fl('#8AA3AE')} d="M0 ${VY} L0 ${VY - 8} Q40 ${VY - 17} 90 ${VY - 7} T200 ${VY - 9} T330 ${VY - 6} L330 ${VY} Z"/>`;
  for (let i = 0; i < 9; i++) { const w = 7 + rnd() * 8; out += `<rect ${fl('#7E97A3')} x="${(VX - 70 + i * 16 + rnd() * 5).toFixed(0)}" y="${VY - 6 - rnd() * 12}" width="${w.toFixed(0)}" height="20"/>`; }
  // ground: pavement, then the road between the kerbs
  out += `<rect ${fl('#B8B4A8', '#2A2F33')} y="${VY}" width="${W}" height="${H - VY}"/>`
    + poly([[VX, VY], [VX - 140, H + 4], [VX + 140, H + 4]], fl('#5A5F63', '#262B30'))
    + poly([[VX, VY], [VX - 142, H + 4], [VX - 138, H + 4]], fl('#D9D5C8', '#454B50')) + poly([[VX, VY], [VX + 142, H + 4], [VX + 138, H + 4]], fl('#D9D5C8', '#454B50'));
  // the houses, trees and lamps on both sides. Every few buildings the row repeats itself exactly, each repeat 0.7^4 times the size of
  // the one before, so growing the whole group from 1 to 1/0.7^4 about the vanishing point (see .rx-street) is the car driving
  // along it, houses and all, and the picture is the same again where the loop starts
  let row = '';
  for (let c = CYCLES - 1; c >= 0; c--) for (let i = PER - 1; i >= 0; i--) for (const s of [-1, 1]) {
    const tn = 1.1 * Math.pow(Q, c * PER + i), tf = tn * Q, pick = seeded(`${r.id}${s}${i}`);
    const gap = pick() < 0.15 && i > 0, name = s < 0 && i === 2 ? 'cinema' : st.kinds[Math.floor(pick() * st.kinds.length)];
    row += gap ? tree(s, (tn + tf) / 2, seeded(`${r.id}${s}${i}t`)) : building(s, tf, tn * 0.985, name, st, seeded(`${r.id}${s}${i}b`), old);
    if (i % 2 === 0) row += lamp(s, tn);
  }
  out += `<g class="rx-street">${row}</g>`;
  // puddles' ripples (only in the rain)
  for (let i = 0; i < 7; i++) out += `<ellipse class="rx-ripple" style="--x:${(VX - 52 + rnd() * 104).toFixed(0)}px;--y:${(62 + rnd() * 32).toFixed(0)}px;animation-delay:-${(rnd() * 2).toFixed(2)}s" cx="0" cy="0" rx="5" ry="1.6"/>`;
  return out;
}

/** Rain: two sheets of falling streaks, drops on the glass (some running down). */
function rain(rnd) {
  const sheet = (n, len, w, op) => {
    const lines = Array.from({ length: n }, () => { const x = rnd() * (W + 12), y = rnd() * H; return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - len * 0.28).toFixed(1)}" y2="${(y + len).toFixed(1)}"/>`; }).join('');
    return `<g stroke="#E8F2F7" stroke-width="${w}" stroke-linecap="round" opacity="${op}"><g>${lines}</g><g transform="translate(0 -${H})">${lines}</g></g>`;
  };
  const drops = Array.from({ length: 26 }, () => {
    const x = 6 + rnd() * (W - 12), y = 4 + rnd() * (H - 22), rr = 0.9 + rnd() * 1.8, run = rnd() < 0.4 ? 8 + rnd() * 22 : 0;
    return `<g class="rx-drop" style="--run:${run.toFixed(0)}px;animation-duration:${(4 + rnd() * 6).toFixed(1)}s;animation-delay:-${(rnd() * 8).toFixed(1)}s" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">`
      + `${run ? `<rect x="${(-rr * 0.3).toFixed(2)}" y="0" width="${(rr * 0.6).toFixed(2)}" height="${run.toFixed(0)}" rx="${(rr * 0.3).toFixed(2)}" fill="#FFFFFF" fill-opacity=".3" class="rx-trail"/>` : ''}`
      + `<ellipse rx="${rr.toFixed(2)}" ry="${(rr * 1.3).toFixed(2)}" fill="#DDEBF2" fill-opacity=".62"/><circle cx="${(-rr * 0.3).toFixed(2)}" cy="${(-rr * 0.5).toFixed(2)}" r="${(rr * 0.32).toFixed(2)}" fill="#FFFFFF"/></g>`;
  }).join('');
  return `<svg class="rx__fall" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g class="rx-fall rx-fall--far">${sheet(26, 7, 0.7, 0.55)}</g><g class="rx-fall rx-fall--near">${sheet(18, 11, 1, 0.8)}</g></svg>`
    + `<svg class="rx__drops" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${drops}</svg>`;
}

/** The inside of the glass for this receiver: scene, lane marks, rain, tint and wipers. */
export function glassHTML(r) {
  const rnd = seeded(r.id + 'rain');
  return `<svg class="rx__scene" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${street(r)}</svg><i class="rx__lines"></i>${rain(rnd)}<i class="rx__tint"></i>`
    + '<i class="rx__wiper rx__wiper--l"></i><i class="rx__wiper rx__wiper--r"></i>';
}
