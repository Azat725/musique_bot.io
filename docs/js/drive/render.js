/** Draws the night town from the driver's seat on a canvas: a small perspective engine of our own (flat polygons, painter's
 *  order, no gradients). Everything is a flat colour; the darkness and the distance are colours mixed towards the night
 *  sky, step by step. No imports: the world, the style and the state come in as arguments. */

const NEAR = 0.5, EYE = 1.15, FOV = 78 * Math.PI / 180;
const SKY = ['#04070D', '#070C16', '#0B1322', '#111B30', '#1A2842', '#25365A'];
const FOG = '#1B2744';
const ASPHALT = '#14161B', PAVEMENT = '#2D323A', MARK = '#B4B096';

const rgbCache = new Map(), mixCache = new Map();
const rgb = (c) => { let v = rgbCache.get(c); if (!v) { v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); rgbCache.set(c, v); } return v; };
/** `a` mixed towards `b` by t (0..1), in 16 steps so the same strings come back. */
function mix(a, b, t) {
  const k = Math.round(Math.min(1, Math.max(0, t)) * 16), key = a + b + k;
  let v = mixCache.get(key);
  if (!v) { const x = rgb(a), y = rgb(b), u = k / 16; v = '#' + x.map((c, i) => Math.round(c + (y[i] - c) * u).toString(16).padStart(2, '0')).join(''); mixCache.set(key, v); }
  return v;
}
const night = (c, t = 0.7) => mix(c, '#04060B', t);
const hashInt = (a, b, c, d) => (Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663) ^ Math.imul(c + 1, 83492791) ^ Math.imul(d + 1, 2654435761)) >>> 0;

export function createRenderer(canvas, world, style) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let W = 1, H = 1, focal = 1, hor = 0, vis = 200, visWanted = 200, quality = 1;
  let camX = 0, camY = 0, cosH = 1, sinH = 0, camH = 0, jitterX = 0;
  const stars = Array.from({ length: 90 }, (_, i) => ({ a: ((hashInt(i, 1, 2, 3) % 6283) / 1000) - Math.PI, e: (hashInt(i, 4, 5, 6) % 1000) / 1000, s: 1 + (hashInt(i, 7, 8, 9) % 3) * 0.4 }));

  function resize() {
    const box = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2) * quality;
    W = Math.max(1, Math.round(box.width)); H = Math.max(1, Math.round(box.height));
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    focal = W / (2 * Math.tan(FOV / 2));
    hor = H * 0.37;
  }

  // ----- projection -----
  const fwd = (x, y) => (x - camX) * cosH + (y - camY) * sinH;
  const side = (x, y) => (x - camX) * sinH - (y - camY) * cosH;
  const sx = (r, f) => W / 2 + jitterX + focal * r / f;
  const sy = (z, f) => hor + focal * (EYE - z) / f;
  const fog = (c, d) => mix(c, FOG, Math.pow(Math.min(1, d / vis), 1.35) * 0.92);

  /** A flat polygon in the world → screen points (clipped at the near plane), or null. */
  function project(pts) {
    const cam = pts.map((p) => [side(p[0], p[1]), EYE - p[2], fwd(p[0], p[1])]);
    const out = [];
    for (let i = 0; i < cam.length; i++) {
      const a = cam[i], b = cam[(i + 1) % cam.length], ina = a[2] >= NEAR, inb = b[2] >= NEAR;
      if (ina) out.push(a);
      if (ina !== inb) { const t = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]); }
    }
    return out.length < 3 ? null : out.map((p) => [W / 2 + jitterX + focal * p[0] / p[2], hor + focal * p[1] / p[2]]);
  }
  function fillPoly(pts, color) {
    const s = project(pts);
    if (!s) return false;
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]);
    ctx.closePath(); ctx.fill();
    return true;
  }
  const dist = (x, y) => Math.hypot(x - camX, y - camY);

  // ----- the sky -----
  function drawSky(t) {
    const bandH = hor / SKY.length;
    SKY.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * bandH, W, bandH + 1); });
    ctx.fillStyle = '#E8E4D2';
    for (const s of stars) {
      let a = s.a - camH; a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) > FOV / 2 + 0.1) continue;
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(t * 1.3 + s.a * 9);
      ctx.fillRect(W / 2 + jitterX + a * focal, s.e * hor * 0.8, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    let m = 2.2 - camH; m = Math.atan2(Math.sin(m), Math.cos(m));
    if (Math.abs(m) < FOV / 2 + 0.2) { const mx = W / 2 + jitterX + m * focal, my = hor * 0.3; ctx.fillStyle = '#F3EEDC'; ctx.beginPath(); ctx.arc(mx, my, Math.max(8, W * 0.016), 0, 7); ctx.fill(); ctx.fillStyle = SKY[2]; ctx.beginPath(); ctx.arc(mx + 5, my - 3, Math.max(7, W * 0.014), 0, 7); ctx.fill(); }
  }

  // ----- the ground: the road, the pavements, the markings -----
  function drawGround() {
    ctx.fillStyle = ASPHALT; ctx.fillRect(0, hor, W, H - hor);
    for (const [d, k] of [[320, 1], [220, 0.8], [150, 0.6], [100, 0.4], [60, 0.25]]) { // the far ground fades into the night
      const y = sy(0, d);
      ctx.fillStyle = mix(ASPHALT, FOG, k); ctx.fillRect(0, y, W, H - y);
    }
    const { blocks, cell, half, walk } = world;
    for (const b of blocks) {
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, d = dist(cx, cy);
      if (d > 360 || (fwd(cx, cy) < -90)) continue;
      const pad = walk; // the pavement runs 3 m past the houses
      fillPoly([[b.x0 - pad, b.y0 - pad, 0], [b.x1 + pad, b.y0 - pad, 0], [b.x1 + pad, b.y1 + pad, 0], [b.x0 - pad, b.y1 + pad, 0]], fog(b.kind === 'park' ? '#142A1E' : PAVEMENT, Math.max(0, d - 40)));
    }
    // the middle line and the crossings, only near the car
    const near = 170;
    for (let line = 0; line <= world.size / cell; line++) {
      const at = line * cell;
      for (const vertical of [true, false]) {
        const off = vertical ? Math.abs(camX - at) : Math.abs(camY - at);
        if (off > near) continue;
        const along = vertical ? camY : camX;
        for (let p = Math.floor((along - near) / 9) * 9; p < along + near; p += 9) {
          if (p < -half || p > world.size + half) continue;
          const mod = ((p % cell) + cell) % cell;
          if (mod < half + 4 || mod > cell - half - 4) continue;
          const d = off + Math.abs(p - along);
          fillPoly(vertical ? [[at - 0.1, p, 0.01], [at + 0.1, p, 0.01], [at + 0.1, p + 3.2, 0.01], [at - 0.1, p + 3.2, 0.01]] : [[p, at - 0.1, 0.01], [p + 3.2, at - 0.1, 0.01], [p + 3.2, at + 0.1, 0.01], [p, at + 0.1, 0.01]], fog(MARK, d));
        }
      }
    }
    for (let i = 0; i <= world.size / cell; i++) for (let j = 0; j <= world.size / cell; j++) {
      const x = i * cell, y = j * cell, d = dist(x, y);
      if (d > 110 || fwd(x, y) < -30) continue;
      for (let k = -2; k < 3; k++) for (const [ax, ay, bx, by] of [[1, 0, 0, 1], [-1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0]]) { // zebra stripes on the four arms
        const px = x + ax * (half + 1.6) + bx * k * 2.2, py = y + ay * (half + 1.6) + by * k * 2.2;
        const w = ax ? 1.2 : 0.55, l = ax ? 0.55 : 1.2;
        fillPoly([[px - w, py - l, 0.01], [px + w, py - l, 0.01], [px + w, py + l, 0.01], [px - w, py + l, 0.01]], fog('#9A9884', d));
      }
    }
  }

  function drawBeams(car) {
    const c = Math.cos(car.h), s = Math.sin(car.h), p = (a, b, z = 0.02) => [car.x + a * c - b * s, car.y + a * s + b * c, z];
    fillPoly([p(2, -1), p(2, 1), p(46, 11), p(46, -11)], 'rgba(255,232,180,0.05)');
    fillPoly([p(2, -0.8), p(2, 0.8), p(28, 5), p(28, -5)], 'rgba(255,232,180,0.06)');
    fillPoly([p(2, -0.6), p(2, 0.6), p(14, 2.2), p(14, -2.2)], 'rgba(255,232,180,0.07)');
  }

  // ----- walls with their windows -----
  function wall(b, ax, ay, bx, by, index, d) {
    const fa = fwd(ax, ay), fb = fwd(bx, by), ra = side(ax, ay), rb = side(bx, by);
    if (fa < NEAR && fb < NEAR) return;
    // the part of the wall in front of the near plane, as a share u of its length
    let u0 = 0, u1 = 1;
    if (fa < NEAR) u0 = (NEAR - fa) / (fb - fa); else if (fb < NEAR) u1 = (fa - NEAR) / (fa - fb);
    const L = Math.hypot(bx - ax, by - ay), tone = night(style.walls[b.tone] || style.walls[0], 0.74 + (index % 2 ? 0.05 : 0));
    const r = (u) => ra + (rb - ra) * u, f = (u) => fa + (fb - fa) * u;
    const quad = (ua, ub, z0, z1) => { ctx.moveTo(sx(r(ua), f(ua)), sy(z0, f(ua))); ctx.lineTo(sx(r(ub), f(ub)), sy(z0, f(ub))); ctx.lineTo(sx(r(ub), f(ub)), sy(z1, f(ub))); ctx.lineTo(sx(r(ua), f(ua)), sy(z1, f(ua))); ctx.closePath(); };
    ctx.fillStyle = fog(tone, d); ctx.beginPath(); quad(u0, u1, 0, b.h); ctx.fill();
    const wide = Math.abs(sx(r(u1), f(u1)) - sx(r(u0), f(u0)));
    if (wide < 10 || d > 150) return;
    const cols = Math.max(1, Math.floor(L / style.col)), floors = Math.max(1, Math.floor(b.h / style.floor));
    const lit = [], dark = [], shop = [];
    for (let c = 0; c < cols; c++) {
      const ua = (c + 0.22) / cols, ub = (c + 0.78) / cols;
      if (ua < u0 || ub > u1) continue;
      for (let row = 0; row < floors; row++) {
        const z0 = row === 0 ? 0.5 : row * style.floor + 0.9, z1 = row === 0 ? 2.7 : z0 + 1.45;
        if (z1 > b.h - 0.3) continue;
        if (sy(z0, f(ua)) - sy(z1, f(ua)) < 1.6) continue;
        const h = hashInt(b.id, index, c, row) % 100;
        (row === 0 ? (h < 82 ? shop : dark) : h < 46 ? lit : dark).push([ua, ub, z0, z1]);
      }
    }
    for (const [list, colour] of [[dark, '#0C1018'], [lit, '#F3C25A'], [shop, '#FFB347']]) {
      if (!list.length) continue;
      ctx.fillStyle = fog(colour, d * (colour === '#0C1018' ? 1 : 0.55)); ctx.beginPath();
      for (const q of list) quad(q[0], q[1], q[2], q[3]);
      ctx.fill();
    }
    if (b.cinema && L > 14 && u0 < 0.1 && u1 > 0.9) { // a big lit marquee with the word over the door
      ctx.fillStyle = fog('#FFE27A', d * 0.5); ctx.beginPath(); quad(0.08, 0.92, 4.4, 6.6); ctx.fill();
      ctx.fillStyle = fog('#E0554A', d * 0.5); ctx.beginPath(); quad(0.45, 0.55, 6.6, Math.min(b.h, 11)); ctx.fill();
      const x0 = sx(r(0.08), f(0.08)), x1 = sx(r(0.92), f(0.92)), yTop = sy(6.6, f(0.5)), yBot = sy(4.4, f(0.5));
      if (x1 - x0 > 60 && yBot - yTop > 8) {
        ctx.fillStyle = '#7A1620'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `700 ${Math.max(8, (yBot - yTop) * 0.7)}px system-ui, sans-serif`;
        ctx.fillText(style.cinema, (x0 + x1) / 2, (yTop + yBot) / 2, (x1 - x0) * 0.8);
      }
    } else if (!b.cinema && hashInt(b.id, 3, 4, 5) % 100 < style.neonShare * 100) { // a neon sign down the corner
      const colour = style.neon[hashInt(b.id, 9, 9, 9) % style.neon.length];
      ctx.fillStyle = fog(colour, d * 0.45); ctx.beginPath(); quad(0.03, 0.07, 3, Math.min(b.h - 1, 3 + 7)); ctx.fill();
    }
  }

  function building(b, d) {
    // each of the four walls, when the camera is outside it
    if (camY < b.y0) wall(b, b.x0, b.y0, b.x1, b.y0, 0, d);
    if (camX > b.x1) wall(b, b.x1, b.y0, b.x1, b.y1, 1, d);
    if (camY > b.y1) wall(b, b.x1, b.y1, b.x0, b.y1, 2, d);
    if (camX < b.x0) wall(b, b.x0, b.y1, b.x0, b.y0, 3, d);
  }

  // ----- the other cars -----
  const SHAPE = { round: { cab: [-1.05, 0.75], body: 0.98, roof: 1.52 }, box: { cab: [-1.35, 0.8], body: 0.88, roof: 1.46 }, smooth: { cab: [-0.9, 0.95], body: 0.84, roof: 1.36 } };
  const at = (car, a, b, z) => { const c = Math.cos(car.h), s = Math.sin(car.h); return [car.x + a * c - b * s, car.y + a * s + b * c, z]; };
  /** Is the face of a car with this outward direction (in the car's own frame) turned towards the camera? */
  function facing(car, na, nb, a, b) {
    const c = Math.cos(car.h), s = Math.sin(car.h), nx = na * c - nb * s, ny = na * s + nb * c, p = at(car, a, b, 0);
    return (camX - p[0]) * nx + (camY - p[1]) * ny > 0;
  }
  function vehicle(car, d) {
    const L = car.len / 2, Wd = car.wid / 2, shape = SHAPE[style.cars], body = night(car.colour, 0.55);
    const box = (z0, z1, x0, x1, cabin) => {
      for (const [a0, b0, a1, b1, na, nb] of [[x1, Wd, x1, -Wd, 1, 0], [x0, -Wd, x0, Wd, -1, 0], [x1, -Wd, x0, -Wd, 0, -1], [x0, Wd, x1, Wd, 0, 1]]) {
        if (!facing(car, na, nb, (a0 + a1) / 2, (b0 + b1) / 2)) continue;
        const colour = cabin ? mix('#0B121C', body, 0.25) : mix(body, '#000000', na ? 0 : 0.14);
        fillPoly([at(car, a0, b0, z0), at(car, a1, b1, z0), at(car, a1, b1, z1), at(car, a0, b0, z1)], fog(colour, d));
      }
    };
    box(0.28, shape.body, -L, L, false);
    fillPoly([at(car, L, Wd, shape.body), at(car, L, -Wd, shape.body), at(car, -L, -Wd, shape.body), at(car, -L, Wd, shape.body)], fog(mix(body, '#FFFFFF', 0.1), d)); // the bonnet, seen from above
    box(shape.body, shape.roof, shape.cab[0], shape.cab[1], true);
    for (const sg of [1, -1]) if (facing(car, 0, sg, 0, sg * Wd)) for (const wa of [-L * 0.62, L * 0.62]) fillPoly([at(car, wa - 0.34, sg * Wd, 0), at(car, wa + 0.34, sg * Wd, 0), at(car, wa + 0.34, sg * Wd, 0.66), at(car, wa - 0.34, sg * Wd, 0.66)], fog('#06080C', d));
    const front = facing(car, 1, 0, L, 0), back = facing(car, -1, 0, -L, 0);
    if ((front || back) && d < 150) { // headlamps in front, tail lamps behind (brighter when braking)
      const lamp = front ? '#FFF3C4' : car.braking ? '#FF5A4A' : '#C42424', e = front ? L : -L, bz = style.cars === 'round' ? 0.58 : 0.62;
      for (const sg of [-1, 1]) {
        fillPoly([at(car, e, sg * Wd * 0.8, bz - 0.1), at(car, e, sg * Wd * 0.4, bz - 0.1), at(car, e, sg * Wd * 0.4, bz + 0.12), at(car, e, sg * Wd * 0.8, bz + 0.12)], lamp);
        const q = at(car, e, sg * Wd * 0.6, bz), f = fwd(q[0], q[1]);
        if (f > NEAR) { ctx.globalAlpha = 0.28; ctx.fillStyle = lamp; ctx.beginPath(); ctx.arc(sx(side(q[0], q[1]), f), sy(bz, f), Math.max(2, focal * 0.4 / f), 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
      }
    }
  }

  // ----- people, lamps, lights, trees: billboards -----
  function person(p, d) {
    const f = fwd(p.x, p.y);
    if (f < 1.2 || f > 95) return;
    const k = focal / f, x = sx(side(p.x, p.y), f), y = sy(0, f), hgt = 1.72 * p.tall * k;
    if (x < -60 || x > W + 60) return;
    const swing = Math.sin(p.phase) * 0.2 * k, coat = fog(night(p.coat, 0.5), d);
    ctx.fillStyle = fog('#0B0D12', d);
    ctx.fillRect(x - 0.17 * k + swing, y - hgt * 0.5, 0.13 * k, hgt * 0.5); ctx.fillRect(x + 0.04 * k - swing, y - hgt * 0.5, 0.13 * k, hgt * 0.5);
    ctx.fillStyle = coat; ctx.fillRect(x - 0.23 * k, y - hgt * 0.86, 0.46 * k, hgt * 0.4);
    ctx.fillStyle = fog('#6A5547', d); ctx.beginPath(); ctx.arc(x, y - hgt * 0.92, 0.11 * k, 0, 7); ctx.fill();
    if (p.hat) { ctx.fillStyle = fog('#15161A', d); ctx.fillRect(x - 0.17 * k, y - hgt * 0.97, 0.34 * k, 0.05 * k); ctx.fillRect(x - 0.1 * k, y - hgt * 1.04, 0.2 * k, 0.09 * k); }
  }
  function lamp(l, d) {
    const hx = l.x + (l.axis === 'v' ? l.arm * 1.4 : 0), hy = l.y + (l.axis === 'h' ? l.arm * 1.4 : 0);
    const f0 = fwd(l.x, l.y), f1 = fwd(hx, hy);
    if (f0 < NEAR || f1 < NEAR) return;
    const k = focal / f0, x0 = sx(side(l.x, l.y), f0), y0 = sy(0, f0), y1 = sy(6.4, f0), x1 = sx(side(hx, hy), f1), yh = sy(6.4, f1);
    ctx.strokeStyle = fog('#0B0E14', d); ctx.lineWidth = Math.max(1, 0.16 * k);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, yh); ctx.stroke();
    ctx.fillStyle = style.lamp; ctx.beginPath(); ctx.arc(x1, yh, Math.max(1.5, 0.28 * focal / f1), 0, 7); ctx.fill();
    ctx.globalAlpha = 0.16; ctx.beginPath(); ctx.arc(x1, yh, Math.max(3, 1.6 * focal / f1), 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    if (d < 85) { // the pool of light on the ground
      const pool = (rad) => Array.from({ length: 12 }, (_, i) => [hx + Math.cos(i / 12 * 6.283) * rad, hy + Math.sin(i / 12 * 6.283) * rad, 0.02]);
      fillPoly(pool(6.5), 'rgba(255,214,150,0.07)'); fillPoly(pool(3.2), 'rgba(255,214,150,0.09)');
    }
  }
  function trafficLight(l, d) {
    const f = fwd(l.x, l.y);
    if (f < 1 || f > 130) return;
    const k = focal / f, x = sx(side(l.x, l.y), f), y0 = sy(0, f), y1 = sy(3.7, f);
    ctx.strokeStyle = fog('#0B0E14', d); ctx.lineWidth = Math.max(1, 0.12 * k); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    ctx.fillStyle = fog('#0B0E14', d); ctx.fillRect(x - 0.17 * k, y1 - 0.9 * k, 0.34 * k, 0.95 * k);
    ctx.fillStyle = '#3A1212'; ctx.beginPath(); ctx.arc(x, y1 - 0.72 * k, 0.1 * k, 0, 7); ctx.fill();
    ctx.fillStyle = '#3A2E12'; ctx.beginPath(); ctx.arc(x, y1 - 0.45 * k, 0.1 * k, 0, 7); ctx.fill();
    ctx.fillStyle = '#4CFF92'; ctx.beginPath(); ctx.arc(x, y1 - 0.18 * k, 0.11 * k, 0, 7); ctx.fill(); // always green
    ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(x, y1 - 0.18 * k, 0.45 * k, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  }
  function tree(t, d) {
    const f = fwd(t.x, t.y);
    if (f < 1 || f > 120) return;
    const k = focal / f, x = sx(side(t.x, t.y), f), y = sy(0, f);
    ctx.fillStyle = fog('#0B0D10', d); ctx.fillRect(x - 0.14 * k * t.s, y - 2.4 * k * t.s, 0.28 * k * t.s, 2.4 * k * t.s);
    ctx.fillStyle = fog('#0D2A1F', d); ctx.beginPath(); ctx.arc(x, y - 4 * k * t.s, 2.3 * k * t.s, 0, 7); ctx.fill();
    ctx.fillStyle = fog('#0A2018', d); ctx.beginPath(); ctx.arc(x + 0.9 * k * t.s, y - 3.3 * k * t.s, 1.7 * k * t.s, 0, 7); ctx.fill();
  }

  /** Draws one frame. `f` = { car, traffic, lights, time, shake }. */
  function draw(f) {
    const { car, traffic, lights, time, shake = 0 } = f;
    camH = car.h; cosH = Math.cos(car.h); sinH = Math.sin(car.h);
    const seat = style.lht ? 0.35 : -0.35; // the driver sits on the right in Britain and Japan
    camX = car.x + cosH * 0.3 + sinH * seat; camY = car.y + sinH * 0.3 - cosH * seat;
    jitterX = shake ? (Math.random() - 0.5) * shake : 0;
    visWanted = lights ? 330 : 190; vis += (visWanted - vis) * 0.08;
    drawSky(time);
    drawGround();
    if (lights) drawBeams(car);
    const items = [];
    for (const b of world.buildings) {
      const nx = Math.max(b.x0, Math.min(camX, b.x1)), ny = Math.max(b.y0, Math.min(camY, b.y1)), d = Math.hypot(nx - camX, ny - camY);
      if (d > 290) continue;
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, reach = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2;
      if (fwd(cx, cy) < -reach) continue;
      items.push({ k: 0, o: b, d });
    }
    for (const l of world.lamps) { const d = dist(l.x, l.y); if (d < 115 && fwd(l.x, l.y) > 0) items.push({ k: 1, o: l, d }); }
    for (const l of world.lights) { const d = dist(l.x, l.y); if (d < 120 && fwd(l.x, l.y) > 0) items.push({ k: 2, o: l, d }); }
    for (const t of world.trees) { const d = dist(t.x, t.y); if (d < 120 && fwd(t.x, t.y) > 0) items.push({ k: 3, o: t, d }); }
    for (const c of traffic.cars) { const d = dist(c.x, c.y); if (d < 200 && fwd(c.x, c.y) > -6) items.push({ k: 4, o: c, d }); }
    for (const p of traffic.peds) { const d = dist(p.x, p.y); if (d < 70 && fwd(p.x, p.y) > 0) items.push({ k: 5, o: p, d }); }
    items.sort((a, b) => b.d - a.d);
    for (const it of items) {
      if (it.k === 0) building(it.o, it.d); else if (it.k === 1) lamp(it.o, it.d); else if (it.k === 2) trafficLight(it.o, it.d);
      else if (it.k === 3) tree(it.o, it.d); else if (it.k === 4) vehicle(it.o, it.d); else person(it.o, it.d);
    }
  }

  resize();
  return { draw, resize, setQuality(q) { quality = q; resize(); } };
}
