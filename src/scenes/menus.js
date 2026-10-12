// Front-end menus at 640x480, rebuilt from the original's builders (docs/presentation.md §menus).
// Screens are full-screen containers; "Back" (Menu_Bouton_Principal) returns to the parent menu.
import { Root, Button, Label, TextField, ListBox, EditBox, ComboBox, CheckBox, Slider } from '../engine/ui.js';
import { settings, saveSettings, applyAudioSettings } from '../engine/settings.js';
import { listSaves } from '../sim/storage.js';

const MENU_FONT = 'FONT_MENU_NOVA19x30';
const MENU_FONT_HI = 'FONT_MENU_NOVA19x30_HIGHLIGHT';
const LIST_FONT = 'FONT_MENU_NOVA14x23';

export class MenuScene {
  width = 640;
  height = 480;
  background = 'MainMenu';
  titleId = null;
  sprites = [];

  async enter(game, params) {
    this.game = game;
    this.params = params ?? {};
    this.root = new Root(game, this.width, this.height);
    await game.assets.preload({
      images: [this.background],
      sprites: ['FONT_TITLE', MENU_FONT, MENU_FONT_HI, LIST_FONT, 'Fonte_White_11x13VABBd', 'Menu_Bouton_Principal',
        'Menu_Bouton_Validate', ...this.sprites],
    });
    if (this.titleId) this.root.add(new TextField(0, 5, this.width, 60, this.t(this.titleId), { font: 'FONT_TITLE', align: 'center' }));
    await this.build(this.root);
    game.sounds.loop('MARKETING_AMBIANCE', 'menu-ambience', { volume: 0.6 });
  }

  build() {}

  back(target = MainMenuScene) {
    return new Button(369, 382, 'Menu_Bouton_Principal', { tooltip: 'GAME_MENU_BACK_MAIN_MENU', onClick: () => this.game.go(new target()) });
  }

  play(onClick, tooltip = 'GAME_MENU_PLAY') {
    return new Button(556, 387, 'Menu_Bouton_Validate', { tooltip, onClick, sound: 'validate2' });
  }

  // Big menu button with the "     %s" label used by the main and offline menus.
  menuButton(x, y, sprite, id, onClick) {
    return new Button(x, y, sprite, { label: `     ${this.t(id)}`, font: MENU_FONT, hoverFont: MENU_FONT_HI, labelX: 70, labelY: 33, onClick });
  }

  textList(x, y, w, h, items, opts = {}) {
    return new ListBox(x, y, w, h, {
      rowHeight: 23, items, ...opts,
      renderRow: (r, item, rx, ry, rw, selected, hover) => {
        if (selected) r.rect(rx, ry + 1, rw, 22, 'rgba(60,90,220,0.45)');
        else if (hover) r.rect(rx, ry + 1, rw, 22, 'rgba(60,90,220,0.2)');
        const text = typeof item === 'object' ? item.label : item;
        r.text(item?.font ?? LIST_FONT, text, rx + 6, ry + 18);
      },
    });
  }

  update(dt) { this.root.update(dt, this.game.input); }
  event(ev) {
    if (this.root.event(ev, this.game.input)) return true;
    if (ev.type === 'key' && ev.key === 'Escape') this.onEscape?.();
    return true;
  }
  draw(r) {
    r.image(this.background);
    this.root.draw(r, this.game.input);
  }
  t(id, ...a) { return this.game.strings.get(id, ...a); }
}

// Main menu [code 0x40f490]: five 301x44 buttons in a diagonal staircase.
export class MainMenuScene extends MenuScene {
  titleId = 'GAME_MENU_MAIN_TITLE';
  sprites = [1, 2, 3, 4, 5].map((i) => `BOUTON_${i}_MENU_MAIN`);

  build(root) {
    const entries = [
      ['GAME_MENU_NEWGAME', () => this.game.go(new OfflineMenuScene())],
      ['GAME_MENU_NETWORK', () => this.game.push(new MessageScene(), { text: 'Online play is not available in the browser version.' })],
      ['GAME_MENU_OPTION', () => this.game.go(new OptionsScene())],
      ['GAME_MENU_CREDITS', () => this.game.go(new CreditsScene())],
      ['GAME_MENU_QUITAPPLICATION', () => this.game.go(new QuitScene())],
    ];
    entries.forEach(([id, onClick], i) => root.add(this.menuButton(93 + i * 50, 85 + i * 77, `BOUTON_${i + 1}_MENU_MAIN`, id, onClick)));
  }
}

// Offline menu [code 0x4120fe].
export class OfflineMenuScene extends MenuScene {
  background = 'MainMenu_Offline';
  titleId = 'GAME_MENU_OFFLINE_TITLE';
  sprites = ['BOUTON_TUTORIAL_MENU_OFFLINE', 'BOUTON_CAMPAGNE_MENU_OFFLINE', 'BOUTON_SOLO_MENU_OFFLINE', 'BOUTON_CHARGER_MENU_OFFLINE'];

  build(root) {
    root.add(this.menuButton(143, 85, 'BOUTON_TUTORIAL_MENU_OFFLINE', 'GAME_MENU_OFFLINE_TUTORIAL', () => this.game.go(new TutorialScene())));
    root.add(this.menuButton(182, 170, 'BOUTON_CAMPAGNE_MENU_OFFLINE', 'GAME_MENU_OFFLINE_CAMPAIGN', () => this.game.go(new CampaignScene())));
    root.add(this.menuButton(223, 249, 'BOUTON_SOLO_MENU_OFFLINE', 'GAME_MENU_OFFLINE_SOLO', () => this.game.go(new FreeplayScene())));
    root.add(this.menuButton(263, 327, 'BOUTON_CHARGER_MENU_OFFLINE', 'GAME_MENU_OFFLINE_LOADGAME', () => this.game.go(new LoadScene())));
    root.add(new TextField(17, 410, 226, 20, this.t('OPTIONS_PLAYER_NAME'), { font: LIST_FONT }));
    root.add(new EditBox(17, 437, 230, 23, { text: settings.playerName, maxLength: 12, onChange: (v) => { settings.playerName = v; saveSettings(); } }));
    root.add(this.back());
  }
  onEscape() { this.game.go(new MainMenuScene()); }
}

export async function startGame(game, params) {
  game.sounds.stop('menu-ambience');
  const { GameScene } = await import('./ingame.js');
  await game.go(new GameScene(), params);
}

// Tutorial [code 0x412d13]: four tutorial levels LEVEL90..93.
export class TutorialScene extends MenuScene {
  background = 'MainMenu_Tutorial';
  titleId = 'GAME_MENU_OFFLINE_TUTORIAL';

  build(root) {
    const list = root.add(this.textList(26, 120, 272, 242, [0, 1, 2, 3].map((i) => ({ label: this.t(`TUTORIAL${i}_NAME`), level: 90 + i }))));
    list.selected = 0;
    const go = () => startGame(this.game, { level: list.items[Math.max(0, list.selected)].level, mode: 'tutorial' });
    list.onActivate = go;
    root.add(this.back(OfflineMenuScene));
    root.add(this.play(go));
  }
  onEscape() { this.game.go(new OfflineMenuScene()); }
}

// Campaign [code 0x41279d]: mission list in a fixed order, each mapped to a level folder.
export const CAMPAIGN = [
  { mission: 0, level: 4 }, { mission: 5, level: 9 }, { mission: 2, level: 6 }, { mission: 6, level: 10 },
  { mission: 7, level: 11 }, { mission: 8, level: 12 }, { mission: 4, level: 8 }, { mission: 1, level: 5 }, { mission: 3, level: 7 },
];

export class CampaignScene extends MenuScene {
  background = 'MainMenu_Campaign';
  titleId = 'GAME_MENU_OFFLINE_CAMPAIGN_TITLE';

  build(root) {
    const desc = root.add(new ListBox(341, 120, 277, 242, {
      rowHeight: 18, items: [],
      renderRow: (r, line, x, y) => r.text('Fonte_White_11x13VABBd', line, x + 4, y + 13),
    }));
    const showMission = (m) => {
      const lines = [];
      const add = (i) => {
        const id = `MISSION${m}_LINE${i}`;
        if (this.game.strings.has(id)) lines.push(...this.game.r.wrap('Fonte_White_11x13VABBd', this.t(id), 262));
      };
      for (let i = 0; i < 4; i++) add(i);
      lines.push(' ', ' ');
      for (let i = 4; i < 8; i++) add(i);
      desc.setItems(lines.filter((l) => l !== undefined));
      desc.scroll = 0;
    };
    const list = root.add(this.textList(25, 120, 272, 242, CAMPAIGN.map((c) => ({ label: this.t(`MISSION${c.mission}`), ...c })), {
      onSelect: (item) => showMission(item.mission),
    }));
    list.selected = 0;
    showMission(CAMPAIGN[0].mission);
    const go = () => {
      const c = list.items[Math.max(0, list.selected)];
      startGame(this.game, { level: c.level, mission: c.mission, mode: 'campaign' });
    };
    list.onActivate = go;
    root.add(this.back(OfflineMenuScene));
    root.add(this.play(go));
  }
  onEscape() { this.game.go(new OfflineMenuScene()); }
}

// Load [code 0x412a8e]: saved games (kept in browser storage).
export class LoadScene extends MenuScene {
  background = 'MainMenu_Load';
  titleId = 'GAME_MENU_OFFLINE_LOAD_TITLE';

  build(root) {
    const saves = listSaves();
    const list = root.add(new ListBox(26, 120, 372, 242, {
      rowHeight: 23, items: saves,
      renderRow: (r, s, x, y, w, selected, hover) => {
        if (selected || hover) r.rect(x, y + 1, w, 22, selected ? 'rgba(60,90,220,0.45)' : 'rgba(60,90,220,0.2)');
        r.text(LIST_FONT, s.name, x + 6, y + 18);
        const d = new Date(s.date);
        r.text('Fonte_White_11x13VABBd', `${d.toLocaleDateString()}, ${d.toLocaleTimeString()}`, x + w - 6, y + 16, { align: 'right' });
      },
    }));
    if (!saves.length) root.add(new TextField(26, 120, 372, 30, 'No saved games', { font: LIST_FONT, align: 'center' }));
    const go = () => {
      const s = list.items[list.selected];
      if (s) startGame(this.game, { load: s.name });
    };
    list.onActivate = go;
    root.add(this.back(OfflineMenuScene));
    root.add(this.play(go));
  }
  onEscape() { this.game.go(new OfflineMenuScene()); }
}

// Freeplay settings [code 0x410e12]: up to 7 computer opponents, start cash, victory condition, product.
export const AI_TYPES = ['COMPUTER0', 'COMPUTER1', 'COMPUTER2', 'COMPUTER3', 'COMPUTER4', 'COMPUTER5', 'COMPUTER6', 'COMPUTER7'];
export const START_CASH = [1000000, 500000, 250000, 100000, 0, -100000, -250000, -500000, -1000000];
const CASH_LABELS = [' 1,000,000', '   500,000', '   250,000', '   100,000', '         0', '-  100,000', '-  250,000', '-  500,000', '-1,000,000'];

export class FreeplayScene extends MenuScene {
  background = 'MainMenu_Custom';
  titleId = 'NETWORK_CUSTOM_TITLE';
  sprites = ['Menu_Bouton_Chiotte', 'Menu_Bouton_Roller', 'Menu_Bouton_Robot', 'Product_WC', 'Product_Roller', 'Product_Robot',
    'Menu_CheckBox', 'Menu_Bouton_Down_Arrow_ListBox', 'Fonte_GreenBlue_13x16VAAR', ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `Button_Logo${i}`)];

  build(root) {
    const hdr = (x, id) => root.add(new TextField(x, 44, 150, 20, this.t(id), { font: MENU_FONT, align: 'left' }));
    hdr(36, 'NETWORK_PLAYER_TYPE'); hdr(228, 'NETWORK_PLAYER_NAME'); hdr(384, 'NETWORK_PLAYER_START_CASH'); hdr(492, 'NETWORK_PRODUCT_TYPE');
    const typeItems = [{ label: this.t('NETWORK_PLAYER_TYPE_CLOSED'), type: null }, ...AI_TYPES.map((k, i) => ({ label: this.t(`NETWORK_PLAYER_TYPE_${k}`), type: i })), { label: this.t('NETWORK_PLAYER_TYPE_COMPUTER_RANDOM'), type: 'random' }];
    this.rows = [];
    for (let i = 0; i < 8; i++) {
      const y = 76 + 30 * i;
      const logo = root.add(new Button(10, y, `Button_Logo${i + 1}`, { w: 29, h: 21 }));
      logo.frame = () => 2;
      let type, cash;
      if (i === 0) {
        type = root.add(new TextField(44, y, 180, 20, this.t('NETWORK_PLAYER_TYPE_HUMAN'), { font: 'Fonte_GreenBlue_13x16VAAR', pad: 4 }));
        root.add(new TextField(236, y - 2, 104, 20, () => settings.playerName, { font: LIST_FONT }));
      } else {
        type = new ComboBox(44, y, 180, { items: typeItems, index: i <= 3 ? 1 + ((i - 1) % 7) : 0 });
        root.add(new TextField(236, y - 2, 104, 20, () => (type.value.type === null ? '' : `CPU ${i}`), { font: LIST_FONT }));
      }
      cash = new ComboBox(392, y, 98, { items: CASH_LABELS, index: 0, font: 'Fonte_GreenBlue_13x16VAAR' });
      this.rows.push({ type, cash });
    }
    // Combos are added after the static labels so their drop-downs can overlap them.
    for (const r of this.rows) { if (r.type instanceof ComboBox) root.add(r.type); root.add(r.cash); }
    this.victory = root.add(new ComboBox(45, 316, 445, { items: [...Array(10).keys()].map((i) => this.t(`VICTORY${i}`)), index: 0, dropHeight: 150 }));
    this.coop = root.add(new CheckBox(17, 349));
    root.add(new TextField(45, 346, 185, 17, this.t('NETWORK_IA_COOPERATIVE'), { font: LIST_FONT }));
    this.product = 0;
    const products = ['Menu_Bouton_Chiotte', 'Menu_Bouton_Roller', 'Menu_Bouton_Robot'];
    const productButtons = products.map((sp, i) => root.add(new Button(499 + 48 * i, 76, sp, {
      w: 32, h: 32, toggle: true, checked: i === 0,
      onClick: () => { this.product = i; productButtons.forEach((b, k) => { b.checked = k === i; }); },
    })));
    const preview = root.add(new Label(498, 121, ''));
    preview.onDraw = (r) => {
      const name = ['Product_WC', 'Product_Roller', 'Product_Robot'][this.product];
      const frame = Math.floor(this.game.time * 8) % Math.max(1, r.frameCount(name));
      const f = r.frameInfo(name, frame);
      if (f) r.sprite(name, frame, 498 + (132 - f.w) / 2, 121 + (219 - f.h) / 2, { anchor: 'topleft' });
    };
    root.add(this.back(OfflineMenuScene));
    root.add(this.play(() => this.launch(), 'NETWORK_LAUNCH'));
  }

  launch() {
    const opponents = [];
    this.rows.slice(1).forEach((row, i) => {
      let t = row.type.value.type;
      if (t === null) return;
      if (t === 'random') t = Math.floor(Math.random() * 7);
      opponents.push({ slot: i + 1, ai: t, cash: START_CASH[row.cash.index] });
    });
    startGame(this.game, {
      level: [1, 2, 3][this.product], mode: 'freeplay', victory: this.victory.index, conspiratorial: this.coop.checked,
      playerCash: START_CASH[this.rows[0].cash.index], opponents,
    });
  }
  onEscape() { this.game.go(new OfflineMenuScene()); }
}

// Options [code 0x411736].
export class OptionsScene extends MenuScene {
  background = 'MainMenu_Options';
  titleId = 'OPTIONS_TITLE';
  sprites = ['Menu_CheckBox', 'Menu_Slider', 'Menu_BoutonVideo1', 'Menu_BoutonVideo2'];

  build(root) {
    const g = this.game;
    const set = (k) => (v) => { settings[k] = v; saveSettings(); applyAudioSettings(g.audio); };
    root.add(new EditBox(178, 78, 250, 23, { text: settings.playerName, onChange: set('playerName') }));
    root.add(new TextField(120, 130, 300, 30, this.t('OPTIONS_SOUND_TITLE'), { font: MENU_FONT }));
    root.add(new CheckBox(89, 187, { checked: settings.music, onChange: set('music') }));
    root.add(new CheckBox(89, 233, { checked: settings.sound, onChange: set('sound') }));
    const lbl = (y, id) => root.add(new TextField(123, y, 180, 23, this.t(id), { font: LIST_FONT }));
    lbl(185, 'OPTIONS_SOUND_CD'); lbl(215, 'OPTIONS_SOUND_WAVE'); lbl(245, 'OPTIONS_SOUND_MASTER');
    const slider = (y, k) => root.add(new Slider(308, y, 150, { track: null, value: settings[k] / 100, onChange: (v) => set(k)(Math.round(v * 100)) }));
    slider(185, 'musicVolume'); slider(215, 'soundVolume'); slider(245, 'masterVolume');
    root.add(new TextField(120, 300, 300, 30, this.t('OPTIONS_DISPLAY_TITLE'), { font: MENU_FONT }));
    root.add(new CheckBox(89, 355, { checked: settings.highResolution, onChange: set('highResolution') }));
    root.add(new CheckBox(89, 385, { checked: settings.spriteShadow, onChange: set('spriteShadow') }));
    const mouse = root.add(new CheckBox(89, 415, { checked: settings.mouseShadow, onChange: set('mouseShadow') }));
    mouse.onUpdate = function (dt, input) { CheckBox.prototype.onUpdate.call(this, dt, input); this.enabled = settings.spriteShadow; };
    lbl(353, 'OPTIONS_HIGH_RESOLUTION'); lbl(383, 'OPTIONS_GAME_SHADOW'); lbl(413, 'OPTIONS_MOUSE_SHADOW');
    const replay = async (name) => {
      const { playVideo } = await import('./boot.js');
      g.sounds.stop('menu-ambience');
      await playVideo(g, name);
      g.sounds.loop('MARKETING_AMBIANCE', 'menu-ambience', { volume: 0.6 });
    };
    root.add(new Button(547, 90, 'Menu_BoutonVideo1', { onClick: () => replay('Intro') }));
    const v2 = root.add(new Button(588, 90, 'Menu_BoutonVideo2', { onClick: () => replay('Extro') }));
    v2.visible = settings.extroSeen;
    root.add(this.back());
  }
  onEscape() { this.game.go(new MainMenuScene()); }
}

// Credits [code 0x421580]: Credits__TRAD scrolls up 1px / 50ms; a leading digit picks the font colour.
const CREDIT_FONTS = ['Blue', 'BlueGrey', 'Cyan', 'Yellow', 'Magenta', 'Orange', 'Red', 'Green', 'White'].map((c) => `Fonte_${c}_11x13VABBd`);

export class CreditsScene extends MenuScene {
  background = 'MainMenu_Credits';
  sprites = ['Button_NO', 'Menu_CreditAnim', ...CREDIT_FONTS];
  lines = []; // filled once the credits text has loaded (draw can run before build finishes)
  scroll = 0;

  async build(root) {
    root.add(new Button(0, 0, 'Button_NO', { w: 32, h: 32, onClick: () => this.game.go(new MainMenuScene()) }));
    const res = await fetch(`data/ini/TRAD/Credits__TRAD.${this.game.strings.lang}`);
    this.lines = res.ok ? (await res.text()).split('\n').map((l) => l.replace(/\r$/, '')) : [];
    this.scroll = 0;
  }
  update(dt) {
    super.update(dt);
    this.scroll += dt * 20;
  }
  draw(r) {
    r.image(this.background);
    r.sprite('Menu_CreditAnim', Math.floor(this.game.time / 5) % 9, 340, 140, { anchor: 'topleft' });
    const y0 = this.height - 8 - Math.floor(this.scroll);
    this.lines.forEach((line, i) => {
      const y = y0 + i * 17;
      if (!line.trim() || y < 17 || y > this.height - 8) return;
      let font = CREDIT_FONTS[8];
      if (/^[0-8]/.test(line)) { font = CREDIT_FONTS[Number(line[0])]; line = line.slice(1); }
      r.text(font, line, this.width / 4, y);
    });
    this.root.draw(r, this.game.input);
  }
  onEscape() { this.game.go(new MainMenuScene()); }
}

export class QuitScene extends MenuScene {
  background = 'MainMenu_Loading';
  draw(r) {
    r.image(this.background);
    r.text(LIST_FONT, 'Thanks for playing! Click to return to the menu.', 320, 470, { align: 'center' });
  }
  event(ev) { if (ev.type === 'down') this.game.go(new MainMenuScene()); return true; }
}

export class MessageScene {
  overlay = true;
  modal = true;
  enter(game, { text }) { this.game = game; this.text = text; }
  event(ev) { if (ev.type === 'down' || ev.type === 'key') this.game.pop(); return true; }
  draw(r) {
    const x = (r.width - 400) / 2, y = (r.height - 80) / 2;
    r.rect(x, y, 400, 80, 'rgba(10,20,60,0.92)');
    r.strokeRect(x, y, 400, 80, '#4060ff', 2);
    r.textBox('Fonte_White_11x13VABBd', this.text, x + 15, y + 32, 370, 16, { align: 'center' });
  }
}
