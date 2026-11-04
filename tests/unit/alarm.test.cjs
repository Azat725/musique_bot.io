const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// alarm.js with its neighbours replaced by stand-ins; timers run at once so that a ring takes no time
async function load(radioAlarm, { playing = true, answer = null } = {}) {
  const calls = { tuned: [], toggled: 0, sheets: [] };
  const settings = { radioAlarm };
  const player = { audio: { volume: 1 }, baseVolume: 1, get playing() { return playing; }, toggle() { calls.toggled += 1; playing = !playing; } };
  const context = vm.createContext({ Promise, Date, performance, setTimeout: (f) => { f(); return 0; }, setInterval: () => 0, clearInterval() {} });
  const mock = (obj) => new vm.SyntheticModule(Object.keys(obj), function () { Object.entries(obj).forEach(([k, v]) => this.setExport(k, v)); }, { context });
  const deps = {
    './i18n.js': mock({ t: (k) => k }),
    './player.js': mock({ player }),
    './radio.js': mock({ receiver: () => ({ country: 'it' }), stationName: (s) => s, stations: () => ['it', 'us', 'fr', 'mine'], tune: async (s) => { calls.tuned.push(s); return true; } }),
    './store.js': mock({ settings, updateSettings: (p) => Object.assign(settings, p) }),
    './ui.js': mock({ esc: (s) => s, h: () => ({ addEventListener() {} }), haptic() {}, sheet: async (o) => { calls.sheets.push(o); return answer; } }),
  };
  const mod = new vm.SourceTextModule(fs.readFileSync('docs/js/alarm.js', 'utf8'), { context });
  await mod.link((s) => deps[s]); await mod.evaluate();
  return { alarm: mod.namespace, calls, player };
}
const at = (d, h, m, s = 0) => new Date(2026, 0, d, h, m, s);
const settle = () => new Promise((r) => setImmediate(r));

test('the alarm is due from its minute for three minutes, once a day, only when it is on', async () => {
  const { alarm } = await load({});
  const a = { on: true, time: '07:30', station: 'fr' };
  assert.equal(alarm.shouldRing(a, at(5, 7, 29, 59)), false, 'not yet');
  assert.equal(alarm.shouldRing(a, at(5, 7, 30, 0)), true);
  assert.equal(alarm.shouldRing(a, at(5, 7, 32, 59)), true, 'a phone that woke a little late');
  assert.equal(alarm.shouldRing(a, at(5, 7, 33, 1)), false, 'too late to wake anyone');
  assert.equal(alarm.shouldRing({ ...a, on: false }, at(5, 7, 30)), false);
  assert.equal(alarm.shouldRing({ ...a, time: 'soon' }, at(5, 7, 30)), false);
  assert.equal(alarm.shouldRing(a, at(5, 7, 31), '2026-1-5 07:30'), false, 'it has rung for this day already');
  assert.equal(alarm.shouldRing(a, at(6, 7, 31), '2026-1-5 07:30'), true, 'and rings again the next day');
});

test('ringing tunes the chosen station (the country of the set when none is chosen) and offers snooze and stop', async () => {
  const chosen = await load({ on: true, time: '07:30', station: 'fr' });
  assert.equal(chosen.alarm.checkAlarm(at(5, 7, 30, 5)), true);
  await settle();
  assert.deepEqual([...chosen.calls.tuned], ['fr']);
  assert.equal(chosen.calls.sheets.length, 1);
  const labels = chosen.calls.sheets[0].items.map((i) => i.label);
  assert.deepEqual([...labels], ['alarm_snooze', 'alarm_stop']); // the sound is playing: no "turn it on" button
  assert.equal(chosen.alarm.checkAlarm(at(5, 7, 30, 20)), false, 'once for the minute');
  assert.equal(chosen.alarm.checkAlarm(at(5, 7, 31)), false);
  const fallback = await load({ on: true, time: '07:30', station: 'gone' });
  fallback.alarm.checkAlarm(at(5, 7, 30));
  await settle();
  assert.deepEqual([...fallback.calls.tuned], ['it']);
});

test('when the browser kept the sound from starting the alarm asks for a tap; snooze rings again ten minutes later; stop silences it', async () => {
  const silent = await load({ on: true, time: '07:30', station: '' }, { playing: false });
  silent.alarm.checkAlarm(at(5, 7, 30));
  await settle();
  assert.equal(silent.calls.sheets[0].items[0].label, 'alarm_start');

  const snooze = await load({ on: true, time: '07:30', station: '' }, { answer: 0 }); // "10 more minutes" (the first item when playing)
  snooze.alarm.checkAlarm(at(5, 7, 30));
  await settle();
  assert.equal(snooze.calls.toggled, 1, 'the radio is paused for the snooze');
  const before = snooze.calls.tuned.length;
  assert.equal(snooze.alarm.checkAlarm(new Date(Date.now() + 5 * 60000)), false, 'not yet');
  assert.equal(snooze.alarm.checkAlarm(new Date(Date.now() + 11 * 60000)), true);
  await settle();
  assert.equal(snooze.calls.tuned.length, before + 1);

  const stop = await load({ on: true, time: '07:30', station: '' }, { answer: 1 }); // "turn off"
  stop.alarm.checkAlarm(at(5, 7, 30));
  await settle();
  assert.equal(stop.calls.toggled, 1);
  assert.equal(stop.player.audio.volume, 1, 'the volume is back where it was');
});
