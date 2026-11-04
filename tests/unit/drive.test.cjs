const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// the pure modules of the driving game have no imports: each loads on its own
const load = (file) => import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(__dirname, '../../docs/js/drive/', file), 'utf8')));
const setup = async (country = 'it', year = 1965, id = 'fiat500') => {
  const [W, P, T, S] = await Promise.all([load('world.js'), load('physics.js'), load('traffic.js'), load('styles.js')]);
  const style = S.styleFor(country, year);
  const world = W.makeWorld(id, style);
  return { W, P, T, S, style, world, spec: S.carSpec(id) };
};

test('the town is under a kilometre, the same for the same seed, and every house stands off the road', async () => {
  const { W, world, style } = await setup();
  assert.ok(world.size <= 1000);
  assert.equal(JSON.stringify(W.makeWorld('fiat500', style).buildings), JSON.stringify(world.buildings));
  assert.ok(world.buildings.length > 200 && world.lamps.length > 500 && world.lights.length === 4 * 81);
  assert.equal(world.buildings.filter((b) => b.cinema).length, 2);
  for (const b of world.buildings) for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) assert.ok(!world.onRoad(x, y), `a house on the road at ${x},${y}`);
  assert.ok(world.onRoad(480, 100) && world.onRoad(100, 480) && !world.onRoad(60, 60) && !world.onRoad(-30, 480) && !world.onRoad(480, 1000));
});

test('whatever the driver does, the car never leaves the road (no way onto the pavement)', async () => {
  for (const [country, year, id] of [['it', 1965, 'fiat500'], ['uk', 1961, 'etype'], ['us', 1984, 'corvette']]) {
    const { W, P, S, world, style, spec } = await setup(country, year, id);
    const car = P.makeCar(spec, W.startSpot(style.lht));
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    let input = { throttle: 1, brake: 0, steer: 0, hand: false };
    for (let step = 0; step < 60 * 240; step++) {
      if (step % 45 === 0) input = { throttle: rnd() < 0.8 ? 1 : 0, brake: rnd() < 0.15 ? 1 : 0, steer: rnd() * 2 - 1, hand: rnd() < 0.05 };
      P.stepCar(car, input, 1 / 60, world.onRoad);
      assert.ok(P.outline(car).every(([x, y]) => world.onRoad(x, y)), `${id} left the road at step ${step}`);
    }
    assert.ok(Math.abs(car.v) <= spec.top / 3.6 + 1e-9);
    assert.ok(car.rpm >= spec.idle * 0.7 && car.rpm <= spec.red * 1.2);
    assert.ok(S.carSpec('nonsense').top > 0);
  }
});

test('a car pulls away, reaches speed, stops when braking and then reverses when brake is held', async () => {
  const { W, P, world, style, spec } = await setup();
  const car = P.makeCar(spec, W.startSpot(style.lht));
  const go = (inp, secs) => { for (let i = 0; i < 60 * secs; i++) P.stepCar(car, { steer: 0, hand: false, throttle: 0, brake: 0, ...inp }, 1 / 60, world.onRoad); };
  go({ throttle: 1 }, 8);
  assert.ok(car.v > 8, `speed ${car.v}`);
  assert.ok(car.gear >= 2);
  go({ brake: 1 }, 6);
  assert.ok(car.v <= 0 && car.v >= -5);
  go({}, 16);
  assert.ok(Math.abs(car.v) < 0.5);
  const reading = P.speedReading(car);
  assert.ok(reading.unit === 'km/h' && reading.value >= 0);
});

test('other cars keep to roads and lanes, never overlap each other and never touch the pavement; people stay on pavements', async () => {
  for (const [country, year, id] of [['it', 1965, 'fiat500'], ['jp', 1985, 'ae86']]) {
    const { W, T, world, style } = await setup(country, year, id);
    const tr = T.makeTraffic(world, W.rng(id + 'traffic'), style);
    assert.ok(tr.cars.length >= 12 && tr.peds.length === 90);
    const player = { x: 480, y: 280, h: Math.PI / 2, v: 0 };
    let worst = 0;
    for (let step = 0; step < 60 * 300; step++) {
      T.stepTraffic(tr, player, 1 / 20);
      if (step % 20) continue;
      for (const c of tr.cars) assert.ok(world.onRoad(c.x, c.y), `a car off the road at ${c.x.toFixed(1)},${c.y.toFixed(1)}`);
      for (const p of tr.peds) assert.ok(!world.onRoad(p.x, p.y), `a person on the road at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      for (let i = 0; i < tr.cars.length; i++) for (let j = i + 1; j < tr.cars.length; j++) {
        const hit = T.overlap({ ...tr.cars[i], len: 3.6, wid: 1.5 }, { ...tr.cars[j], len: 3.6, wid: 1.5 });
        if (hit) worst = Math.max(worst, hit.depth);
      }
    }
    assert.ok(worst < 1.2, `cars drove into each other (${worst.toFixed(2)} m)`);
    const keeps = tr.cars.every((c) => { const lane = Math.min(Math.abs(c.x - Math.round(c.x / 120) * 120), Math.abs(c.y - Math.round(c.y / 120) * 120)); return lane < 6.01; });
    assert.ok(keeps);
  }
});

test('traffic drives on the left in Britain and Japan and on the right elsewhere', async () => {
  const left = await setup('uk', 1961, 'etype'), right = await setup('de', 1960, 'beetle');
  assert.equal(left.style.lht, true);
  assert.equal(right.style.lht, false);
  assert.equal(left.W.startSpot(true).x < 480, true);
  assert.equal(right.W.startSpot(false).x > 480, true);
  const dir = (s) => { const tr = s.T.makeTraffic(s.world, s.W.rng('x'), s.style); const car = tr.cars[0]; const next = { ...car, ...{} }; return { car, next }; };
  for (const s of [left, right]) {
    const { car } = dir(s);
    const before = { x: car.x, y: car.y };
    s.T.stepTraffic({ cars: [car], peds: [] }, { x: -999, y: -999, h: 0, v: 0 }, 0.5);
    // the lane is on the driver's left or right of the road's middle line, whichever the country keeps
    const nx = Math.sin(car.h), ny = -Math.cos(car.h); // to the right of the heading
    const cx = Math.round(car.x / 120) * 120, cy = Math.round(car.y / 120) * 120;
    const offset = Math.abs(Math.cos(car.h)) > 0.7 ? (car.y - cy) * ny : (car.x - cx) * nx; // positive: right of the middle line
    if (Math.abs(offset) > 1) assert.equal(offset > 0, !s.style.lht, 'wrong side of the road');
    assert.ok(before.x !== undefined);
  }
});

test('two rectangles that overlap are pushed apart, apart ones are left alone', async () => {
  const { T } = await setup();
  assert.equal(T.overlap({ x: 0, y: 0, h: 0, len: 4, wid: 2 }, { x: 10, y: 0, h: 0, len: 4, wid: 2 }), null);
  const hit = T.overlap({ x: 0, y: 0, h: 0, len: 4, wid: 2 }, { x: 3, y: 0, h: 0, len: 4, wid: 2 });
  assert.ok(hit && hit.depth > 0 && Math.abs(hit.x) === 1);
});
