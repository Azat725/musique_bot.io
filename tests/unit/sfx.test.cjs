const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// sfx.js on a stand-in for Web Audio: every node remembers what it was asked, fetch is ours
async function load({ sounds = true, files = {} } = {}) {
  const fetched = [], nodes = [];
  const param = () => ({ value: 0, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; }, exponentialRampToValueAtTime(v) { this.value = v; }, cancelScheduledValues() {}, setTargetAtTime(v) { this.value = v; } });
  const node = (kind) => {
    const own = { kind, started: [], stopped: [] };
    const n = new Proxy(own, {
      get(t, p) {
        if (p in t) return t[p];
        if (p === 'connect') return (d) => d;
        if (p === 'start') return (...a) => t.started.push(a);
        if (p === 'stop') return (...a) => t.stopped.push(a);
        if (p === 'disconnect') return () => {};
        if (p === 'getChannelData') return () => new Float32Array(8);
        if (typeof p === 'symbol') return undefined;
        return (t[p] = param());
      },
      set(t, p, v) { t[p] = v; return true; },
    });
    nodes.push(n);
    return n;
  };
  class FakeContext {
    constructor() { this.currentTime = 0; this.sampleRate = 8; this.state = 'running'; this.destination = node('destination'); }
    createGain() { return node('gain'); }
    createBufferSource() { return node('source'); }
    createOscillator() { return node('osc'); }
    createBiquadFilter() { return node('filter'); }
    createBuffer() { return node('buffer'); }
    decodeAudioData(d) { return Promise.resolve({ duration: 10, from: d }); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  }
  const settings = { sounds, playerMode: 'radio-car', vinylNoise: 0 };
  const context = vm.createContext({
    window: { AudioContext: FakeContext }, document: { addEventListener() {} }, setTimeout, clearTimeout, Promise, Float32Array, Math, console,
    fetch: (url) => { fetched.push(url); const body = files[url.replace('assets/sfx/', '')]; return Promise.resolve(body ? { ok: true, arrayBuffer: () => Promise.resolve(body) } : { ok: false }); },
  });
  const mock = (obj) => new vm.SyntheticModule(Object.keys(obj), function () { Object.entries(obj).forEach(([k, v]) => this.setExport(k, v)); }, { context });
  const deps = { './store.js': mock({ settings, phonoMode: () => false, radioMode: () => true, tapeMode: () => false }) };
  const mod = new vm.SourceTextModule(fs.readFileSync('docs/js/sfx.js', 'utf8'), { context });
  await mod.link((s) => deps[s]); await mod.evaluate();
  return { sfx: mod.namespace, fetched, nodes };
}
const tick = () => new Promise((r) => setTimeout(r, 20));
const bytes = (ok) => Object.fromEntries(['car-rain-glass.mp3', 'car-rain-roof.mp3', 'car-road.mp3', 'car-pass.mp3', 'car-engine.mp3', 'car-horn.mp3'].map((n) => [n, ok ? new ArrayBuffer(4) : null]));

test('with the sounds off nothing is fetched and nothing plays', async () => {
  const { sfx, fetched } = await load({ sounds: false, files: bytes(true) });
  const stop = sfx.startCarAmbience({ rain: true, road: true });
  assert.equal(typeof stop, 'function'); stop();
  assert.equal(sfx.startDriveAudio(), null);
  await tick();
  assert.deepEqual(fetched, []);
});

test('the car ambience fetches only what its mode needs, and only when it starts', async () => {
  const { sfx, fetched } = await load({ files: bytes(true) });
  assert.deepEqual(fetched, []); // loading the module fetches nothing
  const stop = sfx.startCarAmbience({ rain: true });
  await tick();
  assert.deepEqual(fetched.filter((f) => f.includes('/car-')).sort(), ['assets/sfx/car-rain-glass.mp3', 'assets/sfx/car-rain-roof.mp3']);
  stop();
  const second = await load({ files: bytes(true) });
  const stopSecond = second.sfx.startCarAmbience({ road: true });
  await tick();
  assert.deepEqual(second.fetched.filter((f) => f.includes('/car-')).sort(), ['assets/sfx/car-pass.mp3', 'assets/sfx/car-road.mp3']);
  stopSecond(); // its timers would keep the test process alive
});

test('recordings that cannot be fetched leave the synthesised sound in place without an error', async () => {
  const { sfx, nodes } = await load({ files: bytes(false) });
  const stop = sfx.startCarAmbience({ rain: true, road: true });
  const drive = sfx.startDriveAudio();
  await tick();
  drive.update({ rpm: 3000, red: 6000, speed: 10, throttle: 0.5 });
  drive.horn(true); drive.horn(false); drive.stop(); stop();
  // no looped recording was ever started: every started source is a noise (2 s buffer of the stand-in) or an oscillator
  assert.ok(!nodes.some((n) => n.kind === 'source' && n.loopStart !== undefined && n.loopEnd !== undefined && n.loopEnd.value));
});

test('the game engine follows the revs with the recording, and the horn loops its sustain', async () => {
  const { sfx, nodes } = await load({ files: bytes(true) });
  const drive = sfx.startDriveAudio();
  await tick();
  const engines = nodes.filter((n) => n.kind === 'source' && n.buffer && n.buffer.duration === 10);
  assert.equal(engines.length, 2); // the engine and the road
  const slow = (drive.update({ rpm: 800, red: 6000, speed: 0, throttle: 0 }), engines[0].playbackRate.value);
  const fast = (drive.update({ rpm: 6000, red: 6000, speed: 20, throttle: 1 }), engines[0].playbackRate.value);
  assert.ok(fast > slow * 1.8, `${slow} → ${fast}`);
  drive.horn(true);
  const horn = nodes.filter((n) => n.kind === 'source' && n.loop === true && n.loopEnd === 0.62);
  assert.equal(horn.length, 1);
  drive.horn(false); drive.stop();
  assert.equal(horn[0].stopped.length, 1);
});
