// Web Audio playback for the extracted WAV sound effects, voices and music.
// Browsers only allow audio after a user gesture; unlock() is called on the first click.

const DATA = 'data';

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.music = null;
    this.loops = new Map();
    this.pending = new Map(); // key -> promise of a keyed sound still loading (stops duplicate starts)
    this.volume = { sfx: 0.8, music: 0.6 };
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.volume.sfx;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.volume.music;
    this.musicGain.connect(this.master);
  }

  setVolume(kind, v) {
    this.volume[kind] = v;
    const g = kind === 'music' ? this.musicGain : this.sfxGain;
    if (g) g.gain.value = v;
  }

  async buffer(path) {
    if (!this.ctx) return null;
    if (this.buffers.has(path)) return this.buffers.get(path);
    const url = `${DATA}/${path.split('/').map(encodeURIComponent).join('/')}`; // file names contain '#'
    const p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`missing ${path}`))))
      .then((ab) => this.ctx.decodeAudioData(ab))
      .catch((e) => { console.warn(e.message); return null; });
    this.buffers.set(path, p);
    const b = await p;
    this.buffers.set(path, b);
    return b;
  }

  // path relative to public/data, e.g. "sounds/Interface/Click.wav"
  play(path, opts = {}) {
    const { key = null } = opts;
    if (!this.ctx || !path) return Promise.resolve(null);
    if (key && this.loops.has(key)) return Promise.resolve(this.loops.get(key));
    if (key && this.pending.has(key)) return this.pending.get(key);
    const p = this.start(path, opts);
    if (key) {
      this.pending.set(key, p);
      p.finally(() => { if (this.pending.get(key) === p) this.pending.delete(key); });
    }
    return p;
  }

  async start(path, { volume = 1, loop = false, key = null } = {}) {
    const buf = await this.buffer(path);
    if (!buf) return null;
    if (key && !this.pending.has(key)) return null; // stopped while loading
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.sfxGain);
    src.gainNode = g; // lets callers fade looping ambiences
    src.start();
    if (key) {
      this.loops.set(key, src);
      src.onended = () => this.loops.get(key) === src && this.loops.delete(key);
    }
    return src;
  }

  stop(key) {
    this.pending.delete(key);
    const s = this.loops.get(key);
    if (s) { try { s.stop(); } catch { /* already stopped */ } this.loops.delete(key); }
  }

  stopAll() {
    for (const k of [...this.loops.keys()]) this.stop(k);
  }

  async playMusic(path, { loop = true } = {}) {
    if (!this.ctx) return;
    if (this.music?.path === path) return;
    this.stopMusic();
    const buf = await this.buffer(path);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(this.musicGain);
    src.start();
    this.music = { path, src };
  }

  stopMusic() {
    if (this.music) { try { this.music.src.stop(); } catch { /* noop */ } this.music = null; }
  }
}
