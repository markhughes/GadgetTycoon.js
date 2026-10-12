// The in-game screen (800x600): world view + HUD, game menu, end screen. docs/presentation.md §1.12-1.14, §2, §3.
import { Root, Button, TextField, ListBox, EditBox, Panel, Graph } from '../engine/ui.js';
import { iniObject } from '../engine/assets.js';
import { World, VIEW_Y, VIEW_H } from '../world/world.js';
import { Hud } from '../ui/hud.js';
import { createGame } from '../sim/setup.js';
import { serializeGame, restoreGame } from '../sim/savegame.js';
import { listSaves, writeSave, readSave } from '../sim/storage.js';
import { CURSOR } from '../engine/game.js';
import { BOOK } from '../sim/company.js';

const HUD_SPRITES = ['FONT_CHIFFRE_7x13_NOIR', 'FONT_CHIFFRE_7x13_ROUGE', 'FONT_CHIFFRE_7x12',
  'Fonte_Tahoma_violet_13x17_FAR', 'Fonte_Tahoma_violetfonce_13x17_FAR', 'Fonte_Tahoma_violetfonce_13x17_FAB',
  'Fonte_NovaBlackExpandedSSi_Gray_19x16xVAAR', 'Fonte_White_11x13VABBd', 'FONT_GreyGreen_13x13VAAB', 'Button_Menu', 'Button_Indicator',
  'Button_CreditDebit', 'Button_Finance', 'Button_News', 'Button_Perso', 'Button_Poste', 'Button_Action', 'Button_ToggleIn',
  'Button_ToggleOut', 'Gauge00', 'Gauge01', 'Gauge03', 'Gauge04_ButtonSlide', 'LOGOS', 'Number', 'MOUSE_MAIN_SPRITES'];

export class GameScene {
  width = 800;
  height = 600;

  async enter(game, params) {
    this.game = game;
    this.loading = 0;
    this.ready = false;
    this.selection = null;
    this.selectedTarget = null;
    this.chat = null;
    game.r.resize(800, 600);
    await game.assets.preload({ images: ['Game_Loading'], sprites: ['ProgressBar1'] });
    try {
      await this.load(params);
    } catch (e) {
      console.error(e);
      this.error = String(e.message || e);
    }
  }

  async load(params) {
    const g = this.game;
    const step = async (fn) => { const v = await fn(); this.loading++; return v; };
    let save = null;
    if (params.load) {
      save = readSave(params.load);
      if (!save) throw new Error(`Saved game "${params.load}" not found`);
      params = save.params;
    }
    this.params = params;
    this.sim = await step(() => createGame(g, params));
    if (save) restoreGame(this.sim, save);
    this.sim.onPlayerNews = (msg) => this.onNews(msg);
    const setupLevel = await step(() => g.assets.loadIni('LEVEL/SetupLevel.ini'));
    await step(() => g.assets.preload({ images: ['Back01', 'Back02', 'UpperBar800x600', 'LowerBar800x600', 'Panel_Indicator', 'Panel_CreditDebit', 'Panel_Financing', 'Panel_News'], sprites: HUD_SPRITES }));
    this.world = new World(this, this.sim.data, iniObject(setupLevel));
    await step(() => g.assets.preload({ sprites: [1, 2].flatMap((l) => ['Production', 'Laboratory', 'Administration', 'Marketing'].map((d) => `Upgrade_${d}${l}`)) }));
    if (save?.world) Object.assign(this.world.cam, save.world.cam);
    // Preload the sprites of every world object so nothing pops in.
    await step(() => Promise.all(this.world.objects.map((o) => { const v = o.resolve(this.world); return v ? g.assets.loadSprite(v[0]).catch(() => null) : null; })));
    this.root = new Root(g, 800, 600);
    this.hud = this.root.add(new Hud(this));
    this.ready = true;
    g.sounds.stop('menu-ambience');
    this.sim.announce(this.sim.data.text ? `${this.levelTitle()}` : '');
    this.onBlur = () => { if (!this.sim.paused) { this.autoPaused = true; this.sim.paused = true; } };
    this.onFocus = () => { if (this.autoPaused) { this.autoPaused = false; this.sim.paused = false; } };
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
  }

  levelTitle() {
    const s = this.game.strings;
    if (this.sim.mission !== null) return s.get(`MISSION${this.sim.mission}`);
    if (this.sim.mode === 'tutorial') return s.get(`TUTORIAL${this.sim.levelNo - 90}_NAME`);
    return s.get(`VICTORY${this.sim.victoryType}`);
  }

  exit() {
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('focus', this.onFocus);
    this.world?.stopAmbience();
    // Leaving a game stops the CD, then the menu starts a new random track [code 0x462793, 0x40648c].
    this.game.music?.stop();
    this.game.music?.playRandom();
  }

  get sim() { return this._sim; }
  set sim(v) { this._sim = v; }

  // ------------------------------------------------------------------------------------------------

  update(dt) {
    if (!this.ready) return;
    const input = this.game.input;
    if (!this.menuOpen) this.sim.advance(dt * 1000);
    this.game.music?.updateForCash(this.sim.player.cash); // [code 0x462acd]
    this.world.update(dt, input);
    this.root.update(dt, input);
    if (this.sim.result && !this.ended) {
      this.ended = true;
      this.world.stopAmbience();
      this.game.push(new EndScene(), { scene: this });
    }
  }

  event(ev) {
    if (!this.ready) return true;
    if (this.chat && ev.type === 'key') return this.chatKey(ev);
    if (this.root.event(ev, this.game.input)) return true;
    const input = this.game.input;
    if (ev.type === 'up' && ev.button === 0 && ev.y >= VIEW_Y && ev.y < VIEW_Y + VIEW_H) {
      if (!this.world.click(input)) this.clearSelection();
      return true;
    }
    if (ev.type === 'up' && ev.button === 2) { this.clearSelection(); return true; }
    if (ev.type === 'key') {
      if (ev.key === 'Escape') this.openGameMenu();
      else if (ev.key === 'Tab') this.setView(this.world.inside ? 'city' : 'factory');
      else if (ev.key === 'Enter') this.chat = { text: '' };
      else if (/^F([5-9]|10)$/.test(ev.key)) this.world.recenter([0, 3, 5, 10, 14, 15][Number(ev.key.slice(1)) - 5]);
      else if (/^F[1-4]$/.test(ev.key)) this.hud.togglePanel(['Indicator', 'CreditDebit', 'Finance', 'News'][Number(ev.key[1]) - 1], this.hud.openPanel !== ['Indicator', 'CreditDebit', 'Finance', 'News'][Number(ev.key[1]) - 1]);
      else if (ev.key === 'p' || ev.key === 'Pause') this.sim.paused = !this.sim.paused;
    }
    return true;
  }

  // Chat line: in solo play it is used for cheats (docs/presentation.md §5.3).
  chatKey(ev) {
    if (ev.key === 'Escape') { this.chat = null; return true; }
    if (ev.key === 'Enter') { this.cheat(this.chat.text.trim()); this.chat = null; return true; }
    if (ev.key === 'Backspace') this.chat.text = this.chat.text.slice(0, -1);
    else if (ev.key.length === 1 && this.chat.text.length < 60) this.chat.text += ev.key;
    return true;
  }

  cheat(text) {
    const p = this.sim.player;
    const t = text.toLowerCase();
    const up = (dept) => { const type = ['MARKETING', 'ADMIN', 'LABO', 'PROD'].indexOf(dept) * 4; for (let k = 0; k < 4; k++) if (p.objectEntry(type + k, p.objects[type + k] + 1)) { p.objects[type + k]++; p.applyObjectEffects(type + k, 1); } };
    if (t === '!givemecash') { p.cash += 10000000; p.balance += 10000000; }
    else if (t === '!944') { this.world.extras.porsche = true; this.game.sounds.play('VAR_944'); }
    else if (t === '!lemmingsonstrike') { this.world.addLemmings(); this.game.sounds.play('VAR_LEMMING00'); }
    else if (t === '!upprod') up('PROD');
    else if (t === '!upadmin') up('ADMIN');
    else if (t === '!upmarket') up('MARKETING');
    else if (t === '!uplabo') up('LABO');
    else if (t.startsWith('!gameover')) this.sim.result = t.endsWith('0') ? { won: true, reason: 1 } : { won: false, reason: 0 };
    else if (t === '!shadow') { this.game.settings.spriteShadow = !this.game.settings.spriteShadow; this.sim.announce(this.game.strings.get(this.game.settings.spriteShadow ? 'SYSTEM_SHADOW_ON' : 'SYSTEM_SHADOW_OFF')); return; }
    else if (t === 'fps') { this.showFps = !this.showFps; return; }
    else if (text) { this.sim.announce(`${p.name}: ${text}`); return; }
    else return;
    this.sim.announce(`Cheat: ${text}`);
  }

  setView(v) {
    this.world.setView(v === 'factory');
    this.hud.viewButtons?.();
  }

  centreOnMinimap(fx, fy) {
    const bg = this.world.bg;
    this.world.centreOn(fx * bg.w, fy * bg.h);
  }

  drawMinimap(r, x, y, w, h) { this.world.drawMinimap(r, x, y, w, h); }

  // Clicking a world object selects it and opens the matching lower-bar panel.
  selectTarget(target) {
    this.selectedTarget = target;
    const p = this.sim.player;
    switch (target.type) {
      // A workstation opens Personnel (the employee, or applicants to hire) once it has a desk; Materials otherwise.
      case 'workstation': this.selection = { ws: target.ws }; this.hud.setMode(p.workstation(target.ws).deskLevel > 0 || p.workstation(target.ws).worker ? 'perso' : 'poste'); break;
      case 'labmachine': this.selection = { ws: 5, machine: target }; this.hud.setMode('poste'); break;
      case 'equipment': {
        const dept = ['MARKETING', 'ADMIN', 'LABO', 'PROD'].indexOf(target.dept);
        const ws = [3, 0, 5, 9][dept];
        const kind = { WALL: 0, ALARM: 1, EFFICIENT: 2, SPIRIT: 3 }[target.kind];
        // Icons per object type from the panel's switch [code 0x42f825, table 0x4325da].
        const icon = { 0: ['MARKET_UPGRADE64x64', 'MARKET_CAMERA64x64', 'MARKET_TV64x64', 'MARKET_FLOWER64x64'], 1: ['ADMIN_UPGRADE64x64', 'ADMIN_CHEST64x64', 'ADMIN_REUNION64x64', 'ADMIN_PLAK64x64'],
          2: ['LABO_UPGRADE64x64', 'LABO_SECURITY64x64', 'LABO_AIR_CONDITIONING64x64', 'LABO_PHARMACY64x64'], 3: ['PROD_UPGRADE64x64', 'PROD_SECURITY64x64', 'PROD_AIR_CONDITIONING64x64', 'PROD_PHARMACY64x64'] }[dept][kind];
        this.selection = { ws, item: { type: dept * 4 + kind, icon } };
        this.hud.setMode('poste');
        break;
      }
      case 'research': this.selection = { ws: target.ws ?? 5 }; this.hud.setMode('action'); break;
      case 'board': this.selection = { ws: 9, board: true }; this.hud.setMode('action'); break;
      case 'stock': this.selection = { ws: 9 }; this.hud.setMode('action'); break;
      default: this.selection = null; this.hud.setMode(null);
    }
    this.hud.lastSel = this.selection;
  }

  clearSelection() {
    this.selection = null;
    this.selectedTarget = null;
  }

  onNews(msg) {
    if (msg.alert) this.game.sounds.play(msg.alert >= 2 ? 'WARNING' : 'WARNING2');
    else this.game.sounds.play('CHAT_RING1', { volume: 0.6 });
    this.sim.announce(msg.title);
  }

  openGameMenu() {
    if (this.menuOpen) return;
    this.game.push(new GameMenuScene(), { scene: this });
  }

  cursor() {
    if (!this.ready) return CURSOR.WAIT;
    const input = this.game.input;
    if (input.y < VIEW_Y || input.y >= VIEW_Y + VIEW_H || this.root.hintAt(this.root, input.x, input.y)) {
      const code = this.world.scrollCode(input);
      if (code !== 4) return this.world.cursor();
      return CURSOR.ARROW;
    }
    return this.world.cursor();
  }

  draw(r) {
    if (!this.ready) {
      r.image('Game_Loading');
      const f = r.frameInfo('ProgressBar1', 0);
      if (f) {
        const w = Math.round((f.w * Math.min(4, this.loading)) / 4);
        const s = r.assets.sprite('ProgressBar1');
        if (w > 0) r.ctx.drawImage(s.image, f.x, f.y, w, f.h, 120, 580, w, f.h);
      }
      if (this.error) r.textBox('Fonte_White_11x13VABBd', `Could not start the game: ${this.error}`, 100, 300, 600, 16);
      return;
    }
    this.world.draw(r);
    // Chat / announcement lines over the world, above the lower bar.
    const now = performance.now();
    let y = VIEW_Y + VIEW_H - 30;
    for (const m of this.sim.messages) {
      if (now - m.time > 12000) continue;
      r.text('Fonte_White_11x13VABBd', m.text, 8, y);
      y -= 15;
    }
    if (this.chat) {
      r.rect(0, 452 - 24, 600, 20, 'rgba(0,0,0,0.6)');
      r.text('Fonte_White_11x13VABBd', `> ${this.chat.text}${Math.floor(now / 400) % 2 ? '_' : ''}`, 6, 452 - 10);
    }
    if (this.sim.paused && !this.menuOpen) r.text('FONT_MENU_NOVA14x23', 'PAUSE', 400, 240, { align: 'center' });
    this.root.draw(r, this.game.input);
    if (this.showFps) r.text('Fonte_White_11x13VABBd', `${Math.round(1 / Math.max(1e-3, this.game.lastDt ?? 0.016))} fps`, 740, 46);
  }
}

// ------------------------------------------------------------------------------------------------
// In-game menu (GameMenu 400x300 centred) with Save and Quit sub-panels [code 0x40c310].

class GameMenuScene {
  overlay = true;
  modal = true;

  async enter(game, { scene }) {
    this.game = game;
    this.scene = scene;
    scene.menuOpen = true;
    this.wasPaused = scene.sim.paused;
    scene.sim.paused = true;
    await game.assets.preload({ sprites: ['GameMenu', 'GameMenu_Save', 'GameMenu_Quit', 'BOUTON1_MENU_GAME', 'BOUTON2_MENU_GAME', 'BOUTON3_MENU_GAME',
      'BOUTON1_MENU_SAVE', 'BOUTON2_MENU_SAVE', 'BOUTON1_MENU_QUIT', 'BOUTON2_MENU_QUIT', 'FONT_MENU_NOVA14x23_MENU', 'FONT_TITLE'] });
    this.root = new Root(game, 800, 600);
    const t = (id) => game.strings.get(id);
    const F = 'FONT_MENU_NOVA14x23', FH = 'FONT_MENU_NOVA14x23_MENU';
    const menu = this.root.add(new Panel(200, 150, 400, 300, { sprite: 'GameMenu', modal: true }));
    menu.add(new TextField(0, 0, 400, 80, t('GAME_MENU_TITLE'), { font: 'FONT_TITLE', align: 'center' }));
    const btn = (parent, x, y, sprite, id, onClick) => parent.add(new Button(x, y, sprite, { w: 149, h: 24, label: t(id), font: F, hoverFont: FH, labelY: 19, onClick }));
    btn(menu, 125, 98, 'BOUTON1_MENU_GAME', 'GAME_MENU_RESUMEGAME', () => this.close());
    btn(menu, 125, 138, 'BOUTON2_MENU_GAME', 'GAME_MENU_SAVEGAME_BUTTON', () => { save.visible = true; refresh(); });
    btn(menu, 125, 178, 'BOUTON3_MENU_GAME', 'GAME_MENU_QUITGAME', () => { quit.visible = true; });
    // Save panel.
    const save = menu.add(new Panel(0, 0, 400, 300, { sprite: 'GameMenu_Save', modal: true }));
    save.visible = false;
    save.add(new TextField(16, 8, 368, 30, t('GAME_MENU_SAVEGAME'), { font: 'FONT_MENU_NOVA19x30' }));
    const list = save.add(new ListBox(16, 38, 372, 184, { rowHeight: 23, items: [],
      renderRow: (r, s, x, y, w, sel, hover) => {
        if (sel || hover) r.rect(x, y + 1, w, 22, sel ? 'rgba(60,90,220,0.45)' : 'rgba(60,90,220,0.2)');
        r.text(F, s.name, x + 6, y + 18);
      },
      onSelect: (s) => { edit.text = s.name; } }));
    const edit = save.add(new EditBox(16, 230, 214, 20, { maxLength: 20 }));
    const refresh = () => { list.setItems(listSaves()); edit.text = ''; edit.focused = true; };
    btn(save, 80, 263, 'BOUTON1_MENU_SAVE', 'GAME_MENU_SAVEGAME_BUTTON', () => {
      const name = edit.text.trim() || `Save ${new Date().toLocaleString()}`;
      try {
        writeSave(name, serializeGame(this.scene));
        this.scene.sim.announce(`Saved "${name}"`);
        this.close();
      } catch (e) {
        this.scene.sim.announce(`Save failed: ${e.message}`);
      }
    });
    btn(save, 240, 262, 'BOUTON2_MENU_SAVE', 'GAME_MENU_CANCEL', () => { save.visible = false; });
    // Quit panel.
    const quit = menu.add(new Panel(0, 0, 400, 300, { sprite: 'GameMenu_Quit', modal: true }));
    quit.visible = false;
    quit.add(new TextField(50, 98 - 30, 304, 24, t('GAME_MENU_QUITTER'), { font: 'FONT_MENU_NOVA19x30', align: 'center' }));
    btn(quit, 125, 138, 'BOUTON1_MENU_QUIT', 'YES', () => this.leave());
    btn(quit, 125, 178, 'BOUTON2_MENU_QUIT', 'NO', () => { quit.visible = false; });
    quit.children.at(-2).label = 'Yes';
    quit.children.at(-1).label = 'No';
  }

  close() {
    this.scene.menuOpen = false;
    this.scene.sim.paused = this.wasPaused;
    this.game.pop();
  }

  async leave() {
    this.scene.menuOpen = false;
    const { MainMenuScene } = await import('./menus.js');
    this.game.go(new MainMenuScene());
  }

  update(dt) { this.root?.update(dt, this.game.input); }
  event(ev) {
    if (ev.type === 'key' && ev.key === 'Escape') { this.close(); return true; }
    this.root?.event(ev, this.game.input);
    return true;
  }
  draw(r) {
    r.rect(0, 0, 800, 600, 'rgba(0,0,0,0.35)');
    this.root?.draw(r, this.game.input);
  }
  cursor() { return CURSOR.ARROW; }
}

// ------------------------------------------------------------------------------------------------
// End screen [code 0x40cce0, 0x419df6]: success/failure background, three graphs, score line.

class EndScene {
  async enter(game, { scene }) {
    this.game = game;
    this.scene = scene;
    const sim = scene.sim;
    const res = sim.result;
    this.won = !!res.won;
    await game.assets.preload({ images: [this.won ? 'Game_Success0' : 'Game_Failed0'], sprites: ['Menu_Bouton_Validate', 'Fonte_GreenBlue_13x16VAAR', 'FONT_MENU_NOVA14x23',
      'Fonte_Red_11x13VABBd', 'Fonte_Cyan_11x13VABBd', 'Fonte_Blue_11x13VABBd', 'Fonte_Magenta_11x13VABBd'] });
    const t = (id) => game.strings.get(id);
    this.title = this.won ? t(res.reason === 0 ? 'GAME_OVER_MAIN_MENU_TITLE_WIN0' : 'GAME_OVER_MAIN_MENU_TITLE_WIN1')
      : t(res.reason === 0 ? 'GAME_OVER_MAIN_MENU_TITLE_LOOSE0' : 'GAME_OVER_MAIN_MENU_TITLE_LOOSE1');
    const p = sim.player;
    const h = p.statsHistory.slice(-200);
    const series = (key, sign = 1, color = 0, min = 0, max = 100000) => ({ color, values: h.map((x) => Math.max(min, Math.min(max, sign * x[key]))), min, max });
    this.root = new Root(game, 800, 600);
    this.root.add(new Graph(82, 73, 600, 160, { samples: 200, series: () => [series('sales', 1, 0), series('patents', 1, 1), series('misc', 1, 2)] }));
    this.root.add(new Graph(82, 268, 600, 119, { samples: 200, series: () => [series('balance', 1, 0, -100000, 100000)] }));
    this.root.add(new Graph(82, 420, 600, 160, { samples: 200, series: () => [series('components', -1, 0, -100000, 0), series('salaries', -1, 1, -100000, 0), series('pub', -1, 2, -100000, 0), series('other', -1, 3, -100000, 0)] }));
    const legend = [['GAME_OVER_CREDITS_CURVE0', 0, 108], ['GAME_OVER_CREDITS_CURVE1', 1, 93], ['GAME_OVER_CREDITS_CURVE2', 2, 78], ['GAME_OVER_BALANCE_CURVE0', 0, 328],
      ['GAME_OVER_DEBITS_CURVE0', 0, 470], ['GAME_OVER_DEBITS_CURVE1', 1, 455], ['GAME_OVER_DEBITS_CURVE2', 2, 440], ['GAME_OVER_DEBITS_CURVE3', 3, 425]];
    const fonts = ['Fonte_Red_11x13VABBd', 'Fonte_Cyan_11x13VABBd', 'Fonte_Blue_11x13VABBd', 'Fonte_Magenta_11x13VABBd'];
    for (const [id, c, y] of legend) this.root.add(new TextField(692, y, 100, 14, t(id), { font: fonts[c] }));
    this.score = `${t('GAME_OVER_SCORE_MESSAGE_TIMER')} ${sim.day}  ${t('GAME_OVER_SCORE_MESSAGE_CASH')} ${Math.round(p.bottomLine)}  ${t('GAME_OVER_SCORE_MESSAGE_SHARE')} ${p.sharePrice}  ${t('GAME_OVER_SCORE_MESSAGE_EMOTIVES')} ${p.soldE}  ${t('GAME_OVER_SCORE_MESSAGE_TECHNOIDS')} ${p.soldT}`;
    this.root.add(new Button(800 - 84, 600 - 93, 'Menu_Bouton_Validate', { tooltip: 'GAME_MENU_BACK_MAIN_MENU', onClick: () => this.done() }));
    void BOOK;
  }

  async done() {
    // Winning one of the five main campaign missions plays the ending video [code 0x419760].
    if (this.won && [4, 5, 6, 7, 8].includes(this.scene.sim.levelNo)) {
      const { playExtro } = await import('./boot.js');
      await playExtro(this.game);
    }
    const { MainMenuScene } = await import('./menus.js');
    this.game.go(new MainMenuScene());
  }

  update(dt) { this.root?.update(dt, this.game.input); }
  event(ev) { this.root?.event(ev, this.game.input); return true; }
  draw(r) {
    r.image(this.won ? 'Game_Success0' : 'Game_Failed0');
    r.text('FONT_MENU_NOVA14x23', this.title, 400, 40, { align: 'center' });
    this.root?.draw(r, this.game.input);
    r.text('Fonte_GreenBlue_13x16VAAR', this.score, 82, 594);
  }
  cursor() { return CURSOR.ARROW; }
}
