/** Records and the race of the driving game: how far the car went without touching anything, and a race through checkpoints
 *  against the clock. Everything stays on this device (localStorage, never the server). Pure logic with no imports, so it
 *  can be tested on its own: the storage, the world and the random generator come in as arguments. */

export const KEY = 'musique.drive-records';
export const PENALTY = 3; // seconds added to a race for every touch
const MIN_RUN = 50; // metres: a shorter run without a touch is not worth a record

/** The records kept on this device: { clean: metres, race: seconds (the best, shortest) }. `storage` has getItem / setItem. */
export function loadRecords(storage) {
  const none = { clean: 0, race: 0 };
  try {
    const v = JSON.parse(storage.getItem(KEY) || '{}');
    return { clean: v.clean > 0 ? Math.floor(v.clean) : 0, race: v.race > 0 ? Number(v.race) : 0 };
  } catch { return none; }
}

export function saveRecords(storage, rec) {
  try { storage.setItem(KEY, JSON.stringify({ clean: rec.clean, race: rec.race })); } catch { /* private mode, full storage: the record is just not kept */ }
}

/** The run without a touch: { clean: metres since the last touch, lastTouch: the time of it }. */
export const makeRun = () => ({ clean: 0, lastTouch: -9 });

/** The car touched something (a kerb, a car, a person): the clean run ends. Returns its length in metres if it is a new record, else 0. */
export function endRun(run, rec) {
  const m = Math.floor(run.clean);
  run.clean = 0;
  if (m >= MIN_RUN && m > rec.clean) { rec.clean = m; return m; }
  return 0;
}

/** A race: `count` checkpoints at crossings a few blocks from one another, the same for the same random generator. */
export function makeCourse(world, rnd, from, count = 6) {
  const n = Math.round(world.size / world.cell), points = [];
  let at = [Math.round(from.x / world.cell), Math.round(from.y / world.cell)];
  while (points.length < count) {
    const i = Math.floor(rnd() * (n + 1)), j = Math.floor(rnd() * (n + 1)), d = Math.abs(i - at[0]) + Math.abs(j - at[1]);
    if (d < 2 || d > 5) continue;
    points.push({ x: i * world.cell, y: j * world.cell });
    at = [i, j];
  }
  return { points, next: 0, time: 0, touches: 0, started: false, done: false };
}

/** Time passes once the car first moves; a checkpoint counts when the car comes within 11 m of it.
 *  Returns 'point' (one reached), 'finish' (the last one) or null. */
export function stepCourse(course, car, dt) {
  if (course.done) return null;
  if (!course.started && Math.abs(car.v) > 0.5) course.started = true;
  if (course.started) course.time += dt;
  const p = course.points[course.next];
  if (Math.hypot(car.x - p.x, car.y - p.y) >= 11) return null;
  course.next += 1;
  if (course.next < course.points.length) return 'point';
  course.done = true;
  return 'finish';
}

/** The time of a race with the penalty for its touches. */
export const courseTotal = (course) => course.time + PENALTY * course.touches;

/** A race is over: is its total the best so far (then the record is replaced)? */
export function finishCourse(course, rec) {
  const total = Math.round(courseTotal(course) * 10) / 10;
  const best = !rec.race || total < rec.race;
  if (best) rec.race = total;
  return { total, best };
}

/** Seconds as m:ss. */
export function clock(seconds) {
  const s = Math.max(0, seconds), m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
