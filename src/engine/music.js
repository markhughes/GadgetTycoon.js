// CD music. The original plays Red Book audio tracks 2..4 of the game CD through MCI "cdaudio" (the extractor
// rips them to data/music/trackNN.mp3). Its CD player [code 0x47e970..0x47f426] plays one track at a time and,
// because every call asks for looping, restarts the track when its length has elapsed. When it plays what:
//
//  * Main menu: a random track [code 0x4056af after the intro, 0x40648c on returning from a game, 0x427e03 when
//    music is switched on in Options]: rand() % (tracks - 1) + 1, where the count includes the data track 1, so
//    the original picks track 1..3. Track 1 is data and cannot be played, so in practice the menu got track 2,
//    track 3 or silence. We pick track 2 or 3 [inferred outcome of the MCI play on a data track].
//  * In game [code 0x462acd, run on the 50 ms ambience tick while music is on]: the track follows the player's
//    cash, with a 20,000 hysteresis band so it does not flip at the threshold:
//      cash >= 5,000,000 -> track 4 (switch once cash >= 5,020,000)
//      cash <=   200,000 -> track 3 (switch once cash <=   180,000)
//      otherwise         -> track 2 (switch once 220,000 <= cash <= 4,980,000)
//    The menu's track carries on into the game until this rule asks for a different one.
//  * Stopped for the intro / extro videos [code 0x40171a, 0x4018cc] (they have their own song) and when leaving a
//    game [code 0x462793]; switching music off in Options stops it and blocks playback [code 0x47f155].
import { settings } from './settings.js';

export class Music {
  constructor(game) {
    this.game = game;
    this.track = -1; // the CD track currently playing (-1 = none), like the player's +0x14
    this.el = null;
  }

  get tracks() { return (this.game.assets.manifest.music ?? []).map((m) => m.track); }
  get enabled() { return settings.music && this.tracks.length > 0; }

  play(track) {
    if (!this.enabled || track === this.track) return;
    const entry = this.game.assets.manifest.music.find((m) => m.track === track);
    if (!entry) return;
    const audio = this.game.audio;
    if (!this.el) {
      this.el = new window.Audio();
      this.el.loop = true;
      this.el.preload = 'auto';
    }
    // Route through the music gain so the Options volume sliders apply (once the audio context exists).
    if (!this.routed && audio.ctx) { audio.ctx.createMediaElementSource(this.el).connect(audio.musicGain); this.routed = true; }
    this.track = track;
    this.el.src = `data/${entry.file}`;
    this.el.play().catch(() => { /* autoplay refused until a user gesture; retried on the next request */ this.track = -1; });
  }

  stop() {
    this.track = -1;
    if (this.el) { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); }
  }

  // Main menu: a random track (see above).
  playRandom() {
    const audioTracks = this.tracks.filter((t) => t >= 2 && t <= 3);
    if (audioTracks.length) this.play(audioTracks[Math.floor(Math.random() * audioTracks.length)]);
  }

  // In game, every ambience tick: the cash-driven choice with hysteresis [code 0x462acd].
  updateForCash(cash) {
    if (!this.enabled) return;
    const cur = this.track;
    let want = cur;
    if (cash >= 5000000) { if (cur !== 4 && cash >= 5020000) want = 4; }
    else if (cash <= 200000) { if (cur !== 3 && cash <= 180000) want = 3; }
    else if (cur !== 2 && cash >= 220000 && cash <= 4980000) want = 2;
    if (want !== cur) this.play(want);
  }

  // Options "music" checkbox [code 0x427d97..0x427e45].
  setEnabled(on) {
    if (!on) this.stop();
    else this.playRandom();
  }
}
