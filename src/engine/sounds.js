// Sound ids from DATA/INI/Sounds.ini (e.g. INT_VALIDATE, LABO_AMBIANCE) mapped to extracted WAVs.
// The INI uses Windows paths (case-insensitive, ".\DATA\SOUNDS\..."); they are resolved against the
// extracted file list in the manifest. MCW files were converted to WAV by the extractor.
import { iniObject } from './assets.js';

export class Sounds {
  constructor(game) {
    this.game = game;
    this.defs = {};
    this.files = new Map();
  }

  async init() {
    for (const f of this.game.assets.manifest.sounds ?? []) this.files.set(f.toLowerCase(), f);
    this.defs = iniObject(await this.game.assets.loadIni('INI/Sounds.ini'));
  }

  path(id) {
    const d = this.defs[id];
    if (!d?.FILENAME) return null;
    const rel = String(d.FILENAME).replace(/^.*?SOUNDS[\\/]/i, '').replace(/\\/g, '/').replace(/\.mcw$/i, '.wav').toLowerCase();
    const f = this.files.get(rel);
    return f ? `sounds/${f}` : null;
  }

  play(id, opts = {}) {
    const p = this.path(id);
    if (!p) return null;
    const d = this.defs[id];
    const volume = (opts.volume ?? 1) * ((d.START_VOLUME ?? 100) / 100);
    return this.game.audio.play(p, { ...opts, volume, loop: opts.loop ?? !!d.USE_LOOP });
  }

  loop(id, key = id, opts = {}) {
    return this.play(id, { ...opts, loop: true, key });
  }

  stop(key) {
    this.game.audio.stop(key);
  }
}

// UI feedback: the original plays one of the INT_ROLLOVER notes when the pointer enters a button and
// INT_VALIDATE2 on click.
export class UiSounds {
  constructor(sounds) {
    this.sounds = sounds;
    this.last = 0;
  }
  hovered(w) {
    if (w.sound === null) return;
    const now = performance.now();
    if (now - this.last < 60) return;
    this.last = now;
    const n = Math.floor(Math.random() * 19).toString().padStart(2, '0'); // a random note per hover [code 0x463720]
    this.sounds.play(`INT_ROLLOVER${n}`, { volume: 0.5 });
  }
  clicked(w) {
    if (w.sound === null) return;
    this.sounds.play('INT_VALIDATE2'); // the original never plays INT_VALIDATE [code 0x463720, event 0x1f]
  }
}
