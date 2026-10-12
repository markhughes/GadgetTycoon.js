// The game world: the player's factory compound (Back01, "inside") and the city (Back02, "outside").
// Rebuilt from the original's department builders (docs/presentation.md §3):
//  * objects sit at SetupLevel.ini POSITION_X/Y, which is the sprite hotspot;
//  * draw order is a fixed layer number, then creation order (no y-sort); PRIORITY only breaks click ties;
//  * the sprite of each object is chosen from company state every frame (equipment level, worker level/activity...).
// Sprite choices tagged [inferred] in comments are educated guesses where the builder code was not traced.
import { AnimClock } from './anim.js';
import { CURSOR } from '../engine/game.js';

export const VIEW_Y = 30;
export const VIEW_H = 422; // 600 - 30 upper bar - 148 lower bar
export const VIEW_W = 800;

const INSIDE = { image: 'Back01', w: 2500, h: 1325 };

// Building upgrades are painted into the factory background (not separate objects): level 1/2 of each
// department's walls blits Upgrade_<Dept>1/2 at a fixed position [code 0x465c80, 0x4676d0, 0x469cd0, 0x4718d0].
// 38x38 tech-tree icon sets per product category file (frame = level * 4 + evolution).
const TECH_ICON_SETS = {
  ToiletSeat: 'WC_Bowl1', ToiletFlush: 'WC_Flush1', ToiletExtras: 'WC_Brush1',
  RollerFoot: 'ROLLERS_Shoes1', RollerMovement: 'ROLLERS_Wheels1', RollerHelmet: 'ROLLERS_Helmet1',
  RobotHead: 'ROBOT_Radar1', RobotIntelligence: 'ROBOT_Brain1', RobotMovement: 'ROBOT_Leg1', RobotArm: 'ROBOT_Arm1',
};

// Voice set per workstation for employee clicks [code 0x463804: object types 71 RH, 74 COMPTABLE (the financier's
// group), 77 JURISTE (the lawyer at the comptable desk)].
const WORKER_VOICE = ['JURISTE', 'COMPTABLE', 'RH', 'PUBLICITAIRE', 'COMMERCIAL', 'CHERCHEUSE', 'CHERCHEUSE', 'CHERCHEUSE', 'CHERCHEUSE',
  'CONTREMAITRE', 'OUVRIER', 'OUVRIER', 'OUVRIER', 'OUVRIER', 'GARDIEN', 'ESPION', 'MAFIEUX'];

export const BUILDING_OVERLAYS = [
  { dept: 'PROD', sprite: 'Upgrade_Production', x: 0, y: 0 },
  { dept: 'LABO', sprite: 'Upgrade_Laboratory', x: 1551, y: 0 },
  { dept: 'ADMIN', sprite: 'Upgrade_Administration', x: 829, y: 648 },
  { dept: 'MARKETING', sprite: 'Upgrade_Marketing', x: 1796, y: 692 },
];
const OUTSIDE = { image: 'Back02', w: 1600, h: 900 };

// Camera jump points (news "recenter", F5-F10) [code 0x43386a].
export const RECENTER = [[1100, 827], [1200, 1011], [1200, 928], [1960, 890], [2200, 950], [2140, 220], [2220, 310], [2000, 290],
  [2170, 380], [420, 600], [625, 525], [760, 460], [900, 380], [1040, 320], [0, 1060], [50, 0], [200, 0]];

// Ambient loops: emitter positions in world pixels [code 0x4627cd].
const AMBIENT = [
  { id: 'PRODUCTION_AMBIANCE', x: 700, y: 600, inside: true, when: (w) => w.company.production.running },
  { id: 'ADMINISTRATION_AMBIANCE', x: 1360, y: 1130, inside: true },
  { id: 'MARKETING_AMBIANCE', x: 2115, y: 1120, inside: true },
  { id: 'LABO_AMBIANCE', x: 2050, y: 525, inside: true },
  { id: 'EXTERIOR_AMBIANCE1', x: 480, y: 280, inside: false },
  { id: 'EXTERIOR_AMBIANCE0', x: 1300, y: 700, inside: false },
];

class WorldObject {
  constructor(world, section, opts) {
    const s = world.setup[section] ?? {};
    this.section = section;
    this.x = opts.x ?? s.POSITION_X ?? 0;
    this.y = opts.y ?? s.POSITION_Y ?? 0;
    this.priority = s.PRIORITY ?? 50;
    this.layer = opts.layer;
    this.inside = opts.inside ?? true;
    this.sprite = opts.sprite; // () => [name, frameOrNull] | name | null ; null frame = animate
    this.visible = opts.visible ?? (() => true);
    this.target = opts.target ?? null; // what clicking selects
    this.cursor = opts.cursor ?? (this.target ? CURSOR.FURNITURE : null);
    this.sound = opts.sound ?? null;
    this.clock = new AnimClock({ start: performance.now() - Math.random() * 1000, ...(opts.clock ?? {}) });
    this.lastSprite = null;
    this.restartOnChange = opts.restartOnChange ?? false;
    this.onChange = opts.onChange;
    this.polygon = null;
    this.hitRect = opts.hitRect ?? null; // () => world rect clickable even when nothing is drawn
    if (s.SELECT_X0 || s.SELECT_X1) {
      this.polygon = [0, 1, 2, 3].map((i) => [s[`SELECT_X${i}`], s[`SELECT_Y${i}`]]);
    }
  }

  resolve(world) {
    if (!this.visible(world)) return null;
    let v = typeof this.sprite === 'function' ? this.sprite(world) : this.sprite;
    if (!v) return null;
    if (typeof v === 'string') v = [v, null];
    if (v[0] !== this.lastSprite) {
      if (this.lastSprite !== null && this.restartOnChange) this.clock.restart(performance.now());
      this.onChange?.(this, v[0]);
      this.lastSprite = v[0];
    }
    return v;
  }
}

export class World {
  // scene: in-game scene; data: level data; sim: Simulation; company: the player's company.
  constructor(scene, data, setupLevel) {
    this.scene = scene;
    this.game = scene.game;
    this.data = data;
    this.setup = setupLevel; // { SECTION: { POSITION_X, ... } }
    this.inside = true;
    this.cam = { x: 900, y: 600 };
    this.saved = { inside: { x: 900, y: 600 }, outside: { x: 0, y: 0 } };
    this.objects = [];
    this.hover = null;
    this.edgeAcc = 0;
    this.keyAcc = 0;
    this.extras = { porsche: false, lemmings: [] };
    this.build();
    this.clampCamera();
  }

  get sim() { return this.scene.sim; }
  get company() { return this.scene.sim.player; }
  get bg() { return this.inside ? INSIDE : OUTSIDE; }

  // ------------------------------------------------------------------------------------------------
  // Construction

  add(section, opts) {
    if (!this.setup[section] && opts.x === undefined) return null;
    const o = new WorldObject(this, section, opts);
    this.objects.push(o);
    return o;
  }

  build() {
    this.buildOutsideCompound();
    this.buildProduction();
    this.buildLabo();
    this.buildMarketing();
    this.buildAdmin();
    this.buildExterior();
    // Stable sort: layer, then creation order.
    this.objects.forEach((o, i) => { o.order = i; });
    this.objects.sort((a, b) => a.layer - b.layer || a.order - b.order);
  }

  // A workstation's character: base "<Role>1<Activity>" + (level-1) [code 0x466549].
  character(section, layer, ws, role, maxLevel, opts = {}) {
    return this.add(section, {
      layer,
      sprite: () => {
        const st = this.company.workstation(ws);
        if (!st.worker) return null;
        const lvl = Math.max(1, Math.min(maxLevel, st.worker.level));
        let act = st.activity;
        if (!this.game.assets.hasSprite(`${role}${lvl}${act}`)) act = 'Work';
        return [`${role}${lvl}${act}`, null];
      },
      target: { type: 'workstation', ws },
      cursor: CURSOR.EMPLOYEE,
      // Clicking an employee plays one of their two voice lines [code 0x4788cf -> 0x463804].
      sound: () => `VOICE_${WORKER_VOICE[ws]}${1 + Math.floor(Math.random() * 2)}`,
      restartOnChange: true,
      // On every activity change the original sets a random speed of 9..12 fps; work-type animations then hold
      // their last frame for a pause of rand%2000 ms between loops (fixed until the next change), while idle
      // ("Mooch") animations loop without a pause [code 0x466549, 0x4666d5, 0x48c244].
      onChange: (obj, name) => {
        obj.clock.fps = 9 + Math.floor(Math.random() * 4);
        obj.clock.pauseMs = /Mooch$/.test(name) ? 0 : Math.random() * 2000;
        obj.clock.restart(performance.now() - Math.random() * 1500); // desynchronise identical workers
      },
      ...opts,
    });
  }

  // Desk / workstation equipment: sprite base + desk level; variant 0 is the empty / derelict desk, so
  // workstations stay clickable before anything is bought.
  desk(section, layer, ws, base, opts = {}) {
    return this.add(section, {
      layer,
      sprite: () => {
        const lvl = this.company.workstation(ws).deskLevel;
        const i = Math.max(0, Math.min(opts.max ?? 3, lvl));
        return [`${base}${i}${opts.suffix ?? ''}`, opts.frame ?? null];
      },
      target: { type: 'workstation', ws },
      ...opts,
    });
  }

  // Department equipment (ObjectList objects: ALARM / EFFICIENT / SPIRIT) by level 0..3.
  equipment(section, layer, dept, kind, base, suffix = '', sound = null) {
    return this.add(section, {
      layer,
      sprite: () => [`${base}${Math.min(3, this.company.objectLevel(dept, kind))}${suffix}`, null],
      target: { type: 'equipment', dept, kind },
      sound: () => sound && `${sound}${Math.min(3, this.company.objectLevel(dept, kind))}`,
    });
  }

  // Building-site signs: clicking one offers that department's building upgrades (object ids 0x37/0x46/
  // 0x53/0x71 -> *_UPGRADE64x64 in the workstation panel [code 0x42e92e]). Shown until fully upgraded.
  chantier(section, layer, dept, n) {
    this.add(section, {
      layer,
      sprite: () => (this.company.construction?.[dept] || this.company.wallLevel(dept) < this.company.maxObjectLevel(['MARKETING', 'ADMIN', 'LABO', 'PROD'].indexOf(dept) * 4) ? `Chantier${n}` : null),
      target: { type: 'equipment', dept, kind: 'WALL' },
      sound: 'CONSTRUCTION',
    });
  }

  buildOutsideCompound() {
    // Layer 1: mafioso and spy, top-left of the compound. Workstations 15 = spy, 16 = mafiosi, 14 = guardian.
    this.desk('OUT_BUREAU_MAFIEU', 1, 16, 'Outside_Workstation', { sound: 'OUTO_MAFIEU0' });
    this.add('OUT_BUREAU_MAFIEU_CLICK', { layer: 1, sprite: () => (this.company.workstation(16).deskLevel > 0 ? 'Outside_Click' : null), target: { type: 'workstation', ws: 16 }, sound: 'OUT_MAFIEU_CLICK' });
    this.character('OUT_MAFIEU', 1, 16, 'OutsideMafieu', 3);
    this.add('OUT_GRILL', { layer: 1, sprite: () => `Outside_GrillageFond${Math.max(1, Math.min(3, this.company.wallLevel('OUTSIDE') + 1))}` }); // [inferred]
    this.desk('OUT_BUREAU_SPY', 1, 15, 'Outside_SpyCar', { sound: 'OUTO_VOITURE0' });
    this.character('OUT_SPY', 1, 15, 'OutsideSpy', 3);
    this.add('OUT_SPY_BOMB', { layer: 1, sprite: () => (this.company.flags?.bomb ? 'Outside_Bomb' : null) });
    // Layer 16: guard house.
    this.desk('OUT_BUREAU_GUERITE', 16, 14, 'Outside_Guerite', { sound: 'OUTO_GUARDIAN0' });
    this.add('OUT_GUERITE_DOG', { layer: 16, sprite: () => (this.company.workstation(14).worker ? ['Outside_Dog', null] : null), target: { type: 'dog' }, sound: 'OUTO_DOG0' });
    this.character('OUT_GUERITE', 16, 14, 'OutsideGuardian', 3);
  }

  buildProduction() {
    const p = () => this.company.production;
    const prod = this.data.productInfo;
    for (let i = 0; i < 4; i++) {
      const o = this.add(`PRODUCTION_CURTAIN${i}`, {
        layer: 2,
        sprite: () => [p().running ? 'CurtainOpen' : 'CurtainClose', null],
        clock: { loop: false },
        restartOnChange: true,
        target: { type: 'workstation', ws: 9 },
        onChange: (obj, name) => { if (obj.lastSprite) this.game.sounds.play(name === 'CurtainOpen' ? 'PRODUCTION_CURTAIN_OPEN' : 'PRODUCTION_CURTAIN_CLOSE'); },
      });
      if (o) o.polygonClick = true;
    }
    for (let i = 0; i < 4; i++) this.add(`PRODUCTION_FALLING_BOX${i}`, { layer: 3, sprite: () => (p().running && this.company.workstation(10 + i).worker ? ['FallingBox00', null] : null) });
    this.equipment('PRODUCTION_AIR_CONDITIONING0', 3, 'PROD', 'EFFICIENT', 'Prod_AirConditioning', '', 'PRODUCTION_EQUIPMENT_AIR_CONDITIONING');
    this.equipment('PRODUCTION_AIR_CONDITIONING1', 3, 'PROD', 'EFFICIENT', 'Prod_AirConditioning', '', 'PRODUCTION_EQUIPMENT_AIR_CONDITIONING');
    this.equipment('PRODUCTION_PHARMACY', 3, 'PROD', 'SPIRIT', 'Prod_Pharmacy', '', 'PRODUCTION_EQUIPMENT_PHARMACY');
    this.equipment('PRODUCTION_SECURITY', 3, 'PROD', 'ALARM', 'Prod_Security', '', 'PRODUCTION_EQUIPMENT_SECURITY');
    for (let i = 0; i < 14; i++) this.add(`PRODUCTION_CARPET_BOX${i}`, { layer: 4, sprite: () => (p().running ? ['BoxAnim', null] : null), clock: { start: performance.now() - i * 100 } });
    const signs = [0, 1, 2, 4];
    for (let i = 0; i < 4; i++) {
      this.add(`PRODUCTION_MACHINE_SIGN${i}`, { layer: 4, sprite: () => (this.company.workstation(10 + i).deskLevel > 0 ? `Production_Sign${prod.sign}_${signs[i]}` : null) });
    }
    this.add('PRODUCTION_BIG_MACHINE_EXIT', { layer: 4, sprite: () => ['BigMachineExit', p().running ? null : 0] });
    // Machines: one per driver workstation 10..13; the desk level is the machine model.
    for (let i = 0; i < 4; i++) {
      const ws = 10 + i;
      this.add(`PRODUCTION_MACHINE${i}`, {
        layer: 5,
        // [code 0x46fc97, 0x4622f9]: no machine -> the bay's own base (Machine0_01..04); broken or under repair
        // -> the out-of-order Machine<L>_Out; otherwise Machine<L>, animated while it is producing.
        sprite: () => {
          const st = this.company.workstation(ws);
          if (st.deskLevel <= 0) return [`Machine0_0${i + 1}`, 0];
          const m = Math.min(3, st.deskLevel - 1);
          if (st.broken || st.activity === 'Repair') return [`Machine${m}_Out`, 0];
          return [`Machine${m}`, p().running && st.worker && st.activity === 'Work' ? null : 0];
        },
        target: { type: 'workstation', ws },
        sound: () => `PRODUCTION_MACHINE${Math.min(4, this.company.workstation(ws).deskLevel)}`,
      });
      // Smoke and flames warn that a machine is worn out (integrity < 35%) before it breaks [code 0x4623f2].
      this.add(`PRODUCTION_MACHINE${i}_BURN`, { layer: 5, sprite: () => (this.overheating(ws) ? ['Machine_Burn', null] : null), target: { type: 'workstation', ws }, cursor: CURSOR.REPAIR });
    }
    this.add('PRODUCTION_BIG_MACHINE_BACK', { layer: 5, sprite: 'BigMachineBack', target: { type: 'workstation', ws: 9 } });
    this.add('PRODUCTION_BIG_MACHINE_ENTER', { layer: 5, sprite: () => ['BigMachineEnter', p().running ? null : 0] });
    this.add('PRODUCTION_BIG_MACHINE_GEAR', { layer: 5, sprite: () => ['BigMachineGear', p().running ? null : 0] });
    this.add('PRODUCTION_BIG_MACHINE_SPEED', { layer: 5, sprite: () => ['BigMachineSpeed', Math.max(0, Math.min(9, Math.round(p().speed * 9)))] });
    this.add('PRODUCTION_BIG_MACHINE_BURN', { layer: 5, sprite: () => (this.overheating(9) ? ['Machine_Burn', null] : null), target: { type: 'workstation', ws: 9 }, cursor: CURSOR.REPAIR });
    this.add('PRODUCTION_MACHINE_CONTROL', {
      layer: 5,
      sprite: () => {
        const lvl = this.company.workstation(9).deskLevel;
        return lvl > 0 ? [`Prod_MachineControl${Math.min(4, lvl)}`, 0] : ['Prod_MachineControl00', 0];
      },
      target: { type: 'workstation', ws: 9 },
      sound: () => `PRODUCTION_MACHINE_CONTROL${Math.min(4, this.company.workstation(9).deskLevel)}`,
    });
    this.add('PRODUCTION_BOARD', { layer: 5, sprite: prod.board, target: { type: 'board' } }); // product blueprint: buy components
    // The four corners of the board show the icon of each category's chosen component; the slot of each
    // category depends on the product (toilet / rollers / robot) [code 0x476c3b..0x476d5f, objects 0x47140f].
    const product = /^Toilet/.test(this.data.techno.categories[0]?.file) ? 0 : /^Roller/.test(this.data.techno.categories[0]?.file) ? 1 : 2;
    const slotOf = [[2, 0, 1, 3], [2, 1, 0, 3], [0, 2, 3, 1]][product];
    for (let slot = 0; slot < 4; slot++) {
      this.add(`PRODUCTION_BOARD_OBJECT${slot}`, {
        layer: 5,
        sprite: () => {
          const cat = slotOf.indexOf(slot);
          const l = this.company.line[cat];
          const icons = l && TECH_ICON_SETS[this.data.techno.categories[cat]?.file.replace(/\.ini$/i, '')];
          return icons ? [icons, l.L * 4 + l.E] : null;
        },
        target: { type: 'board' },
      });
    }
    this.add('PRODUCTION_MANUT_TOOL_CASE', { layer: 5, sprite: () => (this.company.workstation(9).worker ? 'Prod_ManutAction' : null), target: { type: 'workstation', ws: 9 }, sound: 'PRODUCTION_CLIC_ON_KEY' });
    this.add('PRODUCTION_MANUT_BOMB', { layer: 5, sprite: () => (this.company.flags?.sabotaged ? ['Prod_Bomb', null] : null) });
    for (let i = 0; i < 4; i++) this.character(`PRODUCTION_TECHNICIAN${i}`, 7, 10 + i, 'ProductionManutBlanc', 4);
    this.character('PRODUCTION_MANUT_CONTROL', 7, 9, 'ProductionManutChiefBlack', 4);
    this.chantier('CHANTIER01', 7, 'PROD', 1);
    this.add('PRODUCTION_BEAM', { layer: 8, sprite: () => { const l = this.company.wallLevel('PROD'); return l > 0 ? `Prod_Beam${Math.min(3, l)}` : null; } }); // [inferred]
    this.add('PRODUCTION_STOCKS', { layer: 8, sprite: () => [prod.stocks, this.company.stockFrame()], target: { type: 'stock' }, sound: 'PRODUCTION_STOCKS' });
  }

  buildLabo() {
    // Room equipment first: objects on the same layer are drawn and hit-tested in creation order, so the
    // benches and researchers (created after) stay in front of the wall-mounted kit and door.
    this.equipment('LABO_DOOR_CLICK', 9, 'LABO', 'ALARM', 'Labo_Door', 'Click', 'LABO_E_PORTE');
    this.equipment('LABO_PHARMACY_CLICK', 9, 'LABO', 'SPIRIT', 'Labo_Soins', 'Click', 'LABO_E_PHARMACIE');
    this.equipment('LABO_AIR_CONDITIONING_CLICK', 9, 'LABO', 'EFFICIENT', 'Labo_Ventil', 'Click', 'LABO_E_AERATION');
    for (let i = 0; i < 4; i++) {
      const ws = 5 + i;
      const light = i === 1 ? 'Light' : '';
      const layer = 9 + i;
      this.add(`LABO_PAILLASSE${i}`, {
        layer,
        sprite: () => [`Labo_Paillasse${Math.min(4, this.company.workstation(ws).deskLevel)}${light}`, 0],
        target: { type: 'workstation', ws },
        sound: 'LABO_O_PAILLASSE',
      });
      this.add(`LABO_PAILLASSE_CLICK${i}`, {
        layer,
        sprite: () => {
          const st = this.company.workstation(ws);
          return st.worker && st.activity === 'Work' ? [`Labo_Paillasse${Math.min(4, st.deskLevel)}${light}Click`, 0] : null;
        },
        target: { type: 'workstation', ws },
        sound: 'LABO_O_EPROUVETTE', // test tubes [code 0x478960]
      });
      this.character(`LABO_SEEKER${i}`, layer, ws, 'LaboSeeker', 4);
      // On the blackboard: the 38x38 icon of the component being researched, with its progress
      // [code 0x46714a (objects), 0x4662eb (icon), 0x46633f (progress 0..max)].
      const search = this.add(`LABO_PAILLASSE_CLICK_SEARCH${i}`, {
        layer,
        sprite: () => {
          const r = this.company.research[ws];
          const icons = r && TECH_ICON_SETS[this.data.techno.categories[r.cat]?.file.replace(/\.ini$/i, '')];
          return icons ? [icons, r.L * 4 + r.E] : null;
        },
        target: { type: 'research', ws },
        // An empty blackboard is wall art with no object of its own; keep the board's area clickable while a
        // researcher is seated so it always opens their research choices [design choice].
        hitRect: () => {
          if (!this.company.workstation(ws).worker) return null;
          const icons = TECH_ICON_SETS[this.data.techno.categories[0]?.file.replace(/\.ini$/i, '')];
          const f = icons && this.game.assets.sprite(icons)?.meta.frames[0];
          return f ? { x: search.x - f.hotX, y: search.y - f.hotY, w: f.w, h: f.h } : null;
        },
        cursor: CURSOR.FURNITURE,
      });
      if (search) search.progress = () => {
        const r = this.company.research[ws];
        const t = r && this.company.component(r.cat, r.L, r.E);
        return t ? Math.min(1, t.progress / (t.comp.SearchNeeded * this.data.setup.AMOUNT_OF_WORK_PER_DAY)) : null;
      };
    }
    // Research machines (the product's MachineFile, e.g. ToiletMachines.ini): static until bought, then
    // animated. Slot s holds machine m with slots 2 and 3 swapped [code 0x467832, 0x42e753].
    const machines = this.data.techno.machines;
    for (let s = 0; s < 4; s++) {
      const m = s === 2 ? 3 : s === 3 ? 2 : s;
      const real = m < machines.length;
      this.add(`LABO_MACHINE${s}`, {
        layer: 12,
        sprite: () => (real && this.company.machines[m] ? [`Labo_Machine${s}_1`, null] : [`Labo_Machine${s}_0`, 0]),
        target: real ? { type: 'labmachine', m, s } : null,
        sound: `LABO_O_MACHINE${s}`,
      });
    }
    this.chantier('CHANTIER03', 12, 'LABO', 3);
  }

  buildMarketing() {
    const prod = this.data.productInfo;
    const L = 13;
    this.add('MARKET_ADD', { layer: L, sprite: () => { const n = this.company.adLevel?.() ?? 0; return n > 0 ? `Market_Add${Math.min(3, n)}` : null; } });
    this.desk('MARKET_BUREAU_PUBLICITAIRE', L, 3, 'Market_Publicitaire', { sound: 'MO_BUREAU' });
    this.desk('MARKET_BUREAU_COMMERCIAL', L, 4, 'Market_Commercial', { sound: 'MO_BUREAU' });
    this.character('MARKET_PUBLICITAIRE', L, 3, 'MarketPub', 3);
    this.character('MARKET_COMMERCIAL', L, 4, 'MarketCom', 3);
    this.equipment('MARKET_SECURITY', L, 'MARKETING', 'ALARM', 'Market_Camera', '', 'ME_CAMERA');
    this.equipment('MARKET_TV', L, 'MARKETING', 'EFFICIENT', 'Market_TV', '', 'ME_TELE');
    this.equipment('MARKET_FLOWER', L, 'MARKETING', 'SPIRIT', 'Market_Plante', '', 'ME_PLANTE');
    this.add('MARKET_MAGAZINES', { layer: L, sprite: () => (this.company.pressBudget > 0 ? 'Market_Magazines' : null) });
    this.add('MARKET_MINI_TV', { layer: L, sprite: () => (this.company.tvBudget > 0 ? 'Market_MiniTV' : null) });
    this.add('MARKET_ZEPPELIN', { layer: L, sprite: () => (this.company.zeppelin ? 'Market_Zeppelin' : null) });
    this.add('MARKET_TELESCOPE', { layer: L, sprite: () => (this.company.moon ? 'Market_Telescope' : null) });
    this.add('MARKET_PLV', { layer: L, sprite: () => (this.company.presence > 0 ? prod.plv : null) });
    this.add('MARKET_POT_DE_VINS', { layer: L, sprite: () => (this.company.corruption > 0 ? 'Market_Dollars' : null) });
    this.add('MARKET_CARTON', { layer: L, sprite: () => (this.company.oldStockDeal ? prod.cartons : null) });
    this.chantier('CHANTIER04', L, 'MARKETING', 4);
  }

  buildAdmin() {
    this.equipment('ADMIN_CHEST', 14, 'ADMIN', 'ALARM', 'Administration_Chest', '', 'ADMIN_E_CHEST');
    this.equipment('ADMIN_MEETING_TABLE', 14, 'ADMIN', 'EFFICIENT', 'Administration_Table', '', 'ADMIN_E_MEETING_TABLE');
    this.equipment('ADMIN_DISTRIBUTEUR', 14, 'ADMIN', 'SPIRIT', 'Administration_Distributeur', '', 'ADMIN_E_EAU');
    // Workstation 0 = lawyer (comptable desk), 1 = financier, 2 = HR manager (DRH).
    this.desk('ADMIN_BUREAU_DRH', 14, 2, 'Administration_BureauDRH', { sound: 'ADMIN_O_BUREAU' });
    this.desk('ADMIN_BUREAU_FINANCIER', 14, 1, 'Administration_BureauFinancier', { sound: 'ADMIN_O_BUREAU' });
    this.desk('ADMIN_BUREAU_COMPTABLE', 14, 0, 'Administration_BureauComptable', { sound: 'ADMIN_O_BUREAU' });
    this.character('ADMIN_DRH', 15, 2, 'AdminDRH', 3);
    this.character('ADMIN_FINANCIER', 15, 1, 'AdminFinancier', 3);
    this.character('ADMIN_COMPTABLE', 15, 0, 'AdminComptable', 3);
    for (const [k, ws, base] of [['DRH', 2, 'DRH'], ['FINANCIER', 1, 'Financier'], ['COMPTABLE', 0, 'Comptable']]) {
      this.add(`ADMIN_BUREAU_${k}_CLICK`, {
        layer: 15,
        sprite: () => (this.company.workstation(ws).activity === 'Ponctuelle' ? `Administration_Bureau${base}Click` : null),
        target: { type: 'workstation', ws },
        sound: () => `ADMIN_O_RAND_${k}${Math.floor(Math.random() * 2)}`, // [code 0x478960]
      });
    }
    this.chantier('CHANTIER02', 15, 'ADMIN', 2);
  }

  buildExterior() {
    const out = { inside: false, layer: 17 };
    const comp = (p) => this.sim.companies[p];
    this.add('EXT_LUNAR_PLACE', { ...out, sprite: ['Ext_LunarPlace', null], target: { type: 'moon' } });
    this.add('EXT_LUNAR_PLACE_LOGO', { ...out, sprite: () => (this.sim.market.moonOwner >= 0 ? ['LOGOS', this.sim.market.moonOwner] : null) });
    for (let i = 0; i < 8; i++) this.add(`EXT_ZEPPELIN${i}`, { ...out, sprite: () => (comp(i)?.zeppelin ? `Ext_Zeppelin${i}` : null) });
    for (let i = 0; i < 20; i++) this.add(`EXT_HOUSE${i}`, { ...out, sprite: 'Ext_House' });
    for (let i = 0; i < 20; i++) this.add(`EXT_BUILDING${i}`, { ...out, sprite: 'Ext_Building' });
    for (let i = 0; i < 40; i++) {
      this.add(`EXT_PUB${i}`, {
        ...out,
        sprite: () => {
          // Billboards show the logos of companies running ads [inferred].
          const adv = this.sim.companies.filter((c) => c && c.tvBudget + c.pressBudget > 0);
          return adv.length ? ['Ext_Pub', adv[i % adv.length].slot] : null;
        },
      });
    }
    for (let p = 0; p < 8; p++) {
      const P = `EXT_PLAYER${p}`;
      this.add(`${P}_PROD`, { ...out, sprite: () => (comp(p) ? ['Ext_Player_Prod', Math.min(2, comp(p).wallLevel('PROD'))] : ['Ext_NoPlayer', 0]), target: { type: 'company', slot: p } });
      this.add(`${P}_LABO`, { ...out, sprite: () => (comp(p) ? ['Ext_Player_Labo', Math.min(2, comp(p).wallLevel('LABO'))] : null), target: { type: 'company', slot: p } });
      this.add(`${P}_MARKET`, { ...out, sprite: () => (comp(p) ? ['Ext_Player_Market', Math.min(2, comp(p).wallLevel('MARKETING'))] : null), target: { type: 'company', slot: p } });
      this.add(`${P}_ADMIN`, { ...out, sprite: () => (comp(p) ? ['Ext_Player_Admin', Math.min(2, comp(p).wallLevel('ADMIN'))] : null), target: { type: 'company', slot: p } });
      this.add(`${P}_GUARDIAN`, { ...out, sprite: () => (comp(p)?.workstation(14).worker ? ['Ext_Player_Guardian', Math.min(3, comp(p).workstation(14).deskLevel)] : null) });
      this.add(`${P}_FLAG`, { ...out, sprite: () => (comp(p) ? [`Ext_Player_Flag${p + 1}`, null] : null) });
      this.add(`${P}_PROD_SMOKE`, { ...out, sprite: () => (comp(p)?.production.running ? [`Ext_Player_Prod_Smoke${(p % 6) + 1}`, null] : null) });
      this.add(`${P}_LABO_SMOKE`, { ...out, sprite: () => (comp(p)?.researching ? [`Ext_Player_Labo_Smoke${(p % 4) + 1}`, null] : null) });
      for (let t = 0; t < 10; t++) {
        this.add(`${P}_PROD_TRUCK${t}`, {
          ...out,
          sprite: () => {
            const c = comp(p);
            if (!c) return null;
            const sold = c.lastSales ?? { E: 0, T: 0 };
            const n = Math.min(10, Math.ceil((sold.E + sold.T) / 20));
            if (t >= n) return null;
            return [t % 2 && sold.T ? 'Ext_Player_TruckTechno' : 'Ext_Player_TruckEmotiv', t % 4];
          },
        });
      }
      for (let k = 0; k < 4; k++) {
        // Retail price digits (Number sprite, 7px pitch) [code 0x476858].
        this.add(`${P}_PRICE${k}`, {
          ...out,
          sprite: () => {
            const c = comp(p);
            if (!c) return null;
            const s = String(Math.min(9999, Math.max(0, Math.round(c.retailPrice)))).padStart(4, '0');
            return ['Number', Number(s[k])];
          },
        });
      }
      const name = this.add(`${P}_NAME`, { ...out, sprite: null });
      if (name) name.text = () => comp(p)?.name ?? '';
    }
    // Hard-coded extras [code 0x473b60].
    this.add('MY944', { ...out, x: 1155, y: 132, sprite: () => (this.extras.porsche ? 'My944' : null) });
    this.add('DUCK', { ...out, x: 960, y: 20, sprite: ['Duck', null], target: { type: 'duck' }, cursor: null, sound: () => `EXT_DUCK0${Math.floor(Math.random() * 3)}` });
    for (const [x, y] of [[769, 302], [509, 432], [248, 562], [490, 163], [229, 292]]) {
      this.add('TRAFFIC_LIGHTS', { ...out, x, y, sprite: ['TrafficLights', null], clock: { fps: 1, pauseMs: 2000 + Math.random() * 1000 } });
    }
  }

  addLemmings() {
    for (let i = 0; i < 30; i++) {
      const o = new WorldObject(this, 'LEMMING', {
        inside: false, layer: 17, x: 630 + 10 * Math.floor(Math.random() * 10), y: 740 + 10 * Math.floor(Math.random() * 10),
        sprite: ['Lemming', null], clock: { fps: 8 + Math.floor(Math.random() * 4) },
      });
      this.objects.push(o);
    }
    this.extras.lemmings = true;
  }

  overheating(ws) {
    const st = this.company.workstation(ws);
    return st.deskLevel > 0 && !st.broken && st.integrity < this.data.setup.FULL_INTEGRITY * 0.35;
  }

  // ------------------------------------------------------------------------------------------------
  // Camera and views

  clampCamera() {
    this.cam.x = Math.max(0, Math.min(this.bg.w - VIEW_W, this.cam.x));
    this.cam.y = Math.max(0, Math.min(this.bg.h - VIEW_H, this.cam.y));
  }

  setView(inside) {
    if (inside === this.inside) return;
    this.saved[this.inside ? 'inside' : 'outside'] = { ...this.cam };
    this.inside = inside;
    this.cam = { ...this.saved[inside ? 'inside' : 'outside'] };
    this.clampCamera();
    for (const a of AMBIENT) this.game.sounds.stop(`amb-${a.id}`);
  }

  centreOn(wx, wy) {
    this.cam.x = wx - VIEW_W / 2;
    this.cam.y = wy - VIEW_H / 2;
    this.clampCamera();
  }

  recenter(i) {
    this.setView(true);
    const [x, y] = RECENTER[i] ?? RECENTER[0];
    this.cam = { x, y };
    this.clampCamera();
  }

  // Edge scrolling only at the exact border pixel, 12 px per frame; arrows/numpad 12 px per 10 ms [code 0x4189fb].
  scrollCode(input) {
    if (!input.inside) return 4;
    const W = this.game.r.width, H = this.game.r.height;
    const dx = input.x <= 0 ? -1 : input.x >= W - 1 ? 1 : 0;
    const dy = input.y <= 0 ? -1 : input.y >= H - 1 ? 1 : 0;
    return (dy + 1) * 3 + (dx + 1);
  }

  update(dt, input) {
    const code = this.scrollCode(input);
    if (code !== 4) {
      this.cam.x += ((code % 3) - 1) * 12;
      this.cam.y += (Math.floor(code / 3) - 1) * 12;
    }
    this.keyAcc += dt * 1000;
    const k = input.keys;
    if (this.keyAcc >= 10) {
      const steps = Math.min(5, Math.floor(this.keyAcc / 10));
      this.keyAcc -= steps * 10;
      const sx = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
      const sy = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0);
      this.cam.x += sx * 12 * steps;
      this.cam.y += sy * 12 * steps;
    }
    this.clampCamera();
    this.hover = input.inside && input.y >= VIEW_Y && input.y < VIEW_Y + VIEW_H ? this.pick(input.x + this.cam.x, input.y - VIEW_Y + this.cam.y) : null;
    this.updateAmbience();
  }

  // Ambient loops fade with squared distance from the camera centre; muted beyond 95%.
  updateAmbience() {
    // Overheating machines loop PRODUCTION_SURCHAUFFE_MACHINE until repaired.
    const hot = this.inside && [9, 10, 11, 12, 13].some((ws) => this.overheating(ws));
    if (hot) this.game.sounds.loop('PRODUCTION_SURCHAUFFE_MACHINE', 'overheat', { volume: 0.5 });
    else this.game.sounds.stop('overheat');
    const cx = this.cam.x + VIEW_W / 2, cy = this.cam.y + VIEW_H / 2;
    for (const a of AMBIENT) {
      const key = `amb-${a.id}`;
      if (a.inside !== this.inside || (a.when && !a.when(this))) { this.game.sounds.stop(key); continue; }
      const D2 = this.inside ? 1000000 : 1440000;
      const pct = ((cx - a.x) ** 2 + (cy - a.y) ** 2) * 100 / D2;
      if (pct >= 95) { this.game.sounds.stop(key); continue; }
      const gain = Math.pow(10, (-30 * pct) / 2000);
      const src = this.game.audio.loops.get(key);
      if (src?.gainNode) src.gainNode.gain.value = gain;
      else if (!src) this.game.sounds.loop(a.id, key, { volume: gain });
    }
  }

  stopAmbience() {
    this.game.sounds.stop('overheat');
    for (const a of AMBIENT) this.game.sounds.stop(`amb-${a.id}`);
  }

  // ------------------------------------------------------------------------------------------------
  // Drawing and picking

  frameOf(o, v, meta, now) {
    return v[1] !== null && v[1] !== undefined ? v[1] : o.clock.frame(meta, now);
  }

  draw(r) {
    const c = r.ctx;
    const now = performance.now();
    c.save();
    c.beginPath();
    c.rect(0, VIEW_Y, VIEW_W, VIEW_H);
    c.clip();
    const bg = r.assets.image(this.bg.image);
    if (bg) c.drawImage(bg, this.cam.x, this.cam.y, VIEW_W, VIEW_H, 0, VIEW_Y, VIEW_W, VIEW_H);
    if (this.inside) {
      for (const b of BUILDING_OVERLAYS) {
        const lvl = Math.min(2, this.company.wallLevel(b.dept));
        if (lvl > 0) r.sprite(`${b.sprite}${lvl}`, 0, b.x - this.cam.x, b.y - this.cam.y + VIEW_Y, { anchor: 'topleft' });
      }
    }
    const sel = this.scene.selectedTarget;
    for (const o of this.objects) {
      if (o.inside !== this.inside) continue;
      if (o.text) {
        const t = o.text();
        if (t) r.text('Fonte_White_11x13VABBd', t, o.x - this.cam.x, o.y - this.cam.y + VIEW_Y, { align: 'center' });
        continue;
      }
      const v = o.resolve(this);
      if (!v) continue;
      const s = r.assets.sprite(v[0]);
      if (!s) continue;
      const frame = this.frameOf(o, v, s.meta, now);
      o.drawn = { name: v[0], frame };
      const f = s.meta.frames[frame];
      if (!f) continue;
      const sx = o.x - f.hotX - this.cam.x, sy = o.y - f.hotY - this.cam.y + VIEW_Y;
      if (sx > VIEW_W || sy > VIEW_Y + VIEW_H || sx + f.w < 0 || sy + f.h < VIEW_Y) continue;
      const selected = sel && o.target && sameTarget(sel, o.target);
      r.sprite(v[0], frame, o.x - this.cam.x, o.y - this.cam.y + VIEW_Y, { selected });
      if (o.progress) {
        // Unfinished research darkens the icon from the top [inferred style of the 38x38 progress object].
        const pr = o.progress();
        if (pr !== null) {
          const x = o.x - f.hotX - this.cam.x, y = o.y - f.hotY - this.cam.y + VIEW_Y;
          r.rect(x, y, f.w, Math.round(f.h * (1 - pr)), 'rgba(0,0,0,0.55)');
          r.rect(x, y + f.h - 3, Math.round(f.w * pr), 3, '#40ff60');
        }
      }
    }
    c.restore();
  }

  // Topmost (highest priority, then latest) selectable object at a world point [code 0x492744].
  pick(wx, wy) {
    let best = null;
    for (const o of this.objects) {
      if (o.inside !== this.inside || !o.target) continue;
      const rect = o.hitRect?.();
      if (rect) {
        if (wx >= rect.x && wy >= rect.y && wx < rect.x + rect.w && wy < rect.y + rect.h && (!best || o.priority >= best.priority)) best = o;
        continue;
      }
      if (!o.drawn || !o.resolve(this)) continue;
      let hit = false;
      if (o.polygon && o.polygonClick) hit = pointInPolygon(wx, wy, o.polygon);
      else {
        const s = this.game.assets.sprite(o.drawn.name);
        const f = s?.meta.frames[o.drawn.frame];
        if (!f) continue;
        const lx = wx - (o.x - f.hotX), ly = wy - (o.y - f.hotY);
        if (lx < 0 || ly < 0 || lx >= f.w || ly >= f.h) continue;
        hit = opaqueAt(s, f, lx, ly);
      }
      if (hit && (!best || o.priority >= best.priority)) best = o;
    }
    return best;
  }

  click(input) {
    const o = this.hover;
    if (!o) return false;
    const snd = typeof o.sound === 'function' ? o.sound() : o.sound;
    if (snd) this.game.sounds.play(snd);
    this.scene.selectTarget(o.target);
    return true;
  }

  cursor() {
    const code = this.scrollCode(this.game.input);
    if (code !== 4) return [CURSOR.UP_LEFT, CURSOR.UP, CURSOR.UP_RIGHT, CURSOR.LEFT, CURSOR.ARROW, CURSOR.RIGHT, CURSOR.DOWN_LEFT, CURSOR.DOWN, CURSOR.DOWN_RIGHT][code];
    return this.hover?.cursor ?? CURSOR.ARROW;
  }

  // Minimap: the background scaled into the lower-bar device, with the camera rectangle.
  drawMinimap(r, x, y, w, h) {
    const bg = r.assets.image(this.bg.image);
    if (bg) r.ctx.drawImage(bg, 0, 0, this.bg.w, this.bg.h, x, y, w, h);
    const sx = w / this.bg.w, sy = h / this.bg.h;
    if (this.inside) {
      for (const b of BUILDING_OVERLAYS) {
        const lvl = Math.min(2, this.company.wallLevel(b.dept));
        const s = lvl > 0 ? r.assets.sprite(`${b.sprite}${lvl}`) : null;
        const f = s?.meta.frames[0];
        if (f) r.ctx.drawImage(s.image, f.x, f.y, f.w, f.h, x + b.x * sx, y + b.y * sy, f.w * sx, f.h * sy);
      }
    }
    r.strokeRect(Math.round(x + this.cam.x * sx), Math.round(y + this.cam.y * sy), Math.round(VIEW_W * sx) + 1, Math.round(VIEW_H * sy) + 1, '#ffff40');
  }
}

function sameTarget(a, b) {
  return a.type === b.type && a.ws === b.ws && a.dept === b.dept && a.kind === b.kind && a.slot === b.slot && a.m === b.m;
}

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Alpha test against the sprite atlas (cached per sprite set).
function opaqueAt(s, f, lx, ly) {
  if (!s.alpha) {
    const c = document.createElement('canvas');
    c.width = s.image.width;
    c.height = s.image.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(s.image, 0, 0);
    s.alpha = { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width };
  }
  const i = ((f.y + Math.floor(ly)) * s.alpha.w + f.x + Math.floor(lx)) * 4 + 3;
  return s.alpha.data[i] === 255; // shadow pixels (alpha 128) are not clickable
}
