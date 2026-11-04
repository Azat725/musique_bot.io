const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// radio.js with its neighbours replaced by stand-ins: what the station asks of the server, and what it plays
async function radio({ liked = [] } = {}) {
  const calls = { recommend: 0, radio: 0, queued: null, toast: [] };
  const settings = { playerMode: 'radio-car', radioCar: 'fiat500', radioStation: '' };
  const player = { queueSession: 0, playing: false, playQueue(tracks) { calls.queued = tracks; this.queueSession += 1; } };
  const context = vm.createContext({ EventTarget, CustomEvent, Math, Promise });
  const mock = (obj) => new vm.SyntheticModule(Object.keys(obj), function () { Object.entries(obj).forEach(([k, v]) => this.setExport(k, v)); }, { context });
  const car = { id: 'fiat500', kind: 'car', year: 1965, country: 'it', band: 'am' };
  const deps = {
    './api.js': mock({ api: { recommend: async () => { calls.recommend += 1; return { tracks: [{ id: 'server-pick' }] }; }, radio: async () => { calls.radio += 1; return { tracks: [{ id: 'station' }] }; } } }),
    './player.js': mock({ player }),
    './store.js': mock({ settings, updateSettings: (patch) => Object.assign(settings, patch), likedList: async () => liked }),
    './i18n.js': mock({ t: (k) => k }),
    './devices/receivers.js': mock({ RECEIVERS: [car], receiverById: (id) => (id === 'fiat500' ? car : null) }),
    './ui.js': mock({ esc: (s) => s, h: () => ({}), haptic() {}, sheet: async () => null, toast: (m) => calls.toast.push(m) }),
  };
  const mod = new vm.SourceTextModule(fs.readFileSync('docs/js/radio.js', 'utf8'), { context });
  await mod.link((s) => deps[s]); await mod.evaluate();
  return { radio: mod.namespace, calls, settings };
}
const tracks = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, title: `Song ${i}` }));

test('your wave out of the favourites: nothing under five, then every one of them in a fresh order, never the same song twice running', async () => {
  const { radio: r } = await radio();
  assert.equal(r.waveFromLikes(tracks(4)).length, 0);
  assert.equal(r.waveFromLikes([]).length, 0);
  const wave = r.waveFromLikes(tracks(7));
  assert.ok(wave.length >= 20);
  assert.deepEqual([...new Set(wave.map((t) => t.id))].sort(), tracks(7).map((t) => t.id).sort());
  assert.equal(new Set(wave.slice(0, 7).map((t) => t.id)).size, 7, 'each favourite once before any repeats');
  for (let i = 1; i < wave.length; i++) assert.notEqual(wave[i].id, wave[i - 1].id);
  const again = r.waveFromLikes(tracks(7), () => 0.5);
  assert.deepEqual(again.slice(0, 7).map((t) => t.id), r.waveFromLikes(tracks(7), () => 0.5).slice(0, 7).map((t) => t.id)); // the same randomness, the same order
});

test('tuning your wave plays the favourites without asking the server; too few favourites fall back to the server', async () => {
  const many = await radio({ liked: tracks(12) });
  assert.equal(await many.radio.tune('mine'), true);
  assert.ok(many.calls.queued.every((t) => t.id.startsWith('t')));
  assert.equal(many.calls.recommend, 0);
  assert.equal(many.calls.radio, 0);
  const few = await radio({ liked: tracks(2) });
  assert.equal(await few.radio.tune('mine'), true);
  assert.equal(few.calls.recommend, 1);
  assert.equal(few.calls.queued[0].id, 'server-pick');
  const country = await radio({ liked: tracks(12) });
  await country.radio.tune('it'); // another station does not touch the favourites
  assert.equal(country.calls.radio, 1);
  assert.equal(country.calls.queued[0].id, 'station');
});
