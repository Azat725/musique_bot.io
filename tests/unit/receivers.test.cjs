const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// receivers.js has no imports: it loads on its own
const load = () => import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(__dirname, '../../docs/js/devices/receivers.js'), 'utf8')));
const COUNTRIES = ['us', 'uk', 'ussr', 'de', 'fr', 'it', 'jp'];

test('every country has cars and three or four home sets, ids are unique', async () => {
  const { RECEIVERS } = await load();
  assert.equal(new Set(RECEIVERS.map((r) => r.id)).size, RECEIVERS.length);
  for (const c of COUNTRIES) {
    assert.ok(RECEIVERS.filter((r) => r.country === c && r.kind === 'car').length >= 3, `${c} cars`);
    const homes = RECEIVERS.filter((r) => r.country === c && r.kind === 'home').length;
    assert.ok(homes >= 3 && homes <= 4, `${c} home: ${homes}`);
  }
  assert.ok(RECEIVERS.every((r) => COUNTRIES.includes(r.country)));
});

test('every receiver can be switched on, tuned and preset; its display lies inside the drawing', async () => {
  const { RECEIVERS } = await load();
  for (const r of RECEIVERS) {
    const art = r.art();
    for (const k of ['toggle', 'tune', 'preset']) assert.ok(art.includes(`data-key="${k}"`), `${r.id} lacks ${k}`);
    if (r.kind === 'car') for (const k of ['wipers', 'drive']) assert.ok(art.includes(`data-key="${k}"`), `${r.id} lacks ${k}`);
    const [x, y, w, h] = r.screen, height = r.kind === 'car' ? 240 : 300;
    assert.ok(x >= 0 && y >= 30 * (r.kind === 'car') && x + w <= 400 && y + h <= height, `${r.id} screen outside`);
    assert.ok(!r.art().includes('NaN') && !art.includes('undefined'), `${r.id} drew garbage`);
    if (r.year < 1970) assert.equal(r.band, 'am', `${r.id} should be on the medium waves`);
  }
});

test('a set may stand in the decade of its era instead of the decade of its year', () => {
  // radio.js has imports, so take the one-line definition of decadeOf out of its source and run that alone
  const line = fs.readFileSync(path.join(__dirname, '../../docs/js/radio.js'), 'utf8').split('\n').find((l) => l.startsWith('export const decadeOf'));
  const decadeOf = new Function('receiver', line.replace('export const ', '') + '\nreturn decadeOf;')(() => ({ year: 1957 }));
  assert.equal(decadeOf({ year: 1938 }), 1930);
  assert.equal(decadeOf({ year: 1938, era: 1940 }), 1940);
  assert.equal(decadeOf(), 1950);
});
