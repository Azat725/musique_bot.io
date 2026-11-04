/** The other cars and the people of the town. The cars drive round loops of roads in their lane, slow down for anything
 *  ahead, give way to a car coming from the right and stop for people on a zebra crossing; people walk to and fro along
 *  the pavements, and a third of them cross at the zebras: they wait at the kerb until no car is coming (the player's
 *  car is no exception, it has to slow down) and then walk over. Pure functions, no imports: the world, a random
 *  generator and the style come in as arguments. */

const TAU = Math.PI * 2;

/** A loop of lane centre-lines with rounded corners as a list of points with distances, for a car to follow. */
function loopPath(corners, radius) {
  const pts = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const p = corners[i], a = corners[(i + n - 1) % n], b = corners[(i + 1) % n];
    const ia = [p[0] + Math.sign(a[0] - p[0]) * radius, p[1] + Math.sign(a[1] - p[1]) * radius];
    const ib = [p[0] + Math.sign(b[0] - p[0]) * radius, p[1] + Math.sign(b[1] - p[1]) * radius];
    for (let k = 0; k <= 8; k++) { // a quarter circle drawn as a quadratic curve
      const t = k / 8, u = 1 - t;
      pts.push([u * u * ia[0] + 2 * u * t * p[0] + t * t * ib[0], u * u * ia[1] + 2 * u * t * p[1] + t * t * ib[1]]);
    }
  }
  const dist = [0];
  for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; dist.push(dist[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  return { pts, dist, length: dist[pts.length] };
}

function pathAt(path, s) {
  s = ((s % path.length) + path.length) % path.length;
  let lo = 0, hi = path.pts.length;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path.dist[mid] <= s) lo = mid; else hi = mid; }
  const a = path.pts[lo], b = path.pts[(lo + 1) % path.pts.length], seg = path.dist[lo + 1] - path.dist[lo] || 1, t = (s - path.dist[lo]) / seg;
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, h: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

/** The traffic: cars on loops (right-hand traffic goes anticlockwise on the outer lanes, left-hand clockwise on the inner ones). */
export function makeTraffic(world, rnd, style) {
  const { cell, half } = world, lane = half / 2, cars = [], peds = [];
  const n = Math.round(world.size / cell);
  for (let loop = 0; loop < 12; loop++) {
    const w = 1 + Math.floor(rnd() * 3), hgt = 1 + Math.floor(rnd() * 3);
    const i0 = Math.floor(rnd() * (n - w + 1)), j0 = Math.floor(rnd() * (n - hgt + 1));
    const xa = i0 * cell, xb = (i0 + w) * cell, ya = j0 * cell, yb = (j0 + hgt) * cell;
    const corners = style.lht // always the outer lane: anticlockwise keeping right, clockwise keeping left
      ? [[xa - lane, ya - lane], [xa - lane, yb + lane], [xb + lane, yb + lane], [xb + lane, ya - lane]]
      : [[xa - lane, ya - lane], [xb + lane, ya - lane], [xb + lane, yb + lane], [xa - lane, yb + lane]];
    const path = loopPath(corners, 5);
    const count = 1 + (rnd() < 0.6 ? 1 : 0);
    const cruise = 6.5 + rnd() * 4.5;
    for (let k = 0; k < count; k++) {
      const s = (rnd() * 0.4 + k * 0.5) * path.length;
      cars.push({ id: cars.length, path, s, v: cruise, cruise, wait: 0, braking: false, colour: style.npc[Math.floor(rnd() * style.npc.length)], len: 4 + rnd() * 0.6, wid: 1.75, ...pathAt(path, s) });
    }
  }
  // people on the pavements: a stretch along one side of a block, walked there and back
  const walk = half + world.walk / 2;
  for (let p = 0; p < 90; p++) {
    if (p % 3 === 0 && world.crossings.length) { // one who crosses: waits at one kerb of a zebra, goes over, waits at the other
      const c = world.crossings[Math.floor(rnd() * world.crossings.length)], end = rnd() < 0.5 ? 0 : 1;
      peds.push({ ax: c.ax, ay: c.ay, bx: c.bx, by: c.by, t: end, dir: end ? -1 : 1, speed: 1.25 + rnd() * 0.45, coat: style.coats[Math.floor(rnd() * style.coats.length)], hat: style.hats && rnd() < 0.6, tall: 0.92 + rnd() * 0.16, phase: rnd() * TAU, x: end ? c.bx : c.ax, y: end ? c.by : c.ay, cross: c, state: 'wait', timer: rnd() * 6, rs: 1 + Math.floor(rnd() * 1e9) });
      continue;
    }
    const i = Math.floor(rnd() * n), j = Math.floor(rnd() * n), side = Math.floor(rnd() * 4);
    const x0 = i * cell + half + 2, x1 = (i + 1) * cell - half - 2, y0 = j * cell + half + 2, y1 = (j + 1) * cell - half - 2;
    const a = [[x0, j * cell + walk], [(i + 1) * cell - walk, y0], [x0, (j + 1) * cell - walk], [i * cell + walk, y0]][side];
    const b = [[x1, j * cell + walk], [(i + 1) * cell - walk, y1], [x1, (j + 1) * cell - walk], [i * cell + walk, y1]][side];
    peds.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], t: rnd(), dir: rnd() < 0.5 ? 1 : -1, speed: 1.1 + rnd() * 0.6, coat: style.coats[Math.floor(rnd() * style.coats.length)], hat: style.hats && rnd() < 0.6, tall: 0.92 + rnd() * 0.16, phase: rnd() * TAU, x: a[0], y: a[1] });
  }
  return { cars, peds };
}

/** Can someone step onto this crossing? Not with a car on it or coming up to it; a car that stands still nearby does no harm.
 *  The player is no exception: a person steps out when the car is still some way off, and it has to slow down. */
function crossingClear(tr, player, c) {
  const toward = (o, d, dx, dy) => (Math.cos(o.h) * dx + Math.sin(o.h) * dy) / d > 0.3;
  for (const o of tr.cars) {
    const dx = c.x - o.x, dy = c.y - o.y, d = Math.hypot(dx, dy);
    if (d < 5) return false;
    if (o.v > 1.2 && d < 9 + 1.3 * o.v && toward(o, d, dx, dy)) return false;
  }
  const dx = c.x - player.x, dy = c.y - player.y, d = Math.hypot(dx, dy), v = Math.abs(player.v);
  return d >= 5 && !(v > 1.2 && d < 7 + 0.3 * v && toward(player, d, dx, dy));
}

function stepCrosser(p, tr, player, dt) {
  p.walking = false;
  if (p.state !== 'go') { // 'wait' at a kerb, or 'hit' (shaken for a moment)
    p.timer -= dt;
    if (p.timer <= 0) { if (p.state === 'hit' || crossingClear(tr, player, p.cross)) p.state = 'go'; else p.timer = 0.4; }
  } else {
    const len = Math.hypot(p.bx - p.ax, p.by - p.ay) || 1;
    if (!tr.cars.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < 2.4)) { p.t += p.dir * p.speed * dt / len; p.walking = true; } // a car in the way: wait where you are
    if (p.t >= 1 || p.t <= 0) {
      p.t = p.t >= 1 ? 1 : 0; p.dir = -p.dir; p.state = 'wait';
      p.rs = (Math.imul(p.rs, 1664525) + 1013904223) >>> 0; p.timer = 2 + (p.rs / 4294967296) * 6;
    }
  }
  p.x = p.ax + (p.bx - p.ax) * p.t; p.y = p.ay + (p.by - p.ay) * p.t;
  if (p.walking) p.phase += p.speed * dt * 4.2;
}

/** Has the player's car (x, y, h, len, wid) run into someone on a crossing? */
export function pedHit(car, p) {
  if (p.state !== 'go') return false;
  const dx = p.x - car.x, dy = p.y - car.y, c = Math.cos(car.h), s = Math.sin(car.h);
  return Math.abs(dx * c + dy * s) < car.len / 2 + 0.3 && Math.abs(dx * s - dy * c) < car.wid / 2 + 0.3;
}

const rel = (c, o) => { const dx = o.x - c.x, dy = o.y - c.y, cs = Math.cos(c.h), sn = Math.sin(c.h); return { f: dx * cs + dy * sn, r: dx * sn - dy * cs }; };

/** Moves every car and person by `dt` seconds; `player` is the player's car ({ x, y, h, v }) which the others must avoid. */
export function stepTraffic(tr, player, dt) {
  const going = tr.peds.filter((p) => p.cross && p.state === 'go');
  for (const c of tr.cars) {
    let want = c.cruise, blocked = false;
    const others = tr.cars.concat([{ x: player.x, y: player.y, h: player.h, v: player.v, player: true }]);
    for (const o of others) {
      if (o === c) continue;
      const { f, r } = rel(c, o);
      if (f > 0.5 && f < 7 + c.v * 0.9 && Math.abs(r) < 2.4) { want = Math.min(want, Math.max(0, (f - 5.2) * 1.1)); blocked = true; } // in my lane ahead
      else if (f > 0 && !o.player && c.id > o.id && f * f + r * r < 56) { want = 0; blocked = true; } // too close to a car that goes first
      else if (f > -1 && f < 11 && r > 1.5 && r < 12 && Math.abs(o.v) > 0.5 && Math.abs(Math.cos(o.h - c.h)) < 0.5 && c.wait < 2.5) { want = 0; blocked = true; } // priority to the right
    }
    for (const p of going) { // someone on a zebra in my lane ahead: stop
      const { f, r } = rel(c, p);
      if (f > 0.5 && f < 7 + c.v * 0.9 && Math.abs(r) < 2.6) { want = Math.min(want, Math.max(0, (f - 4.5) * 1.1)); blocked = true; }
    }
    c.wait = blocked && c.v < 0.3 ? c.wait + dt : 0;
    c.v += Math.max(-7 * dt, Math.min(2.4 * dt, want - c.v));
    c.braking = want < c.v - 0.2;
    c.s += c.v * dt;
    Object.assign(c, pathAt(c.path, c.s));
  }
  for (const p of tr.peds) {
    if (p.cross) { stepCrosser(p, tr, player, dt); continue; }
    const len = Math.hypot(p.bx - p.ax, p.by - p.ay) || 1;
    p.t += p.dir * p.speed * dt / len;
    if (p.t > 1) { p.t = 1; p.dir = -1; } else if (p.t < 0) { p.t = 0; p.dir = 1; }
    p.x = p.ax + (p.bx - p.ax) * p.t; p.y = p.ay + (p.by - p.ay) * p.t;
    p.phase += p.speed * dt * 4.2;
  }
}

/** Do two cars (rectangles with a heading) overlap? Returns the push that separates a from b, or null. */
export function overlap(a, b) {
  const axes = [];
  for (const c of [a, b]) axes.push([Math.cos(c.h), Math.sin(c.h)], [-Math.sin(c.h), Math.cos(c.h)]);
  const half = (c, ax) => Math.abs(Math.cos(c.h) * ax[0] + Math.sin(c.h) * ax[1]) * c.len / 2 + Math.abs(-Math.sin(c.h) * ax[0] + Math.cos(c.h) * ax[1]) * c.wid / 2;
  let best = null;
  for (const ax of axes) {
    const d = (b.x - a.x) * ax[0] + (b.y - a.y) * ax[1], gap = half(a, ax) + half(b, ax) - Math.abs(d);
    if (gap <= 0) return null;
    if (!best || gap < best.depth) best = { depth: gap, x: -Math.sign(d || 1) * ax[0], y: -Math.sign(d || 1) * ax[1] };
  }
  return best;
}
