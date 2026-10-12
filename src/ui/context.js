// Lower-bar contextual area (181,0,476,148): PERSO (employee), POSTE (workstation & room equipment) and
// ACTION (activity sliders, one-off actions, research / product line), docs/presentation.md §2.3.
import { Widget, Panel, Button, TextField, Gauge, ListBox, IconGrid } from '../engine/ui.js';
import { ACTION, listText } from '../sim/data.js';
import { repeatButton } from './panels.js';

const A = 'Fonte_Tahoma_violet_13x17_FAR';
const LCD = 'Fonte_Tahoma_violetfonce_13x17_FAR';
const DIG = 'FONT_CHIFFRE_7x12';
const GRID_FONT = 'FONT_GreyGreen_13x13VAAB';

// Per workstation: sprite families and text keys.
const ROLE = [
  { key: 'COMPTABLE', big: 'Big_Face_Admin_COMPTABLE', face: 'Admin_COM_Face', desk: 'ADMIN_COMPTABLE64x64', dept: 1, points: [ACTION.BTN_ESPIONAGE_TRIAL, ACTION.BTN_SLANDER_SOCIETY, ACTION.BTN_LAUNCH_FISCAL_CONTROL] },
  { key: 'FINANCIER', big: 'Big_Face_Admin_FIN', face: 'Admin_FIN_Face', desk: 'ADMIN_FINANCIER64x64', dept: 1, points: [ACTION.FLG_BLACK_OPS, ACTION.FLG_CONTACT_MAFIA] },
  { key: 'DRH', big: 'Big_Face_Admin_DRH', face: 'Admin_DRH_Face', desk: 'ADMIN_DRH64x64', dept: 1, points: [ACTION.BTN_MOTIVATE_ADMIN_AND_MARK, ACTION.BTN_MOTIVATE_PRODUCTION, ACTION.BTN_MOTIVATE_LABORATORY, ACTION.BTN_MOTIVATE_SPECIALS] },
  { key: 'PUB', big: 'Big_Face_Market_Publicitaire', face: 'Market_PUB_Face', desk: 'ADMIN_COMPTABLE64x64', dept: 0, points: [ACTION.FLG_GET_ZEPPELIN, ACTION.FLG_GET_MOON_CONCESSION] },
  { key: 'COM', big: 'Big_Face_Market_Commercial', face: 'Market_COM_Face', desk: 'ADMIN_DRH64x64', dept: 0, points: [ACTION.FLG_DEAL_OLD_STOCK, ACTION.BTN_CORRUPT_DISTRIBUTOR] },
  ...[0, 1, 2, 3].map(() => ({ key: 'SEEKER', big: 'Big_Face_Labo_Seeker', face: 'Labo_Seeker_Face', desk: 'LABO_PAILLASSE64x64', dept: 2, points: [] })),
  { key: 'MANUT_CHIEF', big: 'Big_Face_Prod_Manut_Chief', face: 'FaceChief', desk: 'PROD_MACHINE_CHIEF64x64', dept: 3, points: [ACTION.BTN_REPAIR_MACHINE] },
  ...[0, 1, 2, 3].map(() => ({ key: 'MANUT', big: 'Big_Face_Prod_Manut', face: 'Face', desk: 'PROD_MACHINE64x64', dept: 3, points: [ACTION.BTN_REPAIR_MACHINE] })),
  { key: 'GARDIAN', big: 'Big_Face_Outside_Guardian', face: 'Outside_Guardien_Face', desk: 'OUTSIDE_GUERITE64x64', dept: -1, points: [] },
  { key: 'SPY', big: 'Big_Face_Outside_Spy', face: 'Outside_Spy_Face', desk: 'OUTSIDE_SPY64x64', dept: -1, points: [ACTION.BTN_STEAL_PATENT, ACTION.BTN_SABOTAGE_PRODUCTION, ACTION.BTN_SPY_ADMIN_AND_MARK] },
  { key: 'MAFIEU', big: 'Big_Face_Outside_Mafieu', face: 'Outside_Mafieu_Face', desk: 'OUTSIDE_MAFIEU64x64', dept: -1, points: [ACTION.BTN_THREATEN_ADMIN_AND_MARK_WORKER, ACTION.BTN_THREATEN_PRODUCTION_WORKER, ACTION.BTN_THREATEN_LABORATORY_WORKER, ACTION.BTN_THREATEN_SPECIAL_WORKER] },
];
const SLIDER_TEXT = { FINANCIER: 'FINANCIER', DRH: 'DRH', PUB: 'PUB', COM: 'COM', MANUT_CHIEF: 'MANUT_CHIEF', MANUT: 'MANUT', GARDIAN: 'GUARDIAN' };
const POINT_SPRITE = {
  [ACTION.BTN_REPAIR_MACHINE]: ['Action_Repair', 'ACTION_PONCT_REPAIR'], [ACTION.FLG_GET_ZEPPELIN]: ['Action_Zeppelin', 'ACTION_PONCT_ZEPPELIN'],
  [ACTION.FLG_GET_MOON_CONCESSION]: ['Action_Lunar', 'ACTION_PONCT_LUNAR'], [ACTION.FLG_DEAL_OLD_STOCK]: ['Action_AncienStock', 'ACTION_PONCT_STOCK'],
  [ACTION.BTN_CORRUPT_DISTRIBUTOR]: ['Action_PotDeVin', 'ACTION_PONCT_POT_DE_VIN'], [ACTION.BTN_MOTIVATE_ADMIN_AND_MARK]: ['Action_KadoAM', 'ACTION_PONCT_KADO_AM'],
  [ACTION.BTN_MOTIVATE_PRODUCTION]: ['Action_KadoProd', 'ACTION_PONCT_KADO_PROD'], [ACTION.BTN_MOTIVATE_LABORATORY]: ['Action_KadoLabo', 'ACTION_PONCT_KADO_LABO'],
  [ACTION.BTN_MOTIVATE_SPECIALS]: ['Action_KadoExt', 'ACTION_PONCT_KADO_EXTERIOR'], [ACTION.FLG_BLACK_OPS]: ['Action_CaisseNoire', 'ACTION_PONCT_BLACK_CASE'],
  [ACTION.FLG_CONTACT_MAFIA]: ['Action_Voiture', 'ACTION_PONCT_CAR'], [ACTION.BTN_ESPIONAGE_TRIAL]: ['Action_CodePenal', 'ACTION_PONCT_PROCES'],
  [ACTION.BTN_SLANDER_SOCIETY]: ['Action_Telephone', 'ACTION_PONCT_RUMOR'], [ACTION.BTN_LAUNCH_FISCAL_CONTROL]: ['Action_XFiles', 'ACTION_PONCT_X_FILES'],
  [ACTION.BTN_STEAL_PATENT]: ['Action_Voler', 'ACTION_PONCT_STEAL'], [ACTION.BTN_SABOTAGE_PRODUCTION]: ['Action_Saboter', 'ACTION_PONCT_SABOT'],
  [ACTION.BTN_SPY_ADMIN_AND_MARK]: ['Action_Espionner', 'ACTION_PONCT_SPY'], [ACTION.BTN_THREATEN_ADMIN_AND_MARK_WORKER]: ['Action_Menacer_AM', 'ACTION_PONCT_MENACER_AM'],
  [ACTION.BTN_THREATEN_PRODUCTION_WORKER]: ['Action_Menacer_Prod', 'ACTION_PONCT_MENACER_PROD'], [ACTION.BTN_THREATEN_LABORATORY_WORKER]: ['Action_Menacer_Labo', 'ACTION_PONCT_MENACER_LABO'],
  [ACTION.BTN_THREATEN_SPECIAL_WORKER]: ['Action_Menacer_Ext', 'ACTION_PONCT_MENACER_EXT'],
};
const TARGETED = new Set([ACTION.BTN_ESPIONAGE_TRIAL, ACTION.BTN_SLANDER_SOCIETY, ACTION.BTN_STEAL_PATENT, ACTION.BTN_SABOTAGE_PRODUCTION,
  ACTION.BTN_SPY_ADMIN_AND_MARK, ACTION.BTN_THREATEN_ADMIN_AND_MARK_WORKER, ACTION.BTN_THREATEN_PRODUCTION_WORKER,
  ACTION.BTN_THREATEN_LABORATORY_WORKER, ACTION.BTN_THREATEN_SPECIAL_WORKER]);
// Tech tree icon families per product category file.
const TECH_ICONS = {
  ToiletSeat: ['WC_Bowl1', 'WC_Bowl_Activated', 'WC_Big_Bowl', 'Button_LB_Filter_WC_Seat'],
  ToiletFlush: ['WC_Flush1', 'WC_Flush_Activated', 'WC_Big_Flush', 'Button_LB_Filter_WC_Chain'],
  ToiletExtras: ['WC_Brush1', 'WC_Brush_Activated', 'WC_Big_Brush', 'Button_LB_Filter_WC_Access'],
  RollerFoot: ['ROLLERS_Shoes1', 'ROLLERS_Shoes_Activated', 'ROLLERS_Shoes', 'Button_LB_Filter_ROLLER_Foots'],
  RollerMovement: ['ROLLERS_Wheels1', 'ROLLERS_Wheels_Activated', 'ROLLERS_Wheels', 'Button_LB_Filter_ROLLER_Move'],
  RollerHelmet: ['ROLLERS_Helmet1', 'ROLLERS_Helmet_Activated', 'ROLLERS_Helmet', 'Button_LB_Filter_ROLLER_Helmet'],
  RobotHead: ['ROBOT_Radar1', 'ROBOT_Radar_Activated', 'ROBOT_Big_Radar', 'Button_LB_Filter_ROBOT_Head'],
  RobotIntelligence: ['ROBOT_Brain1', 'ROBOT_Brain_Activated', 'ROBOT_Big_Brain', 'Button_LB_Filter_ROBOT_Mind'],
  RobotMovement: ['ROBOT_Leg1', 'ROBOT_Leg_Activated', 'ROBOT_Big_Leg', 'Button_LB_Filter_ROBOT_Move'],
  RobotArm: ['ROBOT_Arm1', 'ROBOT_Arm_Activated', 'ROBOT_Big_Arm', 'Button_LB_Filter_ROBOT_Arm'],
};

export function buildContextArea(bar, hud) {
  const area = bar.add(new Widget(181, 0, 476, 148));
  const panels = { perso: buildPerso(area, hud), poste: buildPoste(area, hud), action: buildAction(area, hud) };
  area.show = (mode) => {
    for (const [k, p] of Object.entries(panels)) {
      p.visible = k === mode;
      if (p.visible) p.onShow?.();
    }
  };
  return area;
}

const sel = (hud) => hud.scene.selection; // { ws } when a workstation/employee is selected
const ws = (hud) => (sel(hud)?.ws !== undefined ? hud.player.workstations[sel(hud).ws] : null);
const role = (hud) => ROLE[sel(hud)?.ws ?? 0];
const fmt = (v) => Math.round(v).toLocaleString('en-US');

function common(p, hud, gauges, labels, number, numberTip) {
  gauges.forEach(([sprite, value, tip], i) => p.add(new Gauge(95, 19 + i * 15, 56, 4, sprite, { value, tooltip: tip })));
  labels.forEach((id, i) => p.add(new TextField(155, 16 + i * 15, 52, 17, () => (typeof id === 'function' ? id() : hud.t(id)), { font: A })));
  p.add(new TextField(93, 64, 49, 14, number, { font: DIG, align: 'right', tooltip: numberTip }));
  const desc = p.add(new ListBox(15, 93, 182, 42, { rowHeight: 14, renderRow: (r, line, x, y) => r.text(LCD, line, x + 2, y + 11) }));
  return desc;
}

// ------------------------------------------------------------------------------------------------
// PERSO: the employee at the selected workstation and the candidates for it.

function buildPerso(area, hud) {
  const p = area.add(new Panel(0, 0, 476, 148));
  p.visible = false;
  let picked = null; // worker record shown (current employee or a candidate)
  let offerDelta = 0;
  const shown = () => picked ?? ws(hud)?.worker ?? null;
  const portrait = p.add(new Widget(16, 12, 64, 64));
  portrait.onDraw = (r) => {
    const w = shown();
    if (!w) return;
    const R = role(hud);
    const n = Math.max(1, r.frameCount(R.big));
    r.sprite(R.big, w.PhotoID % n, portrait.ax, portrait.ay, { anchor: 'topleft' });
    // An employee in training wears a badge on the portrait: level, efficiency or morale course
    // [code 0x4307a2: FORMATION frame 2 / 3 / 1 for training kind 0 / 1 / 2; badge position inferred].
    const seat = ws(hud);
    if (seat?.worker === w && seat.training !== -1) r.sprite('FORMATION', [2, 3, 1][seat.training], portrait.ax + 2, portrait.ay + 2, { anchor: 'topleft' });
    const st = ws(hud);
    if (st?.worker === w && st.training !== -1) r.sprite('FORMATION', [2, 3, 1][st.training], portrait.ax + 44, portrait.ay + 44, { anchor: 'topleft' });
  };
  const S = () => hud.sim.data.setup;
  const spiritOf = (w) => (ws(hud)?.worker === w ? ws(hud).spirit : w.spirit ?? w.BasicSpirit);
  const effOf = (w) => (ws(hud)?.worker === w ? ws(hud).efficiency : w.BasicProductivity);
  const desc = common(p, hud, [
    ['Gauge01', () => (shown() ? spiritOf(shown()) : 0), 'LB_PANNEL_PEOPLE_GAUGE_MORAL'],
    ['Gauge01', () => (shown() ? effOf(shown()) : 0), 'LB_PANNEL_PEOPLE_GAUGE_EFFICIENCY'],
    ['Gauge00', () => (shown() ? (shown().level * 100) / 4 : 0), 'LB_PANNEL_PEOPLE_GAUGE_LEVEL'],
  ], ['LB_PANNEL_PEOPLE_TEXT_MORAL', 'LB_PANNEL_PEOPLE_TEXT_EFFICIENCY', 'LB_PANNEL_PEOPLE_TEXT_LEVEL'], () => {
    const w = shown();
    if (!w) return '';
    return fmt(ws(hud)?.worker === w ? w.salary : hud.player.hirePrice(w) + offerDelta);
  }, 'LB_PANNEL_PEOPLE_TEXT_CURRENT_SALARY');
  p.add(repeatButton(143, 63, 'Button_LB_Increase', () => {
    const st = ws(hud);
    if (picked && picked !== st?.worker) offerDelta += 50;
    else if (st?.worker) hud.player.raiseSalary(st.index, 50);
  }, { tooltip: 'LB_PANNEL_PEOPLE_BUTTON_INCREASE_SALARY' }));
  // "-" lowers the hiring offer for an applicant, or cuts the employee's pay (the original only did the former,
  // although its tooltip reads "Paycut").
  p.add(repeatButton(156, 63, 'Button_LB_Decrease', () => {
    const st = ws(hud);
    if (picked && picked !== st?.worker) offerDelta = Math.max(0, offerDelta - 50);
    else if (st?.worker) hud.player.raiseSalary(st.index, -50);
  }, { tooltip: 'LB_PANNEL_PEOPLE_BUTTON_DECREASE_SALARY' }));
  // Face grid: current employee first, then the CV list for this workstation.
  const grid = p.add(new IconGrid(229, 16, 210, 78, {
    cols: 5, cellW: 42, cellH: 39,
    drawCell: (r, w, x, y, selected, hover) => {
      // Face sprites: frame 0 empty slot, 1 face, 2 highlighted face.
      r.sprite(faceSprite(w), selected || hover ? 2 : 1, x, y, { anchor: 'topleft' });
      if (w.owner === hud.player.slot) r.sprite('Pastille_couleur', 0, x + 30, y + 2, { anchor: 'topleft' });
      else if (w.owner >= 0) r.sprite('Action_States', 1, x + 30, y + 2, { anchor: 'topleft' });
    },
    tooltipFor: (w) => `${hud.sim.workerName(w)}`,
    onSelect: (w) => { picked = w; offerDelta = 0; describe(); },
  }));
  p.add(new Widget(440, 16, 12, 78)).onDraw = (r) => r.sprite('ScrollBar2_Back', 0, area.ax + 440, area.ay + 16, { anchor: 'topleft' });
  const describe = () => {
    const w = shown();
    if (!w) {
      const st = ws(hud);
      const msg = st && st.deskLevel <= 0 ? 'Buy a desk for this workstation first (Materials).'
        : 'No applicants yet. New CVs arrive every few days; an HR manager finds them faster.';
      desc.setItems(hud.scene.game.r.wrap(LCD, msg, 176));
      return;
    }
    const text = `${hud.sim.workerName(w)} (max ${w.LevelMax}). ${listText(hud.sim.data, 'WorkerList', w.Description)}`;
    desc.setItems(hud.scene.game.r.wrap(LCD, text, 176));
    desc.scroll = 0;
  };
  const btn = (x, sprite, tip, onClick, enabled) => {
    const b = p.add(new Button(x, 100, sprite, { tooltip: tip, onClick }));
    b.onUpdate = function (dt, input) { Button.prototype.onUpdate.call(this, dt, input); this.enabled = enabled(); };
    return b;
  };
  btn(229, 'Button_LB_Engage', 'LB_PANNEL_PEOPLE_ENGAGE', () => {
    const st = ws(hud);
    if (!st || !picked || picked === st.worker) return;
    const price = hud.player.hirePrice(picked);
    if (price < 0) return;
    hud.player.hire(st.index, picked.index, price + offerDelta);
    picked = null;
    offerDelta = 0;
    describe();
  }, () => !!picked && picked !== ws(hud)?.worker && hud.player.hirePrice(picked) >= 0);
  btn(274, 'Button_LB_Dismiss', 'LB_PANNEL_PEOPLE_DISMISS', () => { const st = ws(hud); if (st?.worker) { hud.player.fire(st.index); picked = null; describe(); } }, () => !!ws(hud)?.worker && (!picked || picked === ws(hud).worker));
  const canTrain = (k) => () => {
    const st = ws(hud);
    return !!st?.worker && st.training === -1 && (!picked || picked === st.worker) && (k !== 0 || st.worker.level < st.worker.LevelMax);
  };
  btn(318, 'Button_LB_Moral', 'LB_PANNEL_PEOPLE_FORMATION_MORAL', () => hud.player.startTraining(ws(hud).index, 2), canTrain(2));
  btn(362, 'Button_LB_Level', 'LB_PANNEL_PEOPLE_FORMATION_LEVEL', () => hud.player.startTraining(ws(hud).index, 0), canTrain(0));
  btn(406, 'Button_LB_Efficiency', 'LB_PANNEL_PEOPLE_FORMATION_EFFICIENCY', () => hud.player.startTraining(ws(hud).index, 1), canTrain(1));
  p.onUpdate = () => {
    const st = ws(hud);
    if (!st) return;
    const items = [...(st.worker ? [st.worker] : []), ...st.cv.map((id) => hud.sim.workers[id])];
    if (items.length !== grid.items.length || items.some((x, i) => x !== grid.items[i])) {
      grid.items = items;
      if (picked && !items.includes(picked)) picked = null;
      // With nobody employed here, the first applicant is preselected so "Hire" works straight away.
      if (!picked && !st.worker && items.length) picked = items[0];
      grid.selected = picked ? items.indexOf(picked) : items.length ? 0 : -1;
      for (const w of items) hud.scene.game.assets.loadSprite(faceSprite(w)).catch(() => {});
      describe();
    }
  };
  const faceSprite = (w) => { const R = role(hud); return `${R.face}${R.face === 'Labo_Seeker_Face' ? w.PhotoID % 40 : (w.PhotoID % 10) + 1}`; };
  p.onShow = () => { picked = null; offerDelta = 0; grid.items = []; grid.selected = -1; };
  return p;
}

// ------------------------------------------------------------------------------------------------
// POSTE: purchase options for the ONE thing that was clicked [code 0x42c630 / 0x41bb7e]:
//  * a desk / machine -> the desk models of that workstation (levels 1..3 or 1..4),
//  * a piece of room equipment (safe, TV, door, ...) -> that item's levels 1..3,
//  * a department's building-site sign -> the building upgrades (levels 1..2).
// The four slots are radio buttons, one per level; the chosen one is previewed (icon, gauges, price,
// description) and "Buy" purchases it. Icon frame = level (frame 0 = nothing / broken).

function buildPoste(area, hud) {
  const p = area.add(new Panel(0, 0, 476, 148));
  p.visible = false;
  const co = () => hud.player;
  let choice = -1; // selected option index
  // The thing being upgraded: { kind: 'desk', ws } | { kind: 'object', type, icon }.
  const item = () => {
    const s = hud.scene.selection;
    if (s?.machine) return { kind: 'machine', ...s.machine };
    if (s?.item) return { kind: 'object', ...s.item };
    return s?.ws !== undefined ? { kind: 'desk', ws: s.ws } : null;
  };
  const icon = () => { const it = item(); return it?.kind === 'object' ? it.icon : it?.kind === 'machine' ? `LABO_MACHINE${it.s + 1}_64x64` : ROLE[it?.ws ?? 0].desk; };
  const current = () => {
    const it = item();
    if (!it) return 0;
    if (it.kind === 'machine') return co().machines[it.m] ? 1 : 0;
    return it.kind === 'desk' ? co().workstations[it.ws].deskLevel : co().objects[it.type];
  };
  const options = () => {
    const it = item();
    if (!it) return [];
    // A research machine is a single purchase (icon frame 0 = not owned, 1 = owned) [code 0x42e753].
    if (it.kind === 'machine') {
      const mc = hud.sim.data.techno.machines[it.m];
      return mc ? [{ level: 1, price: mc.Price, name: mc.Name, desc: mc.Description, list: `${hud.sim.data.product}Machines` }] : [];
    }
    if (it.kind === 'desk') return co().desksFor(it.ws).filter((d) => d.Level > 0).map((d) => ({ level: d.Level, price: d.Price, prod: d.ProductivityBasic, name: d.Name, desc: d.Description, list: 'DesktopList' }));
    return hud.sim.data.objects.filter((o) => o.ObjectType === it.type && o.Level > 0).sort((a, b) => a.Level - b.Level)
      .map((o) => ({ level: o.Level, price: o.Price, name: o.Name, desc: o.Description, list: 'ObjectList' }));
  };
  const chosen = () => options()[choice] ?? null;
  const portrait = p.add(new Widget(16, 12, 64, 64));
  portrait.onDraw = (r) => {
    if (!item()) return;
    const o = chosen();
    r.sprite(icon(), Math.min(r.frameCount(icon()) - 1, o ? o.level : current()), portrait.ax, portrait.ay, { anchor: 'topleft' });
  };
  const desc = common(p, hud, [
    ['Gauge01', () => (item()?.kind === 'desk' && current() > 0 ? co().workstations[item().ws].integrity / 100 : 0), 'LB_PANNEL_WORKSTATION_GAUGE_INTEGRITY'],
    ['Gauge01', () => chosen()?.prod ?? 0, 'LB_PANNEL_WORKSTATION_GAUGE_EFFICIENCY'],
    ['Gauge00', () => ((chosen()?.level ?? current()) * 100) / Math.max(1, options().length), 'LB_PANNEL_WORKSTATION_GAUGE_LEVEL'],
  ], ['LB_PANNEL_WORKSTATION_TEXT_INTEGRITY', 'LB_PANNEL_WORKSTATION_TEXT_EFFICIENCY', 'LB_PANNEL_WORKSTATION_TEXT_LEVEL'],
  () => (chosen() && chosen().level > current() ? fmt(chosen().price) : '-'), 'LB_PANNEL_WORKSTATION_TEXT_CURRENT_COST');
  const describe = () => {
    const o = chosen();
    const text = o ? `${listText(hud.sim.data, o.list, o.name)}. ${listText(hud.sim.data, o.list, o.desc)}${o.level <= current() ? ' (owned)' : ''}` : '';
    desc.setItems(hud.scene.game.r.wrap(LCD, text, 176));
    desc.scroll = 0;
  };
  for (let i = 0; i < 4; i++) {
    const s = p.add(new Widget(229 + 56 * i, 26, 56, 60));
    s.onDraw = (r) => {
      const o = options()[i];
      if (!o) return;
      const owned = o.level <= current();
      r.sprite(icon(), Math.min(r.frameCount(icon()) - 1, o.level), s.ax - 4, s.ay - 2, { anchor: 'topleft', selected: i === choice, alpha: owned && i !== choice ? 0.45 : undefined });
    };
    s.onEvent = (ev) => {
      if (ev.type !== 'down' || ev.button !== 0 || !s.contains(ev.x, ev.y) || !options()[i]) return false;
      choice = i;
      hud.scene.game.ui.clicked(s);
      describe();
      return true;
    };
    s.tooltip = () => { const o = options()[i]; return o ? `${listText(hud.sim.data, o.list, o.name)}: ${fmt(o.price)}` : null; };
  }
  const buy = p.add(new Button(310, 100, 'Button_LB_Buy', { tooltip: 'LB_PANNEL_WORKSTATION_BUY', onClick: () => {
    const it = item(), o = chosen();
    if (!it || !o || o.level <= current()) return;
    const ok = it.kind === 'desk' ? co().buyDesk(it.ws, o.level) : it.kind === 'machine' ? co().buyMachine(it.m) : co().buyObject(it.type, o.level);
    if (ok) hud.scene.game.sounds.play('INT_VALIDATE2');
    // A new desk at an empty workstation: go straight to Personnel to hire someone for it.
    if (ok && it.kind === 'desk' && !co().workstations[it.ws].worker) { hud.setMode('perso'); return; }
    choice = Math.min(options().length - 1, o.level); // move on to the next model
    describe();
  } }));
  buy.onUpdate = function (dt, input) {
    Button.prototype.onUpdate.call(this, dt, input);
    const o = chosen();
    this.enabled = !!o && o.level > current();
  };
  p.onShow = () => {
    // Preselect the next model up from what is owned.
    choice = Math.min(options().length - 1, current());
    describe();
  };
  return p;
}

// ------------------------------------------------------------------------------------------------
// ACTION: sliders / point actions / targets, or the tech tree for researchers and the product line for the
// supervisor.

function buildAction(area, hud) {
  const p = area.add(new Panel(0, 0, 476, 148));
  p.visible = false;
  const state = { cat: 0, cell: -1, mode: 'tree', target: -1 };
  const co = () => hud.player;
  // Which component view this panel shows [code 0x41bf44]: researchers research; each technician (workstation
  // 10+i) chooses the component of category i made in-house; the production board buys components from a
  // supplier. The supervisor has no component view, only the production sliders.
  const isBoard = () => !!hud.scene.selection?.board;
  const isSeeker = () => !isBoard() && role(hud).key === 'SEEKER';
  const isDriver = () => !isBoard() && role(hud).key === 'MANUT' && (ws(hud)?.index ?? 0) - 10 < co().tech.length;
  const isChief = () => !isBoard() && role(hud).key === 'MANUT_CHIEF';
  const driverCat = () => (ws(hud)?.index ?? 10) - 10;
  const treeKind = () => (isBoard() ? 'buy' : isSeeker() ? 'research' : isDriver() ? 'make' : null);
  const isTree = () => !!treeKind() && state.mode === 'tree';
  const portrait = p.add(new Widget(16, 12, 64, 64));
  portrait.onDraw = (r) => {
    const R = role(hud);
    if (isTree() && state.cell >= 0) {
      const t = cellComponent(state.cell);
      const icons = techIcons(state.cat);
      if (t && icons) { r.sprite(icons[2], t.comp.Level * 4 + t.comp.Evolution, portrait.ax, portrait.ay, { anchor: 'topleft' }); return; }
    }
    r.sprite(`ICONE_ACTION_${R.key}`, ws(hud)?.worker ? 2 : 0, portrait.ax, portrait.ay, { anchor: 'topleft' });
  };
  const techIcons = (cat) => TECH_ICONS[hud.sim.data.techno.categories[cat]?.file.replace(/\.ini$/i, '')];
  const cellComponent = (i) => {
    const L = i % 4, E = Math.floor(i / 4);
    return co().component(state.cat, L, E);
  };
  const desc = common(p, hud, [
    ['Gauge01', () => (ws(hud)?.worker ? ws(hud).productivity : 0), 'LB_PANNEL_WORKSTATION_GAUGE_EFFICIENCY'],
    // Researchers: progress of the current research [inferred: the original has no caption string for it].
    ['Gauge01', () => (isSeeker() ? researchProgress() : ws(hud)?.worker ? ws(hud).spirit : 0), () => (isSeeker() ? 'Research progress' : hud.t('LB_PANNEL_PEOPLE_GAUGE_MORAL'))],
    ['Gauge00', () => ((ws(hud)?.level ?? 0) * 100) / 4, 'LB_PANNEL_PEOPLE_GAUGE_LEVEL'],
  ], ['LB_PANNEL_PEOPLE_TEXT_EFFICIENCY', () => (isSeeker() ? 'Research' : hud.t('LB_PANNEL_PEOPLE_TEXT_MORAL')), 'LB_PANNEL_PEOPLE_TEXT_LEVEL'], () => {
    if (isTree()) { const t = cellComponent(state.cell); return t ? fmt(t.comp.Price * (treeKind() === 'buy' ? hud.sim.data.setup.PROVIDER_PRICE_MULTIPLICATOR : 1)) : ''; }
    if (isChief()) return `${co().target}`;
    return '';
  }, 'LB_PANNEL_ACTION_LISTBOX_DESC');
  const researchProgress = () => {
    const r = co().research[ws(hud)?.index];
    if (!r) return 0;
    const t = co().component(r.cat, r.L, r.E);
    return t ? (100 * t.progress) / (t.comp.SearchNeeded * hud.sim.data.setup.AMOUNT_OF_WORK_PER_DAY) : 0;
  };
  const describe = (text) => { desc.setItems(hud.scene.game.r.wrap(LCD, text ?? '', 176)); desc.scroll = 0; };

  // Category filter toggles (x=226) and the timetable toggle (supervisor only).
  const filters = [0, 1, 2, 3].map((i) => {
    const b = p.add(new Button(226, 16 + i * 23.5, 'Button_LB_Filter_Disabled', { w: 39, h: 23, toggle: true, tooltip: 'LB_PANNEL_ACTION_BUTTON_COMPONENT',
      onClick: () => { state.cat = i; state.cell = -1; state.mode = 'tree'; } }));
    b.onUpdate = function (dt, input) {
      Button.prototype.onUpdate.call(this, dt, input);
      const icons = techIcons(i);
      this.visible = !!treeKind() && !!icons && (treeKind() !== 'make' || i === driverCat());
      this.sprite = icons?.[3] ?? 'Button_LB_Filter_Disabled';
      this.checked = state.mode === 'tree' && state.cat === i;
    };
    b.selfVisible = true;
    return b;
  });
  void filters;
  const regulating = p.add(new Button(226, 109, 'Button_LB_Filter_Regulating', { toggle: true, tooltip: 'LB_PANNEL_ACTION_BUTTON_REGULATING', onClick: () => { state.mode = 'regulate'; } }));
  regulating.onUpdate = function (dt, input) { Button.prototype.onUpdate.call(this, dt, input); this.visible = isDriver(); this.checked = state.mode === 'regulate'; };
  regulating.selfVisible = true;

  // Tech tree grid: columns = level (technics), rows = evolution (design).
  const tree = p.add(new IconGrid(270, 17, 156, 117, {
    cols: 4, cellW: 39, cellH: 39,
    drawCell: (r, i, x, y, selected) => {
      const t = cellComponent(i);
      const icons = techIcons(state.cat);
      if (!t || !icons) return;
      const frame = t.comp.Level * 4 + t.comp.Evolution;
      const inLine = co().line[state.cat]?.L === t.comp.Level && co().line[state.cat]?.E === t.comp.Evolution;
      const researching = Object.values(co().research).some((x) => x.cat === state.cat && x.L === t.comp.Level && x.E === t.comp.Evolution);
      const name = t.state === 3 || researching || inLine ? icons[1] : icons[0];
      r.sprite(name, frame, x, y, { anchor: 'topleft', alpha: t.state === 0 ? 0.35 : 1, selected });
      if (t.state === 3) r.rect(x + 1, y + 33, 6, 4, '#20ff40');
      if (researching) r.rect(x + 1, y + 33, Math.round((36 * t.progress) / (t.comp.SearchNeeded * 1000)), 4, '#ffd020');
    },
    tooltipFor: (i) => { const t = cellComponent(i); return t ? componentName(t) : null; },
    onSelect: (i) => {
      state.cell = i;
      const t = cellComponent(i);
      if (!t) return;
      const owner = hud.sim.patentOwner(state.cat, t.comp.Level, t.comp.Evolution);
      const status = ['Locked', 'Available', 'Being researched', 'Researched'][t.state];
      describe(`${componentName(t)}: ${listText(hud.sim.data, hud.sim.data.techno.categories[state.cat].file.replace(/\.ini$/i, ''), t.comp.Description)} [${status}${owner >= 0 ? `, patent: ${hud.sim.companies[owner]?.name}` : ''}]${t.state === 0 ? missingFor(t) : levelNote(t)}`);
    },
  }));
  tree.items = [...Array(12).keys()];
  // What still blocks a locked component [C 0x455af0]: the previous step in its column, a lab research machine,
  // and/or a component from another category.
  // Research / production of a level-L component needs workstation level L+1 = min(desk level, employee level).
  const levelNote = (t) => {
    const st = ws(hud), kind = treeKind();
    if (!st?.worker || kind === 'buy' || (kind === 'research' && t.state === 3)) return '';
    const need = t.comp.Level + 1;
    if (st.level >= need) return '';
    const w = st.worker;
    const who = kind === 'research' ? 'researcher' : 'technician';
    const fix = [];
    if (w.level < need) fix.push(w.LevelMax < need ? `this ${who} can only reach level ${w.LevelMax}, so hire a better one` : `train the ${who} (now level ${w.level})`);
    if (st.deskLevel < need) fix.push(`upgrade the ${kind === 'research' ? 'bench' : 'machine'} (now level ${st.deskLevel})`);
    return ` Needs level ${need}: ${fix.join(' and ')}.`;
  };
  const missingFor = (t) => {
    const d = hud.sim.data, c = co();
    const { Level: L, Evolution: E } = t.comp;
    const need = [];
    const prev = E > 0 ? c.component(state.cat, L, E - 1) : L > 0 ? c.component(state.cat, L - 1, 0) : null;
    if (prev && prev.state !== 3) need.push(`research ${componentName(prev)} first`);
    const m = t.comp.RequiredMachine;
    if (m !== -1 && !c.machines[m]) {
      const mc = d.techno.machines[m];
      need.push(`buy the lab machine "${mc ? listText(d, `${d.product}Machines`, mc.Name) : m}"`);
    }
    const rc = t.comp.RequiredComponent;
    if (rc !== -1) {
      const r = c.component(rc, t.comp.RequiredLevel, t.comp.RequiredEvolution);
      if (r && r.state !== 3) need.push(`research ${listText(d, d.techno.categories[rc].file.replace(/\.ini$/i, ''), r.comp.Name)} (${d.techno.categories[rc].file.replace(/\.ini$/i, '').replace(/^(Toilet|Roller|Robot)/, '').toLowerCase()}, level ${r.comp.Level + 1})`);
    }
    return need.length ? ` To unlock: ${need.join('; ')}.` : '';
  };
  const componentName = (t) => listText(hud.sim.data, hud.sim.data.techno.categories[state.cat].file.replace(/\.ini$/i, ''), t.comp.Name);
  tree.onUpdate = function (dt, input) {
    IconGrid.prototype.onUpdate.call(this, dt, input);
    this.visible = isTree();
  };
  tree.selfVisible = true;
  p.add(new TextField(270, 4, 156, 12, () => (isTree() ? `${hud.t('LB_ACTION_TECHNO_TREE_TEXT1')} >  ${hud.t('LB_ACTION_TECHNO_TREE_TEXT2')} v` : ''), { font: GRID_FONT }));

  // Validate: start research (researchers) / choose component for the line (supervisor).
  const validate = p.add(new Button(427, 17, 'Button_LB_ValidateCompo', { tooltip: () => ({ research: 'LB_PANNEL_ACTION_BUTTON_VALIDATE', make: 'Make this component in-house', buy: 'Buy this component from a supplier (price x2)' })[treeKind()], onClick: () => {
    const t = cellComponent(state.cell);
    const st = ws(hud);
    if (!t || !st) return;
    const kind = treeKind();
    if (kind === 'research') {
      if (co().research[st.index]) co().stopResearch(st.index);
      if (!co().startResearch(st.index, state.cat, t.comp.Level, t.comp.Evolution)) describe('This component cannot be researched here (check the researcher and bench level).');
      else { hud.scene.game.sounds.play('INT_VALIDATE2'); describe(`Researching ${componentName(t)}. Progress shows on the blackboard above the bench.`); }
    } else if (kind === 'make' || kind === 'buy') {
      if (!co().setLine(state.cat, t.comp.Level, t.comp.Evolution, kind === 'make' ? -1 : 0)) { describe('Only researched components can be produced.'); return; }
      hud.scene.game.sounds.play('INT_VALIDATE2');
      describe(`${componentName(t)} ${kind === 'make' ? 'will be made in-house by this technician' : 'will be bought from a supplier (price x2)'}. ${co().hasProduct ? 'The product is complete: set the output on the supervisor\'s controls.' : 'Choose a component for every category to complete the product.'}`);
    }
  } }));
  validate.selfVisible = true;
  validate.onUpdate = function (dt, input) {
    Button.prototype.onUpdate.call(this, dt, input);
    this.visible = isTree();
    const t = cellComponent(state.cell);
    const kind = treeKind();
    this.enabled = !!t && (kind === 'buy' ? t.state === 3
      : !!ws(hud)?.worker && (kind === 'research' ? (t.state === 1 || t.state === 2) && t.comp.Level + 1 <= ws(hud).level : t.state === 3 && t.comp.Level < ws(hud).level));
  };

  // Bar sliders (time shares) for the other jobs; the supervisor's "timetable" shows the production target.
  const sliders = [0, 1, 2].map((i) => {
    const y = [34, 57, 81][i];
    const g = p.add(new Gauge(270, y, 85, 6, 'Gauge03', { value: () => sliderValue(i) }));
    const s = p.add(new Widget(270, y - 3, 85, 12));
    s.onEvent = (ev) => {
      if (ev.type === 'down' && ev.button === 0 && s.contains(ev.x, ev.y)) { s.dragging = true; setSlider(i, (ev.x - s.ax) / 85); return true; }
      if (ev.type === 'up' && s.dragging) { s.dragging = false; return true; }
      return false;
    };
    s.onUpdate = (dt, input) => { if (s.dragging) setSlider(i, (input.x - s.ax) / 85); };
    s.onDraw = (r) => r.sprite('Gauge04_ButtonSlide', 2, s.ax + (sliderValue(i) / 100) * 85 - 5, s.ay + 3, { anchor: 'topleft' });
    const cap = p.add(new TextField(360, y - 3, 100, 17, () => sliderCaption(i), { font: A, tooltip: () => sliderHint(i) }));
    for (const w of [g, s, cap]) w.visibleFn = () => sliderVisible(i);
    return { g, s, cap };
  });
  const sliderKey = () => SLIDER_TEXT[role(hud).key];
  const sliderCount = () => (isChief() ? 3 : ws(hud)?.bars.length ?? 0);
  const sliderVisible = (i) => !!ws(hud) && !isSeeker() && !isBoard() && (!isDriver() || state.mode === 'regulate') && i < sliderCount();
  const sliderValue = (i) => {
    const st = ws(hud);
    if (!st) return 0;
    if (isChief()) return i === 0 ? (100 * co().target) / hud.sim.data.setup.MAX_PRODUCTION_BAR_VALUE : Math.min(100, st.bars[i - 1]?.effective ?? 0);
    return st.bars[i]?.effective ?? 0;
  };
  const setSlider = (i, f) => {
    const st = ws(hud);
    f = Math.max(0, Math.min(1, f));
    if (isChief()) {
      if (i === 0) { co().target = Math.round(f * hud.sim.data.setup.MAX_PRODUCTION_BAR_VALUE); describe(chiefHint()); }
      return; // assembly / servicing bars are automatic for production workstations
    }
    if (isDriver()) return;
    if (st?.bars[i]) st.setBar(i, f * 100);
  };
  // What the supervisor still needs before the line can run.
  const chiefHint = () => {
    const cats = hud.sim.data.techno.categories;
    const missing = co().tech.map((_, c) => c).filter((c) => !co().line[c]).map((c) => cats[c].file.replace(/\.ini$/i, '').replace(/^(Toilet|Roller|Robot)/, '').toLowerCase());
    if (missing.length) return `Production can't start: no component chosen for ${missing.join(', ')}. Choose one at each technician (make) or at the production board (buy).`;
    if (ws(hud)?.broken) return 'The main machine is broken and must be repaired.';
    if (co().target <= 0) return 'The product is complete. Raise the first slider to start production.';
    return `Producing ${co().target} units per day.`;
  };
  const sliderCaption = (i) => (sliderKey() ? hud.t(`LB_ACTION_${sliderKey()}_TEXT${i + 1}`) : '');
  const sliderHint = (i) => (sliderKey() ? `LB_ACTION_${sliderKey()}_TEXT${i + 1}_HINT` : null);
  for (const sl of sliders) for (const w of [sl.g, sl.s, sl.cap]) {
    const upd = w.onUpdate?.bind(w);
    w.onUpdate = (dt, input) => { w.visible = w.visibleFn(); upd?.(dt, input); };
    w.selfVisible = true;
  }

  // Point (one-off) actions.
  const points = [0, 1, 2, 3].map((i) => {
    const b = p.add(new Button(270 + 45 * i, 94, 'Action_Repair', { w: 38, h: 38, onClick: () => {
      const id = role(hud).points[i];
      const st = ws(hud);
      if (!st) return;
      if (TARGETED.has(id)) {
        if (state.target < 0) { describe('Choose a target company first.'); return; }
        co().pendingParams = { target: state.target };
      }
      if (!st.launchButton(id)) describe('This action is not available (check the employee level, or it is already running).');
      else describe(`${hud.t(POINT_SPRITE[id][1])} - in progress.`);
    } }));
    b.onUpdate = function (dt, input) {
      Button.prototype.onUpdate.call(this, dt, input);
      const id = role(hud).points[i];
      const st = ws(hud);
      this.visible = id !== undefined && !isTree() && !isBoard();
      if (!this.visible) return;
      this.sprite = POINT_SPRITE[id][0];
      const need = st ? st.action(id).LevelRequired ?? 1 : 1;
      this.tooltip = st?.worker && st.level < need ? `${hud.t(POINT_SPRITE[id][1])} (needs level ${need}: employee and desk)` : POINT_SPRITE[id][1];
      const btn = st?.buttons.find((x) => x.id === id);
      this.enabled = !!st?.worker && !!btn && !btn.done && st.canLaunch(id);
      this.toggle = true;
      this.checked = !!btn?.active;
    };
    b.selfVisible = true;
    return b;
  });
  void points;
  // Competitor targets (logos) for lawyer / spy / mafioso.
  const targets = p.add(new IconGrid(270, 17, 156, 39, {
    cols: 4, cellW: 39, cellH: 39,
    drawCell: (r, c, x, y, selected) => r.sprite('LOGOS', c.slot, x, y, { anchor: 'topleft', selected }),
    tooltipFor: (c) => c.name,
    onSelect: (c) => { state.target = c.slot; describe(`Target: ${c.name}`); },
  }));
  targets.selfVisible = true;
  targets.onUpdate = function (dt, input) {
    IconGrid.prototype.onUpdate.call(this, dt, input);
    const R = role(hud);
    this.visible = R.points.some((id) => TARGETED.has(id));
    this.items = hud.sim.alive.filter((c) => c !== co());
    this.selected = this.items.findIndex((c) => c.slot === state.target);
  };
  p.onShow = () => {
    state.cell = -1;
    state.mode = treeKind() ? 'tree' : 'regulate';
    state.target = -1;
    const st = ws(hud);
    const r = st && co().research[st.index];
    if (r) { state.cat = r.cat; state.cell = r.E * 4 + r.L; }
    else if (isSeeker() && st.worker) {
      // Nothing under way: preselect the first component this researcher can start, so Validate is ready.
      for (let cat = 0; cat < co().tech.length && state.cell < 0; cat++) {
        for (let i = 0; i < 12; i++) {
          const t = co().component(cat, i % 4, Math.floor(i / 4));
          if (t?.state === 1 && t.comp.Level + 1 <= st.level) { state.cat = cat; state.cell = i; break; }
        }
      }
    }
    if (isDriver()) {
      // A technician manufactures one category: show its tree with the current choice selected.
      state.cat = driverCat();
      const l = co().line[state.cat];
      if (l) state.cell = l.E * 4 + l.L;
    }
    if (isBoard() && state.cat >= co().tech.length) state.cat = 0;
    const hint = {
      make: 'Pick a researched component and validate to make it here.',
      buy: 'Pick a researched component and validate to buy it from a supplier.',
    }[treeKind()];
    const none = (treeKind() === 'buy' || treeKind() === 'make') && !co().tech.some((c) => c.some((t) => t?.state === 3));
    if (none) { describe('No component has been researched yet. Hire a researcher in the lab and start a research there first; researched components can then be made or bought here.'); return; }
    const pts = st?.worker ? role(hud).points.filter((id) => st.level < (st.action(id).LevelRequired ?? 1)) : [];
    const lvlHint = pts.length ? ` Point actions need a level ${Math.max(...pts.map((id) => st.action(id).LevelRequired))} employee and desk (train the employee and upgrade the desk).` : '';
    if (!treeKind() && !isChief() && st?.worker) {
      const targeted = role(hud).points.some((id) => TARGETED.has(id));
      const lead = st.bars.length ? 'Use the sliders to share this employee\'s time.' : targeted ? 'Pick a rival company, then an action against it.' : 'Choose an action.';
      describe(`${st.bars.length && targeted ? `${lead} Pick a rival company before an action against it.` : lead}${lvlHint}`);
      return;
    }
    describe(isBoard() ? hint : !st?.worker ? 'No employee at this workstation.' : isChief() ? chiefHint() : hint ?? '');
  };
  return p;
}
