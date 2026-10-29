import { api } from './api.js';

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
    this._blobs = new Map(); // track id -> Promise<object URL>
    this._errTimer = 0;
    this._lastState = '';

    const a = this.audio;
    a.addEventListener('playing', () => {
      this.loading = false;
      this.errors = 0;
      this._state();
      const tr = this.current;
      if (tr && this._logged !== tr.id) {
        this._logged = tr.id;
        api.addHistory(tr).catch(() => {});
        const upcoming = this.queue[this.index + 1];
        if (upcoming) {
          if (api.usesBlob) this._audioUrl(upcoming.id).catch(() => {});
          else api.prefetch(upcoming).catch(() => {});
        }
      }
    });
    a.addEventListener('pause', () => this._state());
    a.addEventListener('waiting', () => { this.loading = true; this._state(); });
    a.addEventListener('canplay', () => { this.loading = false; this._state(); });
    a.addEventListener('timeupdate', () => this._emit('time'));
    a.addEventListener('durationchange', () => this._emit('time'));
    a.addEventListener('ended', () => {
      if (this.repeat === 'one') { a.currentTime = 0; a.play(); return; }
      this.next(true);
    });
    a.addEventListener('error', () => {
      if (!this.current) return;
      this.loading = false;
      this.errors += 1;
      this._emit('error');
      if (this.errors <= 3 && this.index < this.queue.length - 1) this._errTimer = setTimeout(() => this.next(true), 1200);
      else this._state();
    });
    this._mediaSession();
  }

  get current() { return this.queue[this.index] || null; }
  get playing() { return !this.audio.paused; }
  get time() { return this.audio.currentTime || 0; }
  get duration() {
    const d = this.audio.duration;
    return Number.isFinite(d) && d > 0 ? d : (this.current?.duration || 0);
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  /** 'state' only when something visible changed: buffering on a weak network fires these in bursts. */
  _state() {
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
  }

  playNext(track) {
    if (!this.current) return this.playQueue([track], 0);
    this.queue.splice(this.index + 1, 0, track);
    this.original?.push(track);
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
    this._audioUrl(tr.id).then((url) => {
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
  _audioUrl(id) {
    if (!api.usesBlob) return Promise.resolve(api.streamUrl(id));
    if (!this._blobs.has(id)) {
      const p = api.audioBlob(id);
      p.catch(() => this._blobs.delete(id));
      this._blobs.set(id, p);
      while (this._blobs.size > 3) {
        const old = [...this._blobs.keys()].find((k) => k !== this.current?.id && k !== id);
        if (!old) break;
        this._blobs.get(old).then((u) => URL.revokeObjectURL(u), () => {});
        this._blobs.delete(old);
      }
    }
    return this._blobs.get(id);
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
