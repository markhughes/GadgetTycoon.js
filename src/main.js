import { Game } from './engine/game.js';
import { Sounds, UiSounds } from './engine/sounds.js';
import { Strings } from './engine/strings.js';
import { BootScene } from './scenes/boot.js';
import { settings, applyAudioSettings } from './engine/settings.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
window.game = game; // handy for debugging in the console

async function main() {
  game.settings = settings;
  game.assets.shadows = settings.spriteShadow;
  await game.assets.init();
  const params = new URLSearchParams(location.search);
  game.strings = new Strings(game.assets, params.get('lang') ?? 'eng');
  game.sounds = new Sounds(game);
  await Promise.all([game.strings.init(), game.sounds.init()]);
  game.ui = new UiSounds(game.sounds);
  applyAudioSettings(game.audio);
  await game.assets.loadSprite('MOUSE_MAIN_SPRITES');

  // ?scene=<module>:<Class> jumps straight to a scene (development aid).
  const jump = params.get('scene');
  if (jump) {
    const [mod, cls] = jump.split(':');
    const m = await import(`./scenes/${mod}.js`);
    await game.go(new m[cls](), Object.fromEntries(params));
  } else {
    await game.go(new BootScene());
  }
  game.start();
}

main().catch((e) => {
  const el = document.getElementById('error');
  el.style.display = 'block';
  el.textContent = String(e.stack || e);
  canvas.style.display = 'none';
});
