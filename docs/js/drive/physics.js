/** The player's car: a simple bicycle model (the front wheels steer), an automatic gearbox that gives believable
 *  engine revs, and the kerb that stops it: a car never leaves the road. Pure functions, no imports. */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function makeCar(spec, start) {
  return { spec, x: start.x, y: start.y, h: start.h, v: 0, wheel: 0, rpm: spec.idle, gear: 1, fuel: 0.82, temp: 0.05, odo: 0, braking: false };
}

/** Where the car's corners and the middle of its sides are, in the world (all of them must be on the road). */
export function outline(car, x = car.x, y = car.y, h = car.h) {
  const c = Math.cos(h), s = Math.sin(h), l = car.spec.len / 2, w = car.spec.wid / 2, pts = [];
  for (const [a, b] of [[l, w], [l, -w], [-l, w], [-l, -w], [l, 0], [-l, 0], [0, w], [0, -w]]) pts.push([x + a * c - b * s, y + a * s + b * c]);
  return pts;
}

/** Highest gear that keeps the revs sensible at this speed (the gears are spread evenly up to the top speed). */
function pickGear(spec, speed, vmax) {
  for (let g = 1; g <= spec.gears; g++) if (speed <= vmax * (g / spec.gears) * 0.95) return g;
  return spec.gears;
}

/**
 * One step of `dt` seconds. `input` = { throttle 0..1, brake 0..1, steer -1..1 (right is positive), hand: bool }.
 * Returns { bump } with the strength of a hit against the kerb (0 when none).
 */
export function stepCar(car, input, dt, onRoad) {
  const s = car.spec, vmax = s.top / 3.6;
  const steerMax = (32 * Math.PI / 180) / (1 + (car.v / 11) ** 2);
  const target = -clamp(input.steer, -1, 1) * steerMax;
  car.wheel += clamp(target - car.wheel, -3.2 * dt, 3.2 * dt);

  // speed: the engine pushes less the faster it goes, the brakes bite, the road drags
  let a = 0;
  const throttle = clamp(input.throttle, 0, 1), brake = clamp(input.brake, 0, 1);
  if (throttle > 0) a += car.v < -0.3 ? 8 * throttle : s.a0 * throttle * Math.max(0, 1 - (car.v / vmax) ** 2);
  car.braking = false;
  if (brake > 0) {
    if (car.v > 0.4) { a -= 9 * brake; car.braking = true; } else a -= 2.6 * brake * (car.v > -5 ? 1 : 0); // held still: reverse
  }
  if (input.hand) { a -= Math.sign(car.v) * 6.5; car.braking = true; }
  const drag = (0.45 + 0.0018 * car.v * car.v) * Math.sign(car.v);
  const v0 = car.v;
  car.v += (a - (throttle > 0 && car.v > 0 ? drag * 0.4 : drag)) * dt;
  if (v0 !== 0 && Math.sign(v0) !== Math.sign(car.v) && !(brake > 0 && v0 < 0.4) && throttle === 0) car.v = 0; // drag never reverses the car
  if (Math.abs(car.v) < 0.03 && throttle === 0 && brake === 0) car.v = 0;
  car.v = clamp(car.v, -5, vmax);

  // steering: how fast the nose swings depends on speed and wheelbase
  const yaw = clamp(car.v * Math.tan(car.wheel) / s.wheelbase, -1.5, 1.5);
  const h = car.h + yaw * dt;
  const nx = car.x + Math.cos(h) * car.v * dt, ny = car.y + Math.sin(h) * car.v * dt;
  const fits = (x, y, hh) => outline(car, x, y, hh).every(([px, py]) => onRoad(px, py));
  let bump = 0;
  if (fits(nx, ny, h)) { car.x = nx; car.y = ny; car.h = h; }
  else if (fits(nx, car.y, car.h)) { car.x = nx; bump = Math.abs(car.v) * 0.3; car.v *= 0.9; }
  else if (fits(car.x, ny, car.h)) { car.y = ny; bump = Math.abs(car.v) * 0.3; car.v *= 0.9; }
  else { bump = Math.abs(car.v); car.v = Math.abs(car.v) < 1 ? 0 : -car.v * 0.25; }
  car.odo += Math.abs(car.v) * dt;

  // engine: gear by speed, revs follow it, a dip at each change
  const speed = Math.abs(car.v);
  const gear = car.v < -0.3 ? -1 : pickGear(s, speed, vmax);
  if (gear !== car.gear && gear > 0 && car.gear > 0) car.rpm *= gear > car.gear ? 0.74 : 1.12;
  car.gear = gear;
  const span = gear > 0 ? vmax * (gear / s.gears) * 0.95 : 5;
  const wanted = speed < 1.5
    ? s.idle + throttle * 0.5 * (s.red - s.idle)
    : s.idle + (s.red - s.idle) * clamp((speed / span) * 0.92 + throttle * 0.06, 0, 1);
  car.rpm += (wanted - car.rpm) * Math.min(1, dt * 7);
  // fuel and engine heat
  car.fuel = Math.max(0, car.fuel - dt * (0.00012 + 0.00005 * throttle + 0.000004 * speed));
  car.temp += ((0.5 + 0.08 * throttle) - car.temp) * dt * 0.025;
  return { bump };
}

/** Speed as the dial shows it (the figure and its unit). */
export function speedReading(car) {
  const v = Math.abs(car.v) * 3.6;
  return car.spec.mph ? { value: v * 0.621371, unit: 'mph' } : { value: v, unit: 'km/h' };
}
