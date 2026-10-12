// Start-up sequence [code 0x404760]: loading screen, Monte Cristo logo video, intro video with subtitles,
// then the main menu. Browsers only allow audio/video after a user gesture, so the loading screen waits
// for a click first.
import { applyAudioSettings, settings, saveSettings } from '../engine/settings.js';

const video = () => document.getElementById('video');

// Plays a full-screen video. ESC or SPACE skips (the original ignores mouse clicks) [code 0x401048].
// Subtitles come from TRAD\Song__TRAD (intro) / Song2__TRAD (extro): FIRST_FRAME/LAST_FRAME at 25 fps,
// drawn in FONT_MENU_NOVA19x30 centred in a 75px band at the bottom.
export async function playVideo(game, name) {
  const subsFile = { Intro: 'Song__TRAD', Extro: 'Song2__TRAD' }[name];
  let subs = [];
  if (subsFile) {
    try {
      subs = (await game.assets.loadIni(`TRAD/${subsFile}.${game.strings.lang}`)).map((s) => Object.fromEntries(s.entries));
    } catch { /* no subtitles */ }
    await game.assets.loadSprite('FONT_MENU_NOVA19x30');
  }
  return new Promise((resolve) => {
    const v = video();
    const canvas = game.r.canvas;
    const r = game.r;
    const prevSize = [r.width, r.height];
    let done = false;
    let raf = 0;
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      v.pause();
      v.removeAttribute('src');
      v.load();
      v.style.display = 'none';
      game.paused = false;
      r.resize(...prevSize);
      window.removeEventListener('keydown', onKey, true);
      resolve();
    };
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === ' ') { e.stopPropagation(); finish(); }
    };
    // Frames are drawn onto the game canvas so subtitles can use the bitmap font.
    const draw = () => {
      if (done) return;
      raf = requestAnimationFrame(draw);
      const c = r.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = '#000';
      c.fillRect(0, 0, r.width, r.height);
      if (v.videoWidth) c.drawImage(v, (r.width - v.videoWidth) / 2, (r.height - v.videoHeight - 75) / 2);
      const frame = v.currentTime * 25;
      let idx = -1;
      if (subs.length && frame > subs[0].FIRST_FRAME) {
        idx = 0;
        while (idx < subs.length && frame > subs[idx].LAST_FRAME) idx++;
      }
      if (idx >= 0 && idx < subs.length) {
        const lines = r.wrap('FONT_MENU_NOVA19x30', subs[idx].STRING, r.width - 40);
        lines.forEach((l, i) => r.text('FONT_MENU_NOVA19x30', l, r.width / 2, r.height - 75 + 30 + i * 26 - (lines.length - 1) * 13, { align: 'center' }));
      }
    };
    game.paused = true;
    r.resize(640, 480);
    v.src = `data/video/${name}.mp4`;
    v.onended = finish;
    v.onerror = finish;
    window.addEventListener('keydown', onKey, true);
    v.play().then(draw, finish);
  });
}

export class BootScene {
  width = 640;
  height = 480;

  async enter(game) {
    this.game = game;
    this.started = false;
    await game.assets.preload({ images: ['MainMenu_Loading'], sprites: ['FONT_MENU_NOVA14x23', 'ProgressBar0'] });
  }

  async start() {
    if (this.started) return;
    this.started = true;
    const g = this.game;
    g.audio.unlock();
    applyAudioSettings(g.audio);
    if (!new URLSearchParams(location.search).has('novideo')) {
      if (g.assets.manifest.video?.includes('MC')) await playVideo(g, 'MC');
      if (g.assets.manifest.video?.includes('Intro')) await playVideo(g, 'Intro');
    }
    const { MainMenuScene } = await import('./menus.js');
    g.go(new MainMenuScene());
  }

  event(ev) {
    if (ev.type === 'down' || ev.type === 'key') this.start();
    return true;
  }

  draw(r) {
    r.image('MainMenu_Loading');
    r.sprite('ProgressBar0', 0, 96, 464, { anchor: 'topleft' });
    if (Math.floor(this.game.time * 2) % 2 === 0) {
      r.text('FONT_MENU_NOVA14x23', 'Click to start', 320, 455, { align: 'center' });
    }
  }
}

export async function playExtro(game) {
  settings.extroSeen = true;
  saveSettings();
  await playVideo(game, 'Extro');
}
