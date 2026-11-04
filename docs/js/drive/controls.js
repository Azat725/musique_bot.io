/** What the driver does: WASD or the arrows on a keyboard; on a phone the wheel is turned by a finger going round it
 *  (it springs back when let go) and the two pedals are pressed with the other hand. Several fingers work at once.
 *  Keys are read by their position (`e.code`), so they work in any keyboard layout. */

const MAX = 190 * Math.PI / 180; // how far the wheel turns each way
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const KEYS = { KeyW: 'gas', ArrowUp: 'gas', KeyS: 'brake', ArrowDown: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'hand' };

/** `parts` = { wheel (the finger target), gas, brake, horn, lights } elements; `on` = { lights(), horn(bool) } callbacks. */
export function createControls(parts, on) {
  const held = new Set(), pressed = new Set();
  let throttle = 0, brake = 0, keySteer = 0, angle = 0, lastAngle = 0, finger = null;
  const off = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); off.push(() => target.removeEventListener(type, fn, opts)); };

  listen(window, 'keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (KEYS[e.code]) { held.add(KEYS[e.code]); e.preventDefault(); }
    else if (e.code === 'KeyL' && !e.repeat) on.lights();
    else if (e.code === 'KeyH' && !e.repeat) on.horn(true);
  });
  listen(window, 'keyup', (e) => {
    if (KEYS[e.code]) held.delete(KEYS[e.code]);
    else if (e.code === 'KeyH') on.horn(false);
  });
  listen(window, 'blur', () => { held.clear(); pressed.clear(); on.horn(false); });

  // the pedals: a finger or the mouse held down
  for (const [name, el] of [['gas', parts.gas], ['brake', parts.brake]]) {
    const ids = new Set();
    const set = () => { if (ids.size) pressed.add(name); else pressed.delete(name); el.classList.toggle('is-down', ids.size > 0); };
    listen(el, 'pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); ids.add(e.pointerId); set(); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(el, type, (e) => { ids.delete(e.pointerId); set(); });
  }
  listen(parts.horn, 'pointerdown', (e) => { e.preventDefault(); parts.horn.setPointerCapture(e.pointerId); on.horn(true); parts.horn.classList.add('is-down'); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(parts.horn, type, () => { on.horn(false); parts.horn.classList.remove('is-down'); });
  listen(parts.lights, 'click', () => on.lights());

  // the wheel: the finger goes round its middle
  const at = (e) => { const r = parts.wheel.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
  listen(parts.wheel, 'pointerdown', (e) => { if (finger !== null) return; e.preventDefault(); finger = e.pointerId; parts.wheel.setPointerCapture(e.pointerId); lastAngle = at(e); });
  listen(parts.wheel, 'pointermove', (e) => {
    if (e.pointerId !== finger) return;
    const a = at(e);
    angle = clamp(angle + norm(a - lastAngle), -MAX, MAX);
    lastAngle = a;
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(parts.wheel, type, (e) => { if (e.pointerId === finger) finger = null; });

  return {
    /** The pedals and the wheel as the car wants them for the next `dt` seconds. */
    read(dt) {
      const gas = held.has('gas') || pressed.has('gas') ? 1 : 0, brk = held.has('brake') || pressed.has('brake') ? 1 : 0;
      throttle += clamp(gas - throttle, -5 * dt, 3.5 * dt);
      brake += clamp(brk - brake, -6 * dt, 6 * dt);
      const key = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
      keySteer += clamp(key - keySteer, -(key ? 2.6 : 4.5) * dt, (key ? 2.6 : 4.5) * dt);
      if (finger === null) angle *= Math.exp(-7 * dt); // the wheel springs back
      const steer = clamp(keySteer + angle / MAX, -1, 1);
      return { throttle, brake, steer, hand: held.has('hand'), wheelDeg: steer * MAX * 180 / Math.PI };
    },
    destroy() { off.forEach((f) => f()); },
  };
}
