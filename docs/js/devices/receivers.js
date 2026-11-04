/** The radio's receivers: twelve cars seen from the driver's seat (the dashboard with its radio) and thirteen home
 *  sets, each drawn with what makes it recognisable (the DS's single spoke, the Fiat 500's body-coloured dash, the
 *  Mini's middle speedometer, the cube that opens, the ball on a chain...). Flat shapes only, stylised, not replicas.
 *
 *  A receiver is { id, kind: 'car' | 'home', name, year, country, unit, band: 'am' | 'fm', screen, art() }:
 *  `screen` is where its dial or display lies in the drawing ([x, y, w, h] of the viewBox: 400×240 for a car, 400×300
 *  at home) and how it shows the station: 'dial' (a scale and a needle), 'vfd' (a glowing display) or 'lcd'. Parts a
 *  finger can press carry data-key: toggle (power), tune (the tuning knob), preset (with data-n), prev / next (seek),
 *  wipers and drive (a car's rain and road). */

const R = (x, y, w, h, f, rx = 0, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}" ${extra}/>`;
const C = (x, y, r, f, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}" ${extra}/>`;
const P = (d, f, extra = '') => `<path d="${d}" fill="${f}" ${extra}/>`;
const L = (d, stroke, w = 2, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" ${extra}/>`;
const key = (name, inner, extra = '') => `<g class="rx-key" data-key="${name}" ${extra}>${inner}</g>`;

/** A round knob with a pointer line (it turns while tuning: .rx-knob). */
function knob(name, x, y, r, body, cap, mark = '#00000066') {
  return key(name, `${C(x, y, r, body)}${C(x, y, r * 0.74, cap)}<g class="rx-knob" style="transform-origin:${x}px ${y}px">${R(x - 1.5, y - r * 0.7, 3, r * 0.42, mark, 1.5)}</g>`);
}

/** A row of push keys (presets): `n` keys from x, each w × h, with an optional light line on top. */
function keys(x, y, n, w, h, gap, fill, top = null, rx = 2) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const kx = x + i * (w + gap);
    out += key('preset', `${R(kx, y, w, h, fill, rx)}${top ? R(kx + 2, y + 2, w - 4, 3, top, 1) : ''}`, `data-n="${i}"`);
  }
  return out;
}

/** Vertical slots, horizontal bars or a field of dots: the speaker. */
function slotsV(x, y, w, h, n, f, gap = 0.45) {
  const step = w / n;
  return Array.from({ length: n }, (_, i) => R(x + i * step + step * gap / 2, y, step * (1 - gap), h, f, step * 0.3)).join('');
}
function barsH(x, y, w, h, n, f, gap = 0.45) {
  const step = h / n;
  return Array.from({ length: n }, (_, i) => R(x, y + i * step + step * gap / 2, w, step * (1 - gap), f, step * 0.3)).join('');
}
function dots(cx, cy, rad, step, f, dotR = 1.6) {
  let out = '';
  for (let y = -rad; y <= rad; y += step) for (let x = -rad; x <= rad; x += step) if (x * x + y * y <= rad * rad) out += C(cx + x, cy + y, dotR, f);
  return out;
}

// ---------- cars: the dashboard from the driver's seat (400 × 240), the windshield is drawn above it by the page ----------

/** Part of the steering wheel at the bottom left: `spokes` 1 (the DS), 2, 3 or 4. */
function wheel({ x = 92, y = 268, r = 112, rim = '#1B1A1A', hub = '#2A2928', spokes = 2, ring = null, width = 13 }) {
  const angles = { 1: [-62], 2: [-160, -20], 3: [-150, -30, 90], 4: [-140, -40, 40, 140] }[spokes];
  const arms = angles.map((a) => {
    const rad = a * Math.PI / 180, ex = x + Math.cos(rad) * r, ey = y + Math.sin(rad) * r;
    return L(`M${x} ${y} L${ex.toFixed(1)} ${ey.toFixed(1)}`, hub, spokes === 1 ? 15 : 11);
  }).join('');
  return `<g class="rx-wheel">${arms}${ring ? `<circle cx="${x}" cy="${y}" r="${r * 0.55}" fill="none" stroke="${ring}" stroke-width="4"/>` : ''}
    ${C(x, y, spokes === 1 ? 26 : 32, hub)}<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${rim}" stroke-width="${width}"/></g>`;
}

/** A round gauge: rim, face, ticks and a needle that moves when the car drives (.rx-needle). */
function gauge(x, y, r, { rim = '#C9C9C4', face = '#111', tick = '#E8E2D0', needle = '#E2562C', ticks = 9 } = {}) {
  let t = '';
  for (let i = 0; i < ticks; i++) {
    const a = (-210 + i * (240 / (ticks - 1))) * Math.PI / 180;
    t += L(`M${(x + Math.cos(a) * r * 0.78).toFixed(1)} ${(y + Math.sin(a) * r * 0.78).toFixed(1)} L${(x + Math.cos(a) * r * 0.62).toFixed(1)} ${(y + Math.sin(a) * r * 0.62).toFixed(1)}`, tick, 1.6);
  }
  return `${C(x, y, r, rim)}${C(x, y, r * 0.88, face)}${t}<g class="rx-needle" style="transform-origin:${x}px ${y}px">${L(`M${x} ${y} L${x - r * 0.55} ${y + r * 0.2}`, needle, 2.4)}</g>${C(x, y, r * 0.1, rim)}`;
}

/** The two car-only switches: the wiper stalk (rain) and the key in the ignition (the road). */
function carSwitches(x, y, color = '#222', light = '#888') {
  return key('wipers', `${R(x, y, 38, 9, color, 4.5)}${C(x + 34, y + 4.5, 6, light)}`)
    + key('drive', `${C(x + 8, y + 34, 11, light)}${C(x + 8, y + 34, 7, color)}${R(x + 4, y + 31, 16, 6, '#C8A54A', 2, 'class="rx-ignition"')}`);
}

const CARS = [
  {
    id: 'roadmaster', name: 'Buick Roadmaster', year: 1949, country: 'us', unit: 'Sonomatic', band: 'am', screen: [146, 70, 140, 34, 'dial'],
    art: () => `${R(0, 30, 400, 210, '#5D1E24', 0)}${R(0, 30, 400, 14, '#3F1418')}${R(118, 52, 196, 136, '#C9CBC9', 18)}${R(126, 60, 180, 120, '#8E9192', 12)}
      ${R(140, 66, 152, 42, '#3D3A33', 6)}${barsH(140, 116, 152, 56, 8, '#D8DAD8')}${knob('toggle', 127, 86, 13, '#E6E1D3', '#D2CBB8')}${knob('tune', 305, 86, 13, '#E6E1D3', '#D2CBB8')}
      ${keys(160, 176, 5, 20, 9, 4, '#EFEBDF', null, 2)}${gauge(330, 132, 34, { rim: '#D6D6D2', face: '#E9E2CB', tick: '#3B2A22', needle: '#9E1E24' })}
      ${wheel({ rim: '#EDE6D3', hub: '#C9CBC9', spokes: 3, ring: '#C9CBC9', width: 9 })}${carSwitches(338, 190, '#2B1012', '#C9CBC9')}`,
  },
  {
    id: 'belair', name: 'Chevrolet Bel Air', year: 1957, country: 'us', unit: 'Delco Wonder Bar', band: 'am', screen: [150, 96, 134, 26, 'dial'],
    art: () => `${R(0, 30, 400, 210, '#E9E4D8')}${R(0, 30, 400, 44, '#2F7C8A')}${P('M60 74 Q200 40 340 74 Z', '#2F7C8A')}${R(130, 84, 172, 92, '#D4D6D4', 10)}${R(138, 90, 156, 38, '#2C2B28', 4)}
      ${key('next', R(146, 132, 140, 10, '#F1EFE7', 5) + R(146, 132, 140, 3, '#FFFFFF', 1.5))}${slotsV(150, 148, 132, 22, 14, '#8C9091')}
      ${knob('toggle', 120, 108, 13, '#F4F1E8', '#D9D3C3')}${knob('tune', 312, 108, 13, '#F4F1E8', '#D9D3C3')}${keys(156, 178, 5, 22, 9, 3, '#C9CBC9', '#F7F7F4')}
      ${P('M30 100 A70 46 0 0 1 170 100 Z', '#1E2A2D')}${L('M45 98 A55 34 0 0 1 155 98', '#E8E2D0', 3)}<g class="rx-needle" style="transform-origin:100px 100px">${L('M100 100 L58 86', '#E2562C', 3)}</g>
      ${wheel({ rim: '#EEE9DC', hub: '#D4D6D4', spokes: 2, ring: '#D4D6D4', width: 10 })}${carSwitches(340, 186, '#2F7C8A', '#D4D6D4')}`,
  },
  {
    id: 'volga', name: 'ГАЗ-21 «Волга»', year: 1959, country: 'ussr', unit: 'А-9', band: 'am', screen: [150, 98, 132, 28, 'dial'],
    art: () => `${R(0, 30, 400, 210, '#C9BFA6')}${R(0, 30, 400, 30, '#8F2B22')}${R(20, 64, 140, 30, '#2A2620', 15)}${R(28, 70, 124, 18, '#E9E0C6', 9)}
      <g class="rx-needle" style="transform-origin:40px 79px">${L('M40 79 L64 79', '#B12A20', 3)}</g>${R(132, 90, 168, 80, '#D9D8D2', 6)}${R(140, 96, 152, 32, '#3B2E1E', 3)}
      ${keys(150, 140, 5, 22, 16, 4, '#EDE3C9', null, 3)}${knob('toggle', 120, 130, 13, '#EDE3C9', '#DCCFAE')}${knob('tune', 312, 130, 13, '#EDE3C9', '#DCCFAE')}
      ${wheel({ rim: '#EFE7CF', hub: '#EFE7CF', spokes: 3, ring: '#D9D8D2', width: 9 })}${carSwitches(336, 182, '#5A4A35', '#D9D8D2')}`,
  },
  {
    id: 'fiat500', name: 'Fiat 500', year: 1965, country: 'it', unit: 'Autovox', band: 'am', screen: [156, 136, 112, 20, 'dial'],
    art: () => `${R(0, 30, 400, 210, '#1E1C1B')}${R(0, 56, 400, 54, '#7FAFC6')}${R(0, 56, 400, 6, '#9CC4D6')}${gauge(150, 82, 22, { rim: '#E6E4DD', face: '#F2EEE2', tick: '#222', needle: '#C0392B' })}
      ${R(130, 124, 160, 50, '#2A2827', 4)}${R(136, 130, 148, 30, '#101010', 3)}${keys(150, 164, 5, 18, 8, 6, '#EDE7D6', null, 1.5)}
      ${knob('toggle', 120, 146, 10, '#D8D2C2', '#BDB5A0')}${knob('tune', 300, 146, 10, '#D8D2C2', '#BDB5A0')}${R(330, 70, 40, 14, '#E6E4DD', 7)}
      ${wheel({ rim: '#151414', hub: '#151414', spokes: 2, width: 9, r: 104 })}${carSwitches(330, 186, '#111', '#BDB5A0')}`,
  },
  {
    id: 'ds', name: 'Citroën DS', year: 1965, country: 'fr', unit: 'Radiola', band: 'am', screen: [156, 102, 124, 24, 'dial'],
    art: () => `${R(0, 30, 400, 210, '#B8B9B6')}${P('M0 30 H400 V70 Q200 96 0 70 Z', '#7D1F23')}${P('M30 76 Q100 60 180 82 L172 104 Q100 86 36 98 Z', '#262626')}
      ${gauge(70, 90, 13, { rim: '#9C9E9B', face: '#F1EFE7', tick: '#222' })}${gauge(110, 88, 13, { rim: '#9C9E9B', face: '#F1EFE7', tick: '#222' })}
      ${R(140, 96, 156, 62, '#E4E2DC', 8)}${R(150, 100, 136, 30, '#2E2A24', 4)}${keys(158, 138, 4, 26, 12, 5, '#7D1F23', '#A13037', 6)}
      ${knob('toggle', 128, 128, 11, '#F2F1EC', '#D6D4CC')}${knob('tune', 308, 128, 11, '#F2F1EC', '#D6D4CC')}
      ${wheel({ rim: '#E8E5DC', hub: '#E8E5DC', spokes: 1, width: 11, r: 108 })}${carSwitches(334, 182, '#7D1F23', '#E8E5DC')}`,
  },
  {
    id: 'mini', name: 'Mini Cooper', year: 1965, country: 'uk', unit: 'Radiomobile', band: 'am', screen: [158, 140, 112, 22, 'dial'],
    art: () => `${R(0, 30, 400, 210, '#202020')}${R(0, 30, 400, 24, '#2E2E2E')}${R(0, 54, 400, 10, '#BDBDB8')}${R(150, 60, 120, 60, '#111', 30)}
      ${gauge(210, 92, 30, { rim: '#BDBDB8', face: '#101010', tick: '#EDEDE4', needle: '#F2F2E8' })}${R(134, 130, 156, 46, '#C3C4C0', 5)}${R(142, 136, 140, 28, '#1D1C1A', 3)}
      ${keys(152, 166, 5, 20, 8, 5, '#2B2B2B', '#DCDCD5', 1.5)}${knob('toggle', 124, 152, 10, '#2B2B2B', '#3E3E3E', '#DDD')}${knob('tune', 300, 152, 10, '#2B2B2B', '#3E3E3E', '#DDD')}
      ${wheel({ rim: '#7A4B2A', hub: '#BDBDB8', spokes: 3, width: 11, r: 104 })}${carSwitches(336, 186, '#111', '#BDBDB8')}`,
  },
  {
    id: 'lada', name: 'ВАЗ-2101 «Жигули»', year: 1972, country: 'ussr', unit: 'А-370', band: 'fm', screen: [152, 120, 124, 22, 'dial'],
    art: () => `${R(0, 30, 400, 210, '#1B1B1B')}${R(0, 84, 400, 16, '#7A5236')}${R(0, 88, 400, 3, '#946646')}${gauge(78, 70, 26, { rim: '#9A9A96', face: '#0E0E0E', tick: '#F3F0E6' })}
      ${gauge(140, 70, 26, { rim: '#9A9A96', face: '#0E0E0E', tick: '#F3F0E6' })}${R(132, 110, 164, 62, '#121212', 4)}${R(140, 116, 148, 30, '#2A2A27', 3)}
      ${keys(150, 154, 5, 22, 10, 5, '#D7D7D2', null, 1.5)}${knob('toggle', 122, 134, 10, '#3A3A3A', '#555', '#DDD')}${knob('tune', 306, 134, 10, '#3A3A3A', '#555', '#DDD')}
      ${wheel({ rim: '#121212', hub: '#262626', spokes: 2, width: 12 })}${carSwitches(336, 186, '#111', '#8A8A86')}`,
  },
  {
    id: 'w123', name: 'Mercedes-Benz W123', year: 1978, country: 'de', unit: 'Becker Mexico', band: 'fm', screen: [158, 116, 112, 20, 'dial'],
    art: () => `${R(0, 30, 400, 210, '#191817')}${R(0, 92, 400, 18, '#6E4A2C')}${R(0, 96, 400, 2, '#8A6040')}${R(0, 102, 400, 2, '#5A3B22')}${R(30, 40, 200, 50, '#0D0D0D', 22)}
      ${gauge(80, 66, 21, { rim: '#585858', face: '#0A0A0A', tick: '#EDEDE4', needle: '#F07A2B' })}${gauge(130, 64, 24, { rim: '#585858', face: '#0A0A0A', tick: '#EDEDE4', needle: '#F07A2B' })}${gauge(180, 66, 21, { rim: '#585858', face: '#0A0A0A', tick: '#EDEDE4', needle: '#F07A2B' })}
      ${R(132, 110, 164, 70, '#C8C9C6', 4)}${R(140, 114, 148, 26, '#1B1A18', 2)}${R(176, 144, 76, 10, '#262624', 2)}${keys(150, 160, 5, 20, 12, 6, '#E8E8E4', '#9A9A96', 1.5)}
      ${knob('toggle', 122, 134, 10, '#2A2A2A', '#3D3D3D', '#DDD')}${knob('tune', 306, 134, 10, '#2A2A2A', '#3D3D3D', '#DDD')}
      ${wheel({ rim: '#141414', hub: '#202020', spokes: 4, width: 14 })}${carSwitches(336, 188, '#111', '#8A8A86')}`,
  },
  {
    id: 'ae86', name: 'Toyota AE86', year: 1985, country: 'jp', unit: 'Fujitsu Ten', band: 'fm', screen: [150, 118, 120, 24, 'vfd'],
    art: () => `${R(0, 30, 400, 210, '#2A2B2E')}${P('M0 30 H400 V60 L320 84 H40 L0 60 Z', '#1B1C1E')}${R(40, 44, 170, 46, '#0B0B0C', 6)}
      ${gauge(84, 68, 20, { rim: '#333', face: '#0B0B0C', tick: '#EDEDE4', needle: '#FF6A1A' })}${gauge(150, 68, 20, { rim: '#333', face: '#0B0B0C', tick: '#EDEDE4', needle: '#FF6A1A' })}
      ${R(134, 108, 156, 70, '#141415', 4)}${R(142, 114, 134, 32, '#051312', 3)}${R(150, 150, 70, 14, '#262628', 2)}
      ${key('prev', R(228, 150, 24, 12, '#3A3B3E', 2))}${key('next', R(258, 150, 24, 12, '#3A3B3E', 2))}${keys(148, 166, 6, 18, 8, 4, '#3A3B3E', '#59C9BE', 1.5)}
      ${knob('toggle', 124, 128, 9, '#3A3B3E', '#4C4D50', '#DDD')}${knob('tune', 298, 128, 9, '#3A3B3E', '#4C4D50', '#DDD')}
      ${wheel({ rim: '#151515', hub: '#232325', spokes: 3, width: 14, r: 106 })}${carSwitches(336, 188, '#111', '#55575B')}`,
  },
  {
    id: 'testarossa', name: 'Ferrari Testarossa', year: 1986, country: 'it', unit: 'Pioneer', band: 'fm', screen: [154, 126, 116, 22, 'vfd'],
    art: () => `${R(0, 30, 400, 210, '#B99566')}${R(0, 30, 400, 40, '#1A1A1A')}${P('M30 70 H240 L228 100 H44 Z', '#1A1A1A')}
      ${gauge(80, 82, 18, { rim: '#2A2A2A', face: '#0A0A0A', tick: '#F2A33A', needle: '#F2A33A' })}${gauge(130, 80, 21, { rim: '#2A2A2A', face: '#0A0A0A', tick: '#F2A33A', needle: '#F2A33A' })}${gauge(184, 82, 18, { rim: '#2A2A2A', face: '#0A0A0A', tick: '#F2A33A', needle: '#F2A33A' })}
      ${R(136, 116, 152, 62, '#171717', 4)}${R(144, 122, 132, 30, '#140A02', 2)}${key('prev', R(150, 156, 22, 10, '#333', 2))}${key('next', R(176, 156, 22, 10, '#333', 2))}${keys(206, 156, 3, 20, 10, 4, '#333', '#F2A33A', 2)}
      ${knob('toggle', 124, 140, 9, '#2B2B2B', '#3D3D3D', '#F2A33A')}${knob('tune', 300, 140, 9, '#2B2B2B', '#3D3D3D', '#F2A33A')}${C(92, 268, 18, '#E4C02E')}
      ${wheel({ rim: '#161616', hub: '#2A2A2A', spokes: 3, width: 13, r: 100 })}${C(92, 268, 9, '#E4C02E')}${carSwitches(336, 188, '#161616', '#C9C9C4')}`,
  },
  {
    id: 'golf', name: 'Volkswagen Golf III', year: 1995, country: 'de', unit: 'Blaupunkt', band: 'fm', screen: [154, 116, 116, 22, 'lcd-red'],
    art: () => `${R(0, 30, 400, 210, '#3A3B3D')}${R(0, 30, 400, 30, '#2C2D2F')}${R(36, 44, 170, 46, '#202123', 20)}${gauge(86, 68, 20, { rim: '#2C2D2F', face: '#111', tick: '#EEE', needle: '#E33' })}${gauge(154, 68, 20, { rim: '#2C2D2F', face: '#111', tick: '#EEE', needle: '#E33' })}
      ${R(136, 106, 152, 70, '#151516', 6)}${R(144, 112, 132, 28, '#0E0303', 3)}${key('prev', R(150, 146, 24, 11, '#2A2A2C', 3))}${key('next', R(250, 146, 24, 11, '#2A2A2C', 3))}${R(184, 146, 56, 11, '#202022', 3)}
      ${keys(150, 162, 5, 20, 9, 6, '#2A2A2C', '#E0343B', 2)}${knob('toggle', 124, 126, 9, '#2A2A2C', '#3A3A3C', '#E0343B')}${knob('tune', 300, 126, 9, '#2A2A2C', '#3A3A3C', '#E0343B')}
      ${wheel({ rim: '#1E1F21', hub: '#2C2D2F', spokes: 4, width: 15, r: 104 })}${carSwitches(336, 188, '#1E1F21', '#6A6B6E')}`,
  },
  {
    id: 'e46', name: 'BMW 3 (E46)', year: 2003, country: 'de', unit: 'Business CD', band: 'fm', screen: [158, 108, 108, 26, 'lcd-orange'],
    art: () => `${R(0, 30, 400, 210, '#1A1A1B')}${R(0, 86, 400, 12, '#9EA2A6')}${R(40, 40, 170, 44, '#0E0E0F', 20)}${gauge(88, 62, 20, { rim: '#2A2A2B', face: '#0A0A0A', tick: '#FF8A1E', needle: '#FF8A1E' })}${gauge(156, 62, 20, { rim: '#2A2A2B', face: '#0A0A0A', tick: '#FF8A1E', needle: '#FF8A1E' })}
      ${R(138, 100, 148, 78, '#121213', 6)}${R(146, 104, 132, 34, '#140B02', 3)}${keys(146, 144, 4, 30, 8, 4, '#262627', '#FF8A1E', 2)}${keys(146, 156, 4, 30, 8, 4, '#262627', null, 2)}
      ${key('prev', R(146, 168, 30, 8, '#262627', 2))}${key('next', R(248, 168, 30, 8, '#262627', 2))}${knob('tune', 212, 172, 9, '#2E2E2F', '#3E3E3F', '#FF8A1E')}${knob('toggle', 126, 120, 8, '#2E2E2F', '#3E3E3F', '#FF8A1E')}
      ${wheel({ rim: '#121212', hub: '#252526', spokes: 3, width: 15, r: 104 })}${carSwitches(336, 188, '#111', '#9EA2A6')}`,
  },
];

// ---------- home sets (400 × 300): the receiver on a shelf ----------

const shelf = (f = '#00000014') => R(20, 262, 360, 6, f, 3);

const HOMES = [
  {
    id: 'philco', name: 'Philco 90 «Cathedral»', year: 1931, country: 'us', unit: 'Philco', band: 'am', screen: [168, 196, 64, 22, 'dial'],
    art: () => `${shelf()}${P('M90 262 V150 Q90 30 200 26 Q310 30 310 150 V262 Z', '#5A3420')}${P('M110 250 V152 Q110 52 200 48 Q290 52 290 152 V250 Z', '#764628')}
      ${P('M126 186 V150 Q126 74 200 70 Q274 74 274 150 V186 Z', '#C9A877')}${[150, 175, 200, 225, 250].map((x) => P(`M${x - 8} 186 V140 Q${x} 100 ${x + 8} 140 V186 Z`, '#5A3420')).join('')}
      ${R(160, 190, 80, 34, '#4A2A18', 8)}${knob('tune', 200, 242, 9, '#3A2112', '#5A3420', '#E8C48A')}${knob('toggle', 150, 242, 8, '#3A2112', '#5A3420', '#E8C48A')}
      ${key('preset', C(250, 242, 8, '#3A2112') + C(250, 242, 5, '#5A3420'), 'data-n="0"')}`,
  },
  {
    id: 'phonola', name: 'Phonola 547', year: 1940, country: 'it', unit: 'Phonola', band: 'am', screen: [212, 96, 92, 36, 'dial'],
    art: () => `${shelf()}${P('M96 262 L130 96 Q138 72 166 72 H312 Q330 72 326 96 L300 262 Z', '#E7DCC2')}${P('M120 262 L148 120 H306 L284 262 Z', '#D4C6A4')}
      ${R(206, 90, 104, 48, '#3B2A1C', 24)}${barsH(150, 156, 120, 90, 9, '#8E7C5A')}${knob('tune', 300, 190, 13, '#5B3B22', '#7A5232', '#EFE0BE')}${knob('toggle', 296, 236, 11, '#5B3B22', '#7A5232', '#EFE0BE')}
      ${keys(160, 252, 3, 30, 7, 6, '#5B3B22', null, 3)}`,
  },
  {
    id: 'emerson', name: 'Emerson Patriot', year: 1940, country: 'us', unit: 'Emerson', band: 'am', screen: [146, 196, 108, 26, 'dial'],
    art: () => `${shelf()}${R(86, 70, 228, 192, '#B3202A', 40)}${R(100, 84, 200, 104, '#F3EEE2', 18)}${barsH(116, 96, 168, 84, 6, '#B3202A', 0.5)}
      ${R(140, 194, 120, 32, '#F3EEE2', 10)}${knob('toggle', 116, 236, 13, '#26468E', '#3658A8', '#F3EEE2')}${knob('tune', 284, 236, 13, '#26468E', '#3658A8', '#F3EEE2')}
      ${keys(170, 234, 3, 18, 14, 4, '#26468E', '#F3EEE2', 4)}`,
  },
  {
    id: 'bush', name: 'Bush DAC90A', year: 1950, country: 'uk', unit: 'Bush', band: 'am', screen: [96, 112, 104, 26, 'dial'],
    art: () => `${shelf()}${R(70, 64, 260, 198, '#3A2418', 36)}${R(82, 76, 236, 174, '#4C3021', 28)}${C(148, 126, 56, '#E6D6B4')}${C(148, 126, 44, '#F3E8CF')}
      ${C(252, 160, 62, '#2B1A10')}${Array.from({ length: 9 }, (_, i) => { const a = (-90 + i * 22.5) * Math.PI / 180; return L(`M252 160 L${(252 + Math.cos(a) * 58).toFixed(1)} ${(160 + Math.sin(a) * 58).toFixed(1)}`, '#6B4630', 5); }).join('')}
      ${knob('tune', 128, 214, 14, '#E6D6B4', '#D2C098', '#3A2418')}${knob('toggle', 180, 214, 12, '#E6D6B4', '#D2C098', '#3A2418')}${keys(226, 232, 3, 22, 9, 6, '#E6D6B4', null, 3)}`,
  },
  {
    id: 'saba', name: 'SABA Freiburg', year: 1957, country: 'de', unit: 'SABA', band: 'am', screen: [96, 82, 210, 34, 'dial'],
    art: () => `${shelf()}${R(36, 60, 328, 202, '#6B4128', 10)}${R(48, 72, 304, 52, '#1E1A14', 4)}${R(56, 132, 160, 104, '#D9C394', 4)}${barsH(62, 138, 148, 92, 12, '#C2A877', 0.6)}
      ${C(330, 98, 9, '#0E2A16')}<g class="rx-eye">${C(330, 98, 6, '#3FD06A')}</g>${keys(232, 210, 5, 20, 22, 4, '#F2ECDD', '#FFFFFF', 3)}
      ${knob('toggle', 248, 160, 15, '#3A2414', '#5A3A22', '#E8D2A6')}${knob('tune', 318, 160, 15, '#3A2414', '#5A3A22', '#E8D2A6')}${R(40, 252, 320, 8, '#4D2E1C', 3)}`,
  },
  {
    id: 'tr610', name: 'Sony TR-610', year: 1958, country: 'jp', unit: 'Sony', band: 'am', screen: [168, 210, 64, 18, 'dial'],
    art: () => `${shelf()}${R(140, 60, 120, 202, '#B32A2A', 16)}${R(150, 70, 100, 100, '#C9CBCC', 50)}${dots(200, 120, 44, 8, '#7D8082', 2.2)}
      ${R(160, 186, 80, 50, '#E9E4D8', 6)}${knob('tune', 262, 128, 12, '#E9E4D8', '#CFC8B8', '#B32A2A')}${knob('toggle', 262, 196, 9, '#E9E4D8', '#CFC8B8', '#B32A2A')}
      ${keys(170, 244, 2, 26, 8, 8, '#E9E4D8', null, 3)}`,
  },
  {
    id: 'spidola', name: 'ВЭФ «Спидола»', year: 1962, country: 'ussr', unit: 'ВЭФ', band: 'am', screen: [72, 92, 256, 26, 'dial'],
    art: () => `${shelf()}${L('M120 72 Q120 34 200 34 Q280 34 280 72', '#2A2A2A', 9)}${R(50, 70, 300, 192, '#2E3133', 10)}${R(60, 84, 280, 44, '#D6CFBF', 4)}
      ${R(60, 136, 200, 116, '#4A4E52', 4)}${slotsV(66, 142, 188, 104, 22, '#2A2D30', 0.5)}${knob('tune', 300, 168, 17, '#BFC2C4', '#9EA2A5', '#2A2A2A')}
      ${knob('toggle', 300, 224, 12, '#BFC2C4', '#9EA2A5', '#2A2A2A')}${keys(272, 248, 3, 16, 8, 4, '#BFC2C4', null, 2)}`,
  },
  {
    id: 'cubo', name: 'Brionvega TS 502 «Cubo»', year: 1964, country: 'it', unit: 'Brionvega', band: 'am', screen: [222, 104, 116, 26, 'dial'],
    art: () => `${shelf()}${R(62, 92, 140, 170, '#D9432B', 10)}${R(74, 104, 116, 146, '#B0321F', 6)}${dots(132, 177, 52, 9, '#7E2214', 2.6)}
      ${R(206, 92, 140, 170, '#D9432B', 10)}${R(214, 100, 124, 150, '#ECECE8', 6)}${R(204, 92, 6, 170, '#8F2516')}
      ${knob('tune', 246, 172, 16, '#2A2A2A', '#3D3D3D', '#ECECE8')}${knob('toggle', 306, 172, 12, '#2A2A2A', '#3D3D3D', '#ECECE8')}${keys(226, 216, 4, 22, 14, 6, '#2A2A2A', '#5A5A5A', 3)}`,
  },
  {
    id: 'panapet', name: 'Panasonic Panapet R-70', year: 1970, country: 'jp', unit: 'Panasonic', band: 'fm', screen: [158, 164, 84, 22, 'dial'],
    art: () => `${shelf()}${L('M200 82 Q232 30 262 46', '#C9C9C4', 4)}${C(260, 48, 6, 'none', 'stroke="#C9C9C4" stroke-width="3"')}${C(200, 168, 92, '#F0C21D')}${C(200, 168, 72, '#E3B10F')}
      ${dots(200, 132, 32, 7, '#B78C06', 2)}${R(152, 156, 96, 38, '#FFF6D6', 18)}${knob('tune', 238, 222, 12, '#FFF6D6', '#F0E6C0', '#B78C06')}${knob('toggle', 162, 222, 10, '#FFF6D6', '#F0E6C0', '#B78C06')}
      ${key('preset', R(190, 214, 20, 10, '#B78C06', 4), 'data-n="0"')}`,
  },
  {
    id: 'okean', name: '«Океан-209»', year: 1976, country: 'ussr', unit: 'Океан', band: 'fm', screen: [184, 84, 170, 46, 'dial'],
    art: () => `${shelf()}${L('M96 64 V38 H304 V64', '#9EA2A6', 7)}${R(40, 62, 320, 200, '#C9CDD1', 8)}${R(50, 74, 124, 178, '#1E2022', 4)}${barsH(58, 82, 108, 162, 16, '#3A3D40', 0.5)}
      ${R(180, 78, 172, 56, '#EEE9DA', 3)}${knob('tune', 218, 182, 18, '#2A2C2E', '#3E4144', '#EEE')}${knob('toggle', 300, 182, 13, '#2A2C2E', '#3E4144', '#EEE')}
      ${keys(186, 228, 6, 22, 14, 5, '#2A2C2E', '#9EA2A6', 2)}`,
  },
  {
    id: 'boombox', name: 'JVC RC-M90', year: 1980, country: 'us', unit: 'JVC', band: 'fm', screen: [150, 108, 100, 22, 'dial'],
    art: () => `${shelf()}${L('M110 80 V44 H290 V80', '#2A2A2A', 8)}${R(24, 78, 352, 184, '#BFC2C6', 10)}${C(86, 188, 54, '#1E1F21')}${C(86, 188, 40, '#2E3033')}${C(86, 188, 16, '#4A4D51')}
      ${C(314, 188, 54, '#1E1F21')}${C(314, 188, 40, '#2E3033')}${C(314, 188, 16, '#4A4D51')}${C(86, 108, 16, '#1E1F21')}${C(314, 108, 16, '#1E1F21')}
      ${R(146, 104, 108, 30, '#0E0F10', 3)}${R(150, 144, 100, 64, '#26282A', 4)}${R(162, 156, 76, 38, '#121314', 3)}${C(182, 175, 9, '#3A3C3F')}${C(218, 175, 9, '#3A3C3F')}
      ${key('prev', R(150, 218, 22, 12, '#2A2A2A', 2))}${key('toggle', R(176, 218, 22, 12, '#2A2A2A', 2))}${key('next', R(202, 218, 22, 12, '#2A2A2A', 2))}${knob('tune', 240, 226, 9, '#2A2A2A', '#3D3D3D', '#DDD')}
      ${keys(150, 240, 5, 16, 8, 5, '#2A2A2A', '#E04040', 2)}`,
  },
  {
    id: 'revival', name: 'Roberts Revival', year: 1993, country: 'uk', unit: 'Roberts', band: 'fm', screen: [212, 128, 120, 30, 'dial'],
    art: () => `${shelf()}${L('M120 96 Q120 46 200 46 Q280 46 280 96', '#9B6A3C', 10)}${R(64, 92, 272, 170, '#2F4E7A', 24)}${R(76, 104, 248, 146, '#2A4670', 18)}
      ${R(88, 118, 110, 120, '#D6C79F', 8)}${dots(143, 178, 48, 9, '#BBAA7C', 2.4)}${R(206, 120, 132, 46, '#C7A653', 6)}${R(212, 126, 120, 34, '#F3EAD0', 4)}
      ${knob('tune', 300, 206, 15, '#C9CBCC', '#AEB1B3', '#2A4670')}${knob('toggle', 238, 206, 12, '#C9CBCC', '#AEB1B3', '#2A4670')}${keys(220, 236, 3, 24, 8, 6, '#C9CBCC', null, 3)}`,
  },
  {
    id: 'tivoli', name: 'Tivoli Model One', year: 2000, country: 'us', unit: 'Tivoli', band: 'fm', screen: [232, 116, 84, 26, 'dial'],
    art: () => `${shelf()}${R(70, 92, 260, 170, '#7A4022', 8)}${R(80, 102, 240, 150, '#8C4D2A', 4)}${R(92, 112, 120, 128, '#DAD0BC', 4)}${dots(152, 176, 54, 9, '#BBAF98', 2.4)}
      ${R(222, 108, 104, 136, '#E8E2D4', 4)}${R(230, 114, 88, 30, '#F3EEE2', 2)}${knob('tune', 274, 192, 26, '#D8D3C6', '#C3BDAD', '#3A2A1E')}
      ${knob('toggle', 246, 234, 7, '#2A2A2A', '#3D3D3D', '#DDD')}${keys(266, 230, 3, 12, 8, 4, '#2A2A2A', null, 2)}`,
  },
];

export const RECEIVERS = [...CARS.map((r) => ({ ...r, kind: 'car' })), ...HOMES.map((r) => ({ ...r, kind: 'home' }))];
export const receiverById = (id) => RECEIVERS.find((r) => r.id === id);
