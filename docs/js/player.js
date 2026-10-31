import { api } from './api.js';
import { heard, onSettings, settings } from './store.js';

export const RATES = { slow: 0.85, normal: 1, fast: 45 / (100 / 3) }; // fast = 1.35: a 45 rpm record played at 45 instead of 33⅓
const PLAIN = 'normal-off';

/** The sound chosen in the Sound sheet as the server names it: "<speed>-<reverb>", e.g. "slow-hall". */
const chosenFx = () => `${RATES[settings.speed] ? settings.speed : 'normal'}-${['room', 'hall'].includes(settings.reverb) ? settings.reverb : 'off'}`;

/** Audio engine: queue, shuffle/repeat, Media Session. UI listens to events on `player`. */
class Player extends EventTarget {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    // CORS mode: the equalizer can only process audio fetched this way (the server allows any origin)
    if (!api.usesBlob) this.audio.crossOrigin = 'anonymous';
    this.queue = [];
    this.original = null; // queue order before shuffle
    this.index = -1;
    this.shuffle = false;
    this.repeat = 'off'; // off | all | one
    this.loading = false;
    this.errors = 0;
    this._logged = null;
    this._seq = 0;
    this._blobs = new Map(); // "track id|fx" -> Promise<object URL>
    // slowed, sped up and reverb are rendered by the server (a phone's own resampler crackles): the file already
    // runs at that pace, the element always plays at 1. `fx` is what the loaded file was rendered with
    this.fx = PLAIN;
    this._plainFor = null; // a track whose rendering failed plays plain
    this._errTimer = 0;
    this._lastState = '';
    this.stopAfter = false; // sleep timer "end of track": stop instead of moving on

    const a = this.audio;
    a.addEventListener('playing', () => {
      this.loading = false;
      this.errors = 0;
      this._state();
      const tr = this.current;
      if (tr && this._logged !== tr.id) {
        this._logged = tr.id;
        heard.add(tr.id);
        api.addHistory(tr).catch(() => {});
        const upcoming = this.queue[this.index + 1];
        if (upcoming) {
          if (api.usesBlob) this._audioUrl(upcoming.id, this._fxFor(upcoming)).catch(() => {});
          else api.prefetch(upcoming, this._fxFor(upcoming)).catch(() => {});
        }
      }
    });
    a.addEventListener('pause', () => this._state());
    a.addEventListener('waiting', () => { this.loading = true; this._state(); });
    a.addEventListener('canplay', () => { this.loading = false; this._state(); });
    a.addEventListener('timeupdate', () => this._emit('time'));
    a.addEventListener('durationchange', () => this._emit('time'));
    a.addEventListener('ended', () => {
      if (this.stopAfter) { this.stopAfter = false; this._emit('stopped'); this._state(); return; }
      if (this.repeat === 'one') { a.currentTime = 0; a.play(); return; }
      this.next(true);
    });
    a.addEventListener('error', () => {
      if (!this.current) return;
      if (this.fx !== PLAIN && this._plainFor !== this.current.id) { // no rendering for it: play it as it is
        this._plainFor = this.current.id;
        this._reload();
        return;
      }
      this.loading = false;
      this.errors += 1;
      this._emit('error');
      if (this.errors <= 3 && this.index < this.queue.length - 1) this._errTimer = setTimeout(() => this.next(true), 1200);
      else this._state();
    });
    // WebKit (iOS 16.4+): declare this page a music player, so the audio is not treated as ambient and
    // is not cut by the mute switch or the lock screen. Unsupported browsers simply skip it.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    this._mediaSession();
    onSettings(() => { if (this.current && this._fxFor(this.current) !== this.fx) this._reload(); });
  }

  get current() { return this.queue[this.index] || null; }
  get playing() { return !this.audio.paused; }
  get time() { return this.audio.currentTime || 0; }
  get duration() {
    const d = this.audio.duration;
    return Number.isFinite(d) && d > 0 ? d : (this.current?.duration || 0) / this.rate;
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  /** 'state' only when something visible changed: buffering on a weak network fires these in bursts. */
  _state() {
    // the lock screen and Control Center read this to show the right play/pause button
    try { if (navigator.mediaSession) navigator.mediaSession.playbackState = this.current ? (this.playing ? 'playing' : 'paused') : 'none'; } catch {}
    const key = `${this.playing}|${this.loading}|${this.index}|${this.current?.id}`;
    if (key === this._lastState) return;
    this._lastState = key;
    this._emit('state');
  }

  playQueue(tracks, start = 0, { shuffle = false } = {}) {
    this.queue = tracks.slice();
    this.original = null;
    this.index = start;
    if (shuffle) {
      this.index = Math.floor(Math.random() * this.queue.length);
      this.shuffle = true;
    }
    if (this.shuffle) this._shuffleRest();
    this._load(0);
    this._emit('queue');
  }

  playNext(track) {
    if (!this.current) return this.playQueue([track], 0);
    this.queue.splice(this.index + 1, 0, track);
    this.original?.push(track);
    this._emit('queue');
  }

  /** Play a track already in the queue right now. */
  jumpTo(i) {
    if (i < 0 || i >= this.queue.length || i === this.index) return;
    const dir = i > this.index ? 1 : -1;
    this.index = i;
    this._load(dir);
    this._emit('queue');
  }

  /** Take an upcoming track out of the queue (and out of the order shuffle would restore). */
  removeAt(i) {
    if (i <= this.index || i >= this.queue.length) return;
    const [tr] = this.queue.splice(i, 1);
    if (this.original) {
      const j = this.original.indexOf(tr);
      if (j >= 0) this.original.splice(j, 1);
    }
    this._emit('queue');
  }

  /** Reorder upcoming tracks: both positions are queue indexes after the current track. */
  move(from, to) {
    const n = this.queue.length;
    if (from === to || from <= this.index || to <= this.index || from >= n || to >= n) return;
    const [tr] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, tr);
    this._emit('queue');
  }

  clearUpcoming() {
    const kept = this.queue.slice(0, this.index + 1);
    if (kept.length === this.queue.length) return;
    this.queue = kept;
    if (this.original) this.original = this.original.filter((t) => kept.includes(t));
    this._emit('queue');
  }

  /** How fast the loaded file runs against the original (0.85 slowed, 1.35 at 45): the record spins at it,
   *  and timed lyrics turn the file's time back into the song's with it. */
  get rate() { return RATES[this.fx.split('-')[0]] || 1; }

  _fxFor(track) { return track.id === this._plainFor ? PLAIN : chosenFx(); }

  /** The sound changed mid-track: load the new rendering and carry on from the same moment of the song. */
  _reload() {
    const tr = this.current;
    if (!tr) return;
    const songTime = this.time * this.rate, wasPlaying = this.playing || this.loading;
    const fx = this._fxFor(tr);
    const seq = ++this._seq;
    this.fx = fx;
    this.loading = true;
    this._state();
    this._audioUrl(tr.id, fx).then((url) => {
      if (seq !== this._seq) return;
      const a = this.audio;
      a.addEventListener('loadedmetadata', () => {
        if (seq !== this._seq) return;
        a.currentTime = Math.max(0, songTime / this.rate);
        if (wasPlaying) a.play().catch(() => {});
      }, { once: true });
      a.src = url;
    }).catch(() => { if (seq === this._seq) this.audio.dispatchEvent(new Event('error')); });
    this._emit('fx');
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) this.audio.play().catch(() => {});
    else this.audio.pause();
  }

  next(auto = false) {
    if (!this.queue.length) return;
    if (this.index < this.queue.length - 1) this.index += 1;
    else if (this.repeat === 'all' || !auto) this.index = 0;
    else { this._state(); return; }
    this._load(1);
  }

  prev() {
    if (!this.queue.length) return;
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    this.index = this.index > 0 ? this.index - 1 : this.queue.length - 1;
    this._load(-1);
  }

  seek(sec) {
    if (Number.isFinite(sec)) this.audio.currentTime = Math.max(0, Math.min(sec, this.duration - 0.5));
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    if (this.shuffle) this._shuffleRest();
    else if (this.original) {
      const cur = this.current;
      this.queue = this.original;
      this.index = Math.max(0, this.queue.findIndex((t) => t.id === cur?.id));
      this.original = null;
    }
    this._emit('modes');
    this._emit('queue');
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    this._emit('modes');
  }

  _shuffleRest() {
    this.original = this.original || this.queue.slice();
    const head = this.queue.slice(0, this.index + 1);
    const rest = this.queue.slice(this.index + 1);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.queue = head.concat(rest);
  }

  _load(dir) {
    const tr = this.current;
    if (!tr) return;
    clearTimeout(this._errTimer); // a pending auto-skip must not override the user's choice
    this.loading = true;
    const seq = ++this._seq;
    if (api.usesBlob) this.audio.pause(); // the previous track must not keep playing while the next downloads
    const fx = this._fxFor(tr);
    this.fx = fx;
    this._audioUrl(tr.id, fx).then((url) => {
      if (seq !== this._seq) return; // the user already moved on
      this.audio.src = url;
      this.audio.play().catch(() => {});
    }).catch(() => {
      if (seq === this._seq) this.audio.dispatchEvent(new Event('error'));
    });
    this._emit('track', { track: tr, dir });
    this._state();
    this._updateMediaSession(tr);
  }

  /** Playable URL for a track. Behind ngrok the audio is fetched with a header and played from memory. */
  _audioUrl(id, fx = PLAIN) {
    if (!api.usesBlob) return Promise.resolve(api.streamUrl(id, fx));
    const key = `${id}|${fx}`;
    if (!this._blobs.has(key)) {
      const p = api.audioBlob(id, fx);
      p.catch(() => this._blobs.delete(key));
      this._blobs.set(key, p);
      while (this._blobs.size > 3) {
        const old = [...this._blobs.keys()].find((k) => !k.startsWith(`${this.current?.id}|`) && k !== key);
        if (!old) break;
        this._blobs.get(old).then((u) => URL.revokeObjectURL(u), () => {});
        this._blobs.delete(old);
      }
    }
    return this._blobs.get(key);
  }

  _mediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const handlers = {
      play: () => this.audio.play(),
      pause: () => this.audio.pause(),
      previoustrack: () => this.prev(),
      nexttrack: () => this.next(),
      seekto: (e) => this.seek(e.seekTime),
    };
    for (const [k, fn] of Object.entries(handlers)) {
      try { ms.setActionHandler(k, fn); } catch {}
    }
  }

  _updateMediaSession(tr) {
    if (!navigator.mediaSession || !window.MediaMetadata) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: tr.title,
      artist: tr.artist,
      artwork: tr.cover ? [{ src: tr.cover, sizes: '544x544' }] : [],
    });
  }
}

export const player = new Player();
