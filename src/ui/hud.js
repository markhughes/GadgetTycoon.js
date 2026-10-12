// In-game HUD at 800x600 (layout from the original's builders, see docs/presentation.md):
//   upper bar  0x4138c0  (0,0,800,30)      menu button, balance/cash/date/employees, 4 side-panel toggles
//   lower bar  0x40d24a  (0,452,800,148)   minimap, person/workstation/action domes, contextual area, graph
//   side panels           (550,30,250,422)  Indicator / CreditDebit / Financing / News, one at a time
import { Widget, Panel, Button, TextField, Graph } from '../engine/ui.js';
import { buildIndicatorPanel, buildCreditDebitPanel, buildFinancingPanel, buildNewsPanel } from './panels.js';
import { buildContextArea } from './context.js';

export const W = 800;
export const H = 600;
export const UPPER_H = 30;
export const LOWER_H = 148;
export const LOWER_Y = H - LOWER_H;

const DIGITS = 'FONT_CHIFFRE_7x13_NOIR';
const DIGITS_RED = 'FONT_CHIFFRE_7x13_ROUGE';

// Balance & cash format [code 0x428520]: sign, then |v| with ',' thousands separators.
// The digit fonts have no '+' glyph, so positive values show unsigned.
export function money(v) {
  const n = Math.round(Math.abs(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-' : '+') + n;
}

export function dateString(day) {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, ' ')}/${String(d.getUTCDate()).padStart(2, ' ')}`;
}

export class Hud extends Widget {
  // scene: the in-game scene (gives access to sim, camera, selection).
  constructor(scene) {
    super(0, 0, W, H);
    this.scene = scene;
    this.openPanel = null;
    this.buildUpper();
    this.buildPanels();
    this.buildLower();
  }

  get sim() { return this.scene.sim; }
  get player() { return this.scene.sim.player; }
  t(id, ...a) { return this.scene.game.strings.get(id, ...a); }

  buildUpper() {
    const bar = this.add(new Panel(0, 0, W, UPPER_H, { image: 'UpperBar800x600' }));
    bar.add(new Button(4, 0, 'Button_Menu', { w: 35, h: 30, tooltip: 'BUTTON_MENU', onClick: () => this.scene.openGameMenu() }));
    const value = (v) => () => (v() <= 0 ? DIGITS_RED : DIGITS);
    bar.add(new TextField(60, 10, 121, 20, () => money(this.player.balance), { font: value(() => this.player.balance), align: 'right', tooltip: 'UB_BALANCE' }));
    bar.add(new TextField(196, 10, 133, 20, () => money(this.player.cash), { font: value(() => this.player.cash), align: 'right', tooltip: 'UB_CASH' }));
    bar.add(new TextField(345, 10, 124, 20, () => dateString(this.sim.day), { font: DIGITS, align: 'right', tooltip: 'UB_DATE' }));
    bar.add(new TextField(484, 10, 42, 20, () => `${this.player.employeeCount}`, { font: DIGITS, align: 'right', tooltip: 'UB_EMPLOYEES' }));
    this.panelButtons = {};
    const toggles = [['Indicator', W - 171, 'BUTTON_INDICATOR'], ['CreditDebit', W - 129, 'BUTTON_CREDIT_DEBIT'],
      ['Finance', W - 88, 'BUTTON_FINANCE'], ['News', W - 46, 'BUTTON_NEWS']];
    for (const [name, x, tip] of toggles) {
      this.panelButtons[name] = bar.add(new Button(x, 0, `Button_${name}`, {
        w: 45, h: 30, toggle: true, tooltip: tip, onClick: (b) => this.togglePanel(name, b.checked),
      }));
    }
  }

  buildPanels() {
    const mk = (image, title, build) => {
      const p = this.add(new Panel(W - 250, UPPER_H, 250, 422, { image, modal: false }));
      p.visible = false;
      if (image === 'Panel_Indicator') {
        // This background has the French title "INDICATEUR" painted in, under the translated title the game
        // draws [code 0x413eeb]; cover it with the plain metal strip of another panel so the text isn't doubled.
        const patch = p.add(new Widget(60, 2, 130, 20));
        patch.onDraw = (r) => {
          const img = r.assets.image('Panel_CreditDebit');
          if (img) r.ctx.drawImage(img, 60, 2, 130, 20, patch.ax, patch.ay, 130, 20);
        };
      }
      p.add(new TextField(0, 4, 250, 26, () => this.t(title), { font: 'Fonte_NovaBlackExpandedSSi_Gray_19x16xVAAR', align: 'center' }));
      build(p, this);
      return p;
    };
    this.panels = {
      Indicator: mk('Panel_Indicator', 'PANNEL_INDICATORS', buildIndicatorPanel),
      CreditDebit: mk('Panel_CreditDebit', 'PANNEL_DEBIT', buildCreditDebitPanel),
      Finance: mk('Panel_Financing', 'PANNEL_FINANCING', buildFinancingPanel),
      News: mk('Panel_News', 'PANEL_NEWS', buildNewsPanel),
    };
  }

  // Only one side panel is open at a time; clicking the open one closes it [code 0x428724].
  togglePanel(name, open) {
    for (const [k, p] of Object.entries(this.panels)) {
      p.visible = open && k === name;
      this.panelButtons[k].checked = p.visible;
    }
    this.openPanel = open ? name : null;
  }

  buildLower() {
    const bar = this.add(new Panel(0, LOWER_Y, W, LOWER_H, { image: 'LowerBar800x600' }));
    this.lower = bar;
    // Minimap click area [code 0x41a882]: maps the click to the world and centres the camera.
    const map = bar.add(new Widget(16, 48, 113, 68));
    map.onEvent = (ev) => {
      if (ev.type !== 'down' || ev.button !== 0 || !map.contains(ev.x, ev.y)) return false;
      this.scene.centreOnMinimap((ev.x - map.ax) / map.w, (ev.y - map.ay) / map.h);
      map.dragging = true;
      return true;
    };
    map.onUpdate = (dt, input) => {
      if (map.dragging && !input.down) map.dragging = false;
      if (map.dragging) this.scene.centreOnMinimap((input.x - map.ax) / map.w, (input.y - map.ay) / map.h);
    };
    map.onDraw = (r) => this.scene.drawMinimap(r, map.ax, map.ay, map.w, map.h);
    // Zoom buttons under the minimap: the original toggles between the factory view and the city view.
    bar.add(new Button(11, 123, 'Button_ToggleIn', { w: 40, h: 18, tooltip: 'BUTTON_TOGGLEIN', onClick: () => this.scene.setView('factory') }));
    bar.add(new Button(89, 123, 'Button_ToggleOut', { w: 40, h: 18, tooltip: 'BUTTON_TOGGLEOUT', onClick: () => this.scene.setView('city') }));
    // Player-colour lamps (multiplayer chat recipients); here they light up for companies in play.
    const lamps = [[21, 29], [35, 18], [48, 25], [61, 14], [76, 24], [89, 13], [103, 24], [116, 13]];
    lamps.forEach(([x, y], i) => {
      const b = bar.add(new Button(x, y, `Button_Chat${i}`, { w: 12, h: 12, toggle: true, sound: null }));
      b.onUpdate = function (dt, input) {
        Button.prototype.onUpdate.call(this, dt, input);
        this.enabled = !!this.game?.scene?.sim?.companies?.[i];
        this.checked = this.enabled;
      };
      b.onEvent = () => false;
    });
    // Domes select what the contextual area shows for the selected employee.
    this.modeButtons = {};
    const modes = [['perso', 140, 10, 'Button_Perso', 'BUTTON_PERSO'], ['poste', 140, 55, 'Button_Poste', 'BUTTON_POSTE'],
      ['action', 140, 100, 'Button_Action', 'BUTTON_ACTION']];
    for (const [mode, x, y, sprite, tip] of modes) {
      this.modeButtons[mode] = bar.add(new Button(x, y, sprite, { w: 40, h: 40, toggle: true, tooltip: tip, onClick: () => this.setMode(mode) }));
    }
    this.context = buildContextArea(bar, this);
    bar.add(new Graph(669, 15, 117, 110, { tooltip: 'GRAPH_CURVES', series: () => this.sim.graphSeries() }));
    this.setMode(null);
  }

  // Contextual area mode: 'perso' (employee), 'poste' (workstation), 'action' (special actions / research).
  setMode(mode) {
    const sel = this.scene.selection;
    // Equipment and lab machines only have Materials; the production board only has Actions. (They borrow a
    // workstation index internally, which would otherwise show that workstation's staff.)
    const allowed = !sel ? [] : sel.item || sel.machine ? ['poste'] : sel.board ? ['action'] : ['perso', 'poste', 'action'];
    if (mode && !allowed.includes(mode)) mode = allowed[0] ?? null;
    this.mode = mode;
    for (const [m, b] of Object.entries(this.modeButtons)) {
      b.enabled = allowed.includes(m);
      b.checked = m === mode;
    }
    this.context.show(mode, sel);
  }

  onUpdate() {
    // Keep the domes in sync with selection changes made in the world.
    if (this.lastSel !== this.scene.selection) {
      this.lastSel = this.scene.selection;
      this.setMode(this.scene.selection ? this.mode ?? 'perso' : null);
    }
  }
}
