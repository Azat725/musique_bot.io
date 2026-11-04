/** The town of the driving game: a square of 8 × 8 blocks, 960 m on a side (under a kilometre), a grid of roads with
 *  pavements, houses, two cinemas, a park, lamps, traffic lights (always green), zebra crossings and trees. Pure data and geometry: no
 *  browser, no imports, so it can be tested on its own.
 *
 *  Coordinates are in metres: x to the east, y to the north, height up. Road i of each axis lies on the line i × CELL. */

export const CELL = 120, N = 8, SIZE = CELL * N, ROAD = 12, HALF = ROAD / 2, WALK = 3;

export function hash(text) {
  let a = 2166136261;
  for (const ch of String(text)) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return a >>> 0;
}

/** A small seeded random generator: the same seed always makes the same town. */
export function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hash(seed);
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Is this spot on a road (the only place a car may be)? Roads are bands around the lines i × CELL, only inside the map. */
export function onRoad(x, y) {
  const ix = Math.round(x / CELL), iy = Math.round(y / CELL);
  const inX = x >= -HALF && x <= SIZE + HALF, inY = y >= -HALF && y <= SIZE + HALF;
  const onVertical = ix >= 0 && ix <= N && Math.abs(x - ix * CELL) <= HALF && inY;
  const onHorizontal = iy >= 0 && iy <= N && Math.abs(y - iy * CELL) <= HALF && inX;
  return onVertical || onHorizontal;
}

/**
 * Builds the town for a style (see styles.js). Blocks run from -1 to N: the outer ring only closes the view with
 * houses, the cars never reach it.
 */
export function makeWorld(seed, style) {
  const rnd = rng(seed);
  const buildings = [], blocks = [], lamps = [], lights = [], trees = [], crossings = [];
  const cinemas = new Set();
  while (cinemas.size < 2) cinemas.add(`${1 + Math.floor(rnd() * (N - 2))},${1 + Math.floor(rnd() * (N - 2))}`);
  const park = `${N / 2 - 1},${N / 2}`;
  cinemas.delete(park);
  let id = 0;
  for (let i = -1; i <= N; i++) for (let j = -1; j <= N; j++) {
    const x0 = i * CELL + HALF + WALK, x1 = (i + 1) * CELL - HALF - WALK, y0 = j * CELL + HALF + WALK, y1 = (j + 1) * CELL - HALF - WALK;
    const real = i >= 0 && i < N && j >= 0 && j < N, key = `${i},${j}`;
    const kind = !real ? 'ring' : key === park ? 'park' : cinemas.has(key) ? 'cinema' : 'town';
    blocks.push({ x0, y0, x1, y1, kind, real });
    const height = () => style.heights[0] + rnd() * (style.heights[1] - style.heights[0]);
    const add = (bx0, by0, bx1, by1, h, extra = {}) => buildings.push({ id: id++, x0: bx0, y0: by0, x1: bx1, y1: by1, h, tone: Math.floor(rnd() * style.walls.length), ...extra });
    if (kind === 'ring') add(x0, y0, x1, y1, 16 + rnd() * 20);
    else if (kind === 'park') {
      for (let k = 0; k < 36; k++) trees.push({ x: x0 + 6 + rnd() * (x1 - x0 - 12), y: y0 + 6 + rnd() * (y1 - y0 - 12), s: 0.8 + rnd() * 0.7 });
    } else if (kind === 'cinema') {
      add(x0, y0, x1, y1, 12 + rnd() * 3, { cinema: true });
    } else {
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, gap = 2;
      for (const [ax, ay, bx, by] of [[x0, y0, mx - gap, my - gap], [mx + gap, y0, x1, my - gap], [x0, my + gap, mx - gap, y1], [mx + gap, my + gap, x1, y1]]) {
        if (rnd() < 0.08) { // an empty lot with a few trees
          trees.push({ x: (ax + bx) / 2, y: (ay + by) / 2, s: 1 });
          continue;
        }
        const inset = rnd() * 3;
        add(ax, ay, bx - inset, by - inset, height());
      }
    }
  }
  // lamps along every road, both pavements, away from the crossings; trees between the lamps now and then
  for (let line = 0; line <= N; line++) for (let at = 18; at < SIZE; at += 30) {
    const near = Math.abs(at - Math.round(at / CELL) * CELL) < ROAD + 4;
    if (near) continue;
    for (const side of [-1, 1]) {
      const off = line * CELL + side * (HALF + 1.2);
      lamps.push({ x: off, y: at, arm: -side, axis: 'v' }, { x: at, y: off, arm: -side, axis: 'h' });
      if (rnd() < 0.3) { const o = line * CELL + side * (HALF + 1.5); trees.push({ x: o, y: at + 15, s: 0.7 + rnd() * 0.4 }, { x: at + 15, y: o, s: 0.7 + rnd() * 0.4 }); }
    }
  }
  // traffic lights at every crossing: the green lamp is the only one lit
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) for (const sx of [-1, 1]) for (const sy of [-1, 1]) lights.push({ x: i * CELL + sx * (HALF + 1.4), y: j * CELL + sy * (HALF + 1.4) });
  // a zebra crossing on each arm of a crossing that has a road beyond it: across the road, from kerb to kerb (where the stripes are drawn)
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (i + ax < 0 || i + ax > N || j + ay < 0 || j + ay > N) continue;
    const x = i * CELL + ax * (HALF + 1.6), y = j * CELL + ay * (HALF + 1.6), ex = Math.abs(ay) * (HALF + 1.2), ey = Math.abs(ax) * (HALF + 1.2);
    crossings.push({ x, y, ax: x - ex, ay: y - ey, bx: x + ex, by: y + ey });
  }
  return { size: SIZE, cell: CELL, half: HALF, walk: WALK, buildings, blocks, lamps, lights, crossings, trees: trees.filter((t) => !onRoad(t.x, t.y)), onRoad };
}

/** Where a game starts: on a road in the middle of the town, in the right lane (the left one in Britain and Japan). */
export function startSpot(lht) {
  return { x: 4 * CELL + (lht ? -3 : 3), y: 2 * CELL + 40, h: Math.PI / 2 };
}
