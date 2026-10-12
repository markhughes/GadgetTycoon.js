// Player profile and options (the original keeps these in DATA/INI/Setup.ini), stored per browser.
const KEY = 'gadgetTycoon.settings';

const DEFAULTS = {
  playerName: 'Player',
  music: true,
  sound: true,
  musicVolume: 60,
  soundVolume: 80,
  masterVolume: 100,
  highResolution: false,
  spriteShadow: true,
  mouseShadow: true,
  extroSeen: false,
};

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

export const settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

export function applyAudioSettings(audio) {
  const m = settings.masterVolume / 100;
  audio.setVolume('sfx', settings.sound ? (settings.soundVolume / 100) * m : 0);
  audio.setVolume('music', settings.music ? (settings.musicVolume / 100) * m : 0);
}
