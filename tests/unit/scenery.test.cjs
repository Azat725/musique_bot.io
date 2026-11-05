const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = (file) => import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(__dirname, '../../docs/js/devices/', file), 'utf8')));

test('every car gets a street of its own country, with rain, without garbage numbers or gradients', async () => {
  const { glassHTML } = await load('scenery.js');
  const { RECEIVERS } = await load('receivers.js');
  const seen = new Set();
  for (const r of RECEIVERS.filter((x) => x.kind === 'car')) {
    const html = glassHTML(r);
    assert.ok(html.includes('rx__scene') && html.includes('rx__fall') && html.includes('rx__drops') && html.includes('rx__wiper'), r.id);
    assert.ok(!/NaN|undefined|Infinity/.test(html), `${r.id} drew garbage`);
    assert.ok(html.includes('rx-street') && !html.includes('rx-fly'), `${r.id}: houses, trees and lamps move together in one group`);
    assert.ok(!/gradient/i.test(html), `${r.id} used a gradient`);
    assert.equal(html, glassHTML(r), `${r.id}: the same car must always look the same`);
    seen.add(html);
  }
  assert.ok(seen.size >= 20, 'streets should differ between cars');
});
