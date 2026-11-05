/** What the driver does: WASD or the arrows on a keyboard; on a phone a left and a right button under one thumb and the two
 *  pedals under the other. The steering eases in and out, so a held button turns the wheel smoothly. Several fingers work at
 *  once. Keys are read by their position (`e.code`), so they work in any keyboard layout. */

const MAX = 190 * Math.PI / 180; // how far the wheel (the picture of it) turns each way
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const KEYS = { KeyW: 'gas', ArrowUp: 'gas', KeyS: 'brake', ArrowDown: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'hand' };

/** `parts` = { left, right, gas, brake, horn, lights } elements; `on` = { lights(), horn(bool), station(dir), time(), rain() } callbacks. */
export function createControls(parts, on) {
  const held = new Set(), pressed = new Set();
  let throttle = 0, brake = 0, steerNow = 0;
  const off = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); off.push(() => target.removeEventListener(type, fn, opts)); };

  listen(window, 'keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (KEYS[e.code]) { held.add(KEYS[e.code]); e.preventDefault(); }
    else if (e.code === 'KeyL' && !e.repeat) on.lights();
    else if (e.code === 'KeyH' && !e.repeat) on.horn(true);
    else if (e.code === 'KeyN' && !e.repeat) on.station(e.shiftKey ? -1 : 1); // the next station, with Shift the one before
    else if (e.code === 'KeyT' && !e.repeat) on.time(); // night, dusk, day
    else if (e.code === 'KeyR' && !e.repeat) on.rain();
  });
  listen(window, 'keyup', (e) => {
    if (KEYS[e.code]) held.delete(KEYS[e.code]);
    else if (e.code === 'KeyH') on.horn(false);
  });
  listen(window, 'blur', () => { held.clear(); pressed.clear(); on.horn(false); });

  // the pedals: a finger or the mouse held down
  for (const [name, el] of [['gas', parts.gas], ['brake', parts.brake], ['left', parts.left], ['right', parts.right]]) {
    const ids = new Set();
    const set = () => { if (ids.size) pressed.add(name); else pressed.delete(name); el.classList.toggle('is-down', ids.size > 0); };
    listen(el, 'pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); ids.add(e.pointerId); set(); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(el, type, (e) => { ids.delete(e.pointerId); set(); });
  }
  listen(parts.horn, 'pointerdown', (e) => { e.preventDefault(); parts.horn.setPointerCapture(e.pointerId); on.horn(true); parts.horn.classList.add('is-down'); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(parts.horn, type, () => { on.horn(false); parts.horn.classList.remove('is-down'); });
  listen(parts.lights, 'click', () => on.lights());

  return {
    /** The pedals and the steering as the car wants them for the next `dt` seconds. */
    read(dt) {
      const gas = held.has('gas') || pressed.has('gas') ? 1 : 0, brk = held.has('brake') || pressed.has('brake') ? 1 : 0;
      throttle += clamp(gas - throttle, -5 * dt, 3.5 * dt);
      brake += clamp(brk - brake, -6 * dt, 6 * dt);
      const key = (held.has('right') || pressed.has('right') ? 1 : 0) - (held.has('left') || pressed.has('left') ? 1 : 0);
      steerNow += clamp(key - steerNow, -(key ? 2.6 : 4.5) * dt, (key ? 2.6 : 4.5) * dt); // eases in while held, springs back when let go
      const steer = clamp(steerNow, -1, 1);
      return { throttle, brake, steer, hand: held.has('hand'), wheelDeg: steer * MAX * 180 / Math.PI };
    },
    destroy() { off.forEach((f) => f()); },
  };
}
