/** How the town looks and how a car behaves, for the chosen car: its country and age set the houses, the other cars,
 *  the people and the side of the road; its model sets the engine and the size. Plain data, no imports. */

// [top speed km/h, 0–100 km/h in s, wheelbase m, length m, width m, idle rpm, redline rpm, gears, speed in mph]
const SPECS = {
  roadmaster: [150, 15, 3.1, 5.3, 1.95, 550, 4200, 3, true], belair: [160, 12, 2.9, 5.0, 1.85, 600, 4800, 3, true],
  volga: [130, 24, 2.7, 4.8, 1.8, 600, 4400, 3, false], fiat500: [95, 30, 1.85, 2.97, 1.32, 800, 4800, 4, false],
  ds: [160, 14, 3.1, 4.8, 1.8, 700, 5000, 4, false], mini: [120, 20, 2.04, 3.05, 1.41, 800, 5500, 4, true],
  lada: [140, 22, 2.42, 4.07, 1.6, 800, 5600, 4, false], w123: [170, 14, 2.8, 4.7, 1.79, 700, 5500, 4, false],
  ae86: [190, 8.5, 2.4, 4.2, 1.63, 900, 7500, 5, false], testarossa: [290, 5.8, 2.55, 4.49, 1.98, 900, 7000, 5, false],
  golf: [185, 11, 2.47, 4.0, 1.7, 850, 6000, 5, false], e46: [220, 8, 2.73, 4.47, 1.74, 800, 6500, 5, false],
  mustang: [180, 10, 2.74, 4.6, 1.73, 700, 5200, 3, true], corvette: [250, 6.5, 2.44, 4.5, 1.8, 800, 5800, 4, true],
  etype: [240, 7, 2.43, 4.45, 1.66, 800, 5500, 4, true], defender: [130, 20, 2.36, 3.9, 1.79, 800, 4500, 5, true],
  zaz965: [90, 35, 2.0, 3.3, 1.4, 700, 4000, 4, false], vaz2109: [150, 15, 2.46, 4.0, 1.6, 850, 6000, 4, false],
  beetle: [115, 28, 2.4, 4.08, 1.54, 800, 4500, 4, false], '2cv': [70, 40, 2.4, 3.8, 1.48, 800, 4500, 4, false],
  peugeot205: [195, 8.5, 2.42, 3.7, 1.57, 850, 6500, 5, false], spider: [185, 11, 2.25, 4.25, 1.63, 800, 6000, 5, false],
  integrale: [215, 6, 2.48, 3.9, 1.77, 850, 6800, 5, false], z240: [205, 8, 2.3, 4.12, 1.63, 800, 6500, 5, false],
  mx5: [185, 9, 2.27, 3.95, 1.67, 850, 7000, 5, false],
};
// on a map this small nothing may go faster than this, but a faster car still pulls harder
const TOP = 110;

/** The engine and body of a car by its id (a sensible small car when the id is unknown). */
export function carSpec(id) {
  const [top, zero, wheelbase, len, wid, idle, red, gears, mph] = SPECS[id] || SPECS.golf;
  return { id, top: Math.min(top, TOP), realTop: top, a0: Math.max(1.8, Math.min(7.5, 1.7 * 27.8 / zero)), wheelbase, len, wid, idle, red, gears, mph };
}

// the houses, by country: wall colours, how high they rise, window grid, the word over the cinema, the lamps' light
const COUNTRY = {
  us: { walls: ['#8C4A3B', '#A5604A', '#756557', '#B79670'], heights: [10, 30], col: 3.4, floor: 3.4, cinema: 'THEATRE', lamp: '#FFD9A0', lht: false },
  uk: { walls: ['#8C4E40', '#A66A50', '#7E6853', '#9A5842'], heights: [9, 15], col: 3, floor: 3, cinema: 'CINEMA', lamp: '#FFC870', lht: true },
  ussr: { walls: ['#9FA096', '#8E8E80', '#A59E88', '#8A948C'], heights: [14, 28], col: 2.6, floor: 2.8, cinema: 'КИНО', lamp: '#FFB860', lht: false },
  de: { walls: ['#BDB08F', '#AB966F', '#97754F', '#BDB5A6'], heights: [11, 19], col: 3.2, floor: 3.1, cinema: 'KINO', lamp: '#FFD590', lht: false },
  fr: { walls: ['#C9BFA6', '#BCAF92', '#B2A58A', '#CFC7B4'], heights: [14, 21], col: 3.4, floor: 3.2, cinema: 'CINÉMA', lamp: '#FFD79A', lht: false },
  it: { walls: ['#C28F4F', '#B07538', '#CCA26A', '#AE6A45'], heights: [12, 19], col: 3.3, floor: 3.3, cinema: 'CINEMA', lamp: '#FFC878', lht: false },
  jp: { walls: ['#A9AFB4', '#9AA2AA', '#B5B1A6', '#8D979F'], heights: [12, 44], col: 2.4, floor: 3, cinema: '映画館', lamp: '#FFF0C8', lht: true },
};
const COATS = {
  old: ['#3B3430', '#4A4036', '#2F3A44', '#5A4A3A', '#6B2F2B'],
  mid: ['#3F5D7A', '#7A3F3F', '#4F6B4A', '#B0803A', '#5A4A7A', '#2F3A44'],
  new: ['#E04A4A', '#3FA0D8', '#F2C14E', '#4FBF8A', '#C45AD0', '#2F3A44'],
};
const NPC_COLOURS = {
  old: ['#7A1F24', '#2F4E3A', '#B8A06A', '#2A3B54', '#3A3A3A', '#8A5A3A'],
  mid: ['#B0392B', '#2F6E8A', '#C9A83A', '#4F6B3A', '#8A8A84', '#3A3A3A'],
  new: ['#C0392B', '#2F6EA8', '#D9D9D4', '#2A2A2E', '#4FA070', '#B0B0B8'],
};

/** The style of the town and traffic for a car's country and year. */
export function styleFor(country, year) {
  const c = COUNTRY[country] || COUNTRY.us;
  const era = year < 1960 ? 'old' : year < 1990 ? 'mid' : 'new';
  return {
    country, year, era, ...c,
    cars: era === 'old' ? 'round' : era === 'mid' ? 'box' : 'smooth', // the shape of the other cars
    npc: NPC_COLOURS[era], coats: COATS[era], hats: era === 'old',
    neon: era === 'old' ? ['#E05A4A'] : ['#FF4FA0', '#35E0F2', '#FFE24A', '#7CFF8A'],
    neonShare: era === 'old' ? 0.1 : country === 'jp' ? 0.7 : 0.3,
  };
}
