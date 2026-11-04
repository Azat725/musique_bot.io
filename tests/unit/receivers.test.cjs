const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// receivers.js has no imports: it loads on its own
const load = () => import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(__dirname, '../../docs/js/devices/receivers.js'), 'utf8')));
const COUNTRIES = ['us', 'uk', 'ussr', 'de', 'fr', 'it', 'jp'];

test('every country has three or four cars and three or four home sets, ids are unique', async () => {
  const { RECEIVERS } = await load();
  assert.equal(new Set(RECEIVERS.map((r) => r.id)).size, RECEIVERS.length);
  for (const c of COUNTRIES) for (const kind of ['car', 'home']) {
    const n = RECEIVERS.filter((r) => r.country === c && r.kind === kind).length;
    assert.ok(n >= 3 && n <= 4, `${c} ${kind}: ${n}`);
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
