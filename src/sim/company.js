// One company (player or computer): workstations and workers, finances, tech tree, production, actions.
// Ported from the shared Code\Simulation classes (client GadgetTycoon.exe 0x43f040..0x45fxxx, server copies);
// see docs/simulation.md. Integer maths truncates toward zero like the original.
import { History } from './history.js';
import { JOB, DEPT, ACTION, OBJECT_KEYS } from './data.js';

const trunc = Math.trunc;
const idiv = (a, b) => (b ? trunc(a / b) : 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Account-book categories (C 0x4434a0).
export const BOOK = {
  SALARIES: 0, SEVERANCE: 1, WORKSTATIONS: 2, OBJECTS: 3, COMPONENTS: 4, TV: 5, PRESS: 6, LOAN_REPAY: 7, FINES: 8, ACTIONS: 9,
  SALES: 10, PATENTS: 11, LOAN: 12, OTHER: 13, TRIALS: 14, AWARDS: 15,
};
const DEBITS = 10;

// Sector workstation ranges hard-coded in the original.
export const SECTOR_WS = { ADMIN_MARK: [0, 1, 2, 3, 4], PROD: [9, 10, 11, 12, 13], LABO: [5, 6, 7, 8], SPECIALS: [14, 15, 16] };
// Which ObjectList department each workstation belongs to (specials get no object effects).
const WS_OBJECT_DEPT = [1, 1, 1, 0, 0, 2, 2, 2, 2, 3, 3, 3, 3, 3, -1, -1, -1];
export const DEPT_NAMES = ['MARKETING', 'ADMIN', 'LABO', 'PROD'];
const KIND_INDEX = { WALL: 0, ALARM: 1, EFFICIENT: 2, SPIRIT: 3 };

// News ids used by the simulation (News.ini / News__TRAD).
export const NEWS = {
  LINE_INCOMPLETE: 0, MACHINE_BROKEN: 1, CHIEF_REPAIRED: 2, DRIVER_REPAIRED: 3, PATENT_GRANTED: 5, PATENT_REPORT: 6,
  MOTIVATION_PROD: 21, MOTIVATION_SPECIALS: 22, MOTIVATION_LABO: 23, MOTIVATION_ADMIN: 24, MAFIA_CONTACT: 25, BLACK_OPS: 26,
  TRAINING_LEVEL: 27, TRAINING_SPIRIT: 28, TRAINING_EFFICIENCY: 29, MOON_END: 33, ZEPPELIN_END: 34, CORRUPTION: 35,
  OLD_STOCK_SOLD: 37, TRIAL: 40, INNOCENT: 41, GUILTY: 42, FISCAL_NOTICE: 44, FISCAL_REPORT: 45, FISCAL_CLEAN: 46,
  SLANDER: 47, SPY_REPORT: 56, ADMIN_BURGLED: 58, SPY_REFUSED: 59, SPY_CAPTURED: 60, THREAT_DONE: 62, GUARD_BEATEN: 66,
  THROW_STOCK: 88, LOW_SPIRIT_BASE: 108, RESIGNATION: 119, BANKRUPTCY_WARNING: 120, BANKRUPT: 121, POACHED: 149,
};
const LOW_SPIRIT_NEWS = [114, 115, 113, 110, 116, 117, 111, 112, 109, 108, 118]; // by job (workers.md §1)

export class Workstation {
  constructor(company, def) {
    this.company = company;
    this.index = def.index;
    this.job = def.JobType;
    this.def = def;
    this.deskId = def.DeskID; // level-0 desk ("no desk")
    this.worker = null; // global worker record
    this.spirit = 0;
    this.efficiency = 0;
    this.productivity = 0;
    this.level = 0;
    this.peakProductivity = 0;
    this.infl = { threat: 0, motivation: 0, wall: 0, spirit: 0, efficiency: 0 };
    this.training = -1;
    this.trainingWork = 0;
    this.generation = 0;
    this.integrity = 10000;
    this.broken = false;
    this.bars = def.barActions.map((id) => ({ id, requested: 0, effective: 0 }));
    this.buttons = def.buttonActions.map((id) => ({ id, remaining: 0, active: false, queued: false, done: false }));
    this.activeButton = -1;
    this.cv = []; // worker ids available for hire here
    this.lowSpiritNotified = false;
    this.pointActionTimer = 0;
  }

  get sim() { return this.company.sim; }
  get data() { return this.company.data; }
  get desk() { return this.data.desktops[this.deskId]; }
  get deskLevel() { return this.desk?.Level ?? 0; }

  // Activity shown in the world: Work / Mooch (idle or slacking) / Ponctuelle (one-off action) / Repair.
  get activity() {
    if (!this.worker) return 'Mooch';
    if (this.activeButton >= 0) {
      const id = this.buttons[this.activeButton].id;
      return id === ACTION.BTN_REPAIR_MACHINE ? 'Repair' : 'Ponctuelle';
    }
    if (this.deskLevel <= 0 || this.spirit < 35) return 'Mooch';
    // A researcher only works while a component is being researched.
    if (this.job === JOB.SEARCHER) return this.company.research[this.index] ? 'Work' : 'Mooch';
    const busy = this.bars.some((b) => b.effective > 0);
    return busy ? 'Work' : 'Mooch';
  }

  // Spirit [C 0x45a310]: salary vs reference, sector objects, motivation and threats.
  computeSpirit() {
    const S = this.data.setup;
    const MI = S.MAX_INFLUENCE, FS = S.FULL_SPIRIT;
    const w = this.worker;
    if (!w) return;
    const clampI = (x) => clamp(x, -MI, MI);
    const ref = this.company.refSalary(w.JobType, w.level);
    const paid = w.salary;
    let sal;
    if (paid > ref) sal = paid > 2 * ref ? MI : idiv((paid - ref) * MI, ref);
    else sal = 2 * paid < ref ? -MI : idiv((paid - ref) * MI * 2, ref);
    let raw = 2 * sal + clampI(this.infl.spirit) + clampI(this.infl.wall);
    raw += clampI(this.infl.motivation);
    const t = this.infl.threat;
    raw += t > MI ? MI : t < -MI ? -MI : 2 * t;
    raw = idiv(raw, 8);
    this.spirit = clamp(w.BasicSpirit + idiv(FS * raw * 2, 3 * MI), 0, FS);
    w.spirit = this.spirit;
    this.computeEfficiency();
    // Low morale: news, then resignation 15 days later if still low [C 0x45b520].
    if (this.spirit < S.CHECK__WORKER_SPIRIT_LOW) {
      if (!this.lowSpiritNotified) {
        this.lowSpiritNotified = true;
        this.company.news(LOW_SPIRIT_NEWS[this.job], { ws: this.index, worker: w }, { task: { kind: 'spiritCheck', ws: this.index, worker: w.index }, delayDays: 15 });
      }
    } else this.lowSpiritNotified = false;
  }

  // Efficiency [C 0x45a4c0]: spirit and efficiency objects bend the worker's basic productivity.
  computeEfficiency() {
    const S = this.data.setup;
    const MI = S.MAX_INFLUENCE, FS = S.FULL_SPIRIT, FE = S.FULL_EFFICIENCY;
    const w = this.worker;
    if (!w) return;
    const s = this.spirit;
    const sInfl = s > 65 ? idiv((s - 65) * MI, FS - 65) : idiv((s - 65) * MI, 65);
    const X = idiv(sInfl + clamp(this.infl.efficiency, -MI, MI), 3);
    const BP = w.BasicProductivity;
    this.efficiency = X > 0 ? BP + idiv((FE - BP) * X, MI) : BP + idiv(BP * X, MI);
    this.updateProductivity();
  }

  // Level and productivity [C 0x45b130].
  updateProductivity() {
    if (!this.worker) { this.level = 0; this.productivity = 0; return; }
    this.level = Math.min(this.deskLevel, this.worker.level);
    this.productivity = idiv((this.desk?.ProductivityBasic ?? 0) + this.efficiency, 2);
    if (this.training !== -1) this.productivity = idiv(this.productivity, 2);
    this.peakProductivity = Math.max(this.peakProductivity, this.productivity);
  }

  // Bars always sum to 100%: free % is spread over all bars unless a button is waiting [C 0x45c4f0].
  recomputeBars() {
    const free = 100 - this.bars.reduce((a, b) => a + b.requested, 0);
    const queued = this.buttons.some((b) => b.queued);
    for (const b of this.bars) {
      if (this.activeButton >= 0) b.effective = 0;
      else if (queued) b.effective = b.requested;
      else b.effective = b.requested + (this.bars.length ? free / this.bars.length : 0);
    }
  }

  setBar(i, pct) {
    const others = this.bars.reduce((a, b, k) => a + (k === i ? 0 : b.requested), 0);
    this.bars[i].requested = clamp(Math.round(pct), 0, 100 - others);
    this.recomputeBars();
  }

  action(id) { return this.data.actions[id]; }

  canLaunch(id) {
    const a = this.action(id);
    if (id === ACTION.BTN_REPAIR_MACHINE && !this.broken && this.integrity >= this.company.setup.FULL_INTEGRITY) return false; // nothing to repair [design choice]
    return !!this.worker && this.level >= (a.LevelRequired ?? 1);
  }

  // Start a one-off button action (or flag action). It takes all the worker's time until complete.
  launchButton(id) {
    const i = this.buttons.findIndex((b) => b.id === id);
    if (i < 0 || !this.canLaunch(id)) return false;
    const b = this.buttons[i];
    if (b.done || b.active) return false;
    if (this.activeButton >= 0 && this.activeButton !== i) this.buttons[this.activeButton].active = false;
    b.active = true;
    b.queued = true;
    b.remaining = this.action(id).NeededTime * this.data.setup.AMOUNT_OF_WORK_PER_DAY;
    b.params = this.company.pendingParams ?? {};
    this.company.pendingParams = null;
    this.activeButton = i;
    this.recomputeBars();
    return true;
  }

  cancelButton() {
    if (this.activeButton < 0) return;
    const b = this.buttons[this.activeButton];
    b.active = false;
    b.queued = false;
    this.activeButton = -1;
    this.recomputeBars();
  }

  // Once per loop: turn this loop's time into work and feed the action handlers [C 0x45c140].
  fireActions() {
    const S = this.data.setup;
    if (!this.worker) return;
    const P = this.productivity;
    if (this.activeButton >= 0) {
      const b = this.buttons[this.activeButton];
      const work = trunc((S.AMOUNT_OF_WORK_PER_SIM_LOOP * P) / 100);
      const a = this.action(b.id);
      const needed = a.NeededTime * S.AMOUNT_OF_WORK_PER_DAY;
      this.company.book(needed > 0 ? idiv(a.Price * work, needed) : a.Price, BOOK.ACTIONS);
      b.remaining -= work;
      if (b.remaining < 0) {
        b.active = false;
        b.queued = false;
        this.activeButton = -1;
        if (b.id >= ACTION.FLG_BLACK_OPS && isFlag(b.id)) b.done = true;
        this.company.runAction(b.id, work, this, b.params);
        this.recomputeBars();
      }
      return;
    }
    for (const bar of this.bars) {
      const work = trunc((S.AMOUNT_OF_WORK_PER_SIM_LOOP * bar.effective * P) / (100 * 100));
      if (work > 0) this.company.runAction(bar.id, work, this);
    }
  }
}

const FLAG_ACTIONS = new Set([ACTION.FLG_BLACK_OPS, ACTION.FLG_CONTACT_MAFIA, ACTION.FLG_GET_ZEPPELIN, ACTION.FLG_GET_MOON_CONCESSION, ACTION.FLG_DEAL_OLD_STOCK]);
function isFlag(id) { return FLAG_ACTIONS.has(id); }

export class Company {
  // slot: 0..7; opts: { name, isPlayer, ai, startOption, cash, debt, debtDays }
  constructor(sim, slot, opts) {
    this.sim = sim;
    this.data = sim.data;
    const S = this.data.setup;
    this.slot = slot;
    this.name = opts.name;
    this.isPlayer = !!opts.isPlayer;
    this.aiType = opts.ai ?? null;
    this.alive = true;
    // Finance (C 0x448f30).
    this.cash = opts.cash ?? 1000000;
    this.balance = this.cash; // trade balance: every booking applied immediately
    this.debt = opts.debt ?? 0;
    this.debtDays = opts.debtDays ?? 0;
    this.sharePrice = 0;
    this.deferred = new History(1, S.MAX_DELAY_MONEY);
    this.payDelayDays = 0;
    this.delayWork = 0;
    this.delaySmooth = 0;
    this.ledger = new Array(16).fill(0); // this loop
    this.ledgerHist = Array.from({ length: 16 }, () => []); // per-loop history (for the account book)
    this.ledgerMonth = new Array(16).fill(0); // rolling 30-day totals shown in the panel
    this.monthHist = Array.from({ length: 16 }, () => new History(S.HISTORY_DAY));
    this.ledgerDay = new Array(16).fill(0);
    // Illegality, image, notoriety.
    this.illegal = new History(S.MAX_ILLEGAL_POINTS_HISTORY);
    this.slander = new History(S.MAX_SLANDER_POINTS_HISTORY);
    this.presenceHist = new History(S.HISTORY_DAY);
    this.corruptionHist = new History(S.MAX_DISTRIBUTOR_CORRUPTION_HISTORY);
    this.negotiateHist = new History(S.MAX_ILLEGAL_POINTS_HISTORY, 1);
    this.fiscalRisk = 0;
    this.notoriety = 15;
    this.image = 0;
    this.newsImage = 0;
    this.flags = { blackOps: false, mafia: false, sabotaged: false, bomb: false };
    this.zeppelin = false;
    this.moon = false;
    this.zeppelinRequest = false;
    this.moonRequest = false;
    this.oldStockDeal = false;
    this.construction = {};
    // Commercial.
    this.price = 0; // product price set by the player (K[0x26])
    this.extraMargin = 0;
    this.tvMonthly = 0;
    this.pressMonthly = 0;
    this.tvWork = 0;
    this.pressWork = 0;
    this.stock = 0;
    this.produced = 0;
    this.soldTotal = 0;
    this.soldE = 0;
    this.soldT = 0;
    this.lastSales = { E: 0, T: 0 };
    this.noteE = 0;
    this.noteT = 0;
    this.unitsThisLoop = 0;
    this.history = { cash: [], sales: [], balance: [] };
    this.statsHistory = []; // per 10 days, for the end screen
    // Objects: level per ObjectList type (0..15).
    this.objects = new Array(16).fill(0);
    // Workstations.
    this.workstations = this.data.workstations.map((d) => new Workstation(this, d));
    // Tech tree: per category, components with state/progress.
    this.tech = this.data.techno.categories.map((cat) => cat.components.map((c) => ({ comp: c, state: 0, progress: 0, blocked: false })));
    this.machines = this.data.techno.machines.map(() => false);
    this.line = this.tech.map(() => null); // { L, E, provider }
    this.lineChanged = false;
    this.research = {}; // ws -> { cat, L, E }
    this.target = 0; // production units per loop
    this.inbox = [];
    this.lastNewsDay = {};
    this.pendingParams = null;
    this.patentsOwned = 0;
    this.updateAvailability();
  }

  get setup() { return this.data.setup; }
  get employeeCount() { return this.workstations.filter((w) => w.worker).length; }
  get researching() { return Object.keys(this.research).length > 0; }
  get production() {
    const chief = this.workstations[9];
    return { running: this.lineComplete() && this.target > 0 && !chief.broken, speed: this.target / this.setup.MAX_PRODUCTION_BAR_VALUE };
  }
  get bottomLine() { return this.balance - this.debt; }
  get tvBudget() { return this.effectiveBudget(this.tvMonthly, this.tvWork); }
  get pressBudget() { return this.effectiveBudget(this.pressMonthly, this.pressWork); }
  get presence() { return this.presenceHist.sum; }
  get corruption() { return this.corruptionHist.sum; }

  workstation(i) { return this.workstations[i]; }
  objectLevel(dept, kind) {
    const d = typeof dept === 'number' ? dept : DEPT_NAMES.indexOf(dept);
    return this.objects[d * 4 + KIND_INDEX[kind]] ?? 0;
  }
  wallLevel(dept) {
    if (dept === 'OUTSIDE') return Math.max(...[0, 1, 2, 3].map((d) => this.objects[d * 4]));
    return this.objectLevel(dept, 'WALL');
  }
  machineBroken(ws) { return this.workstations[ws].broken; }
  stockFrame() { return clamp(Math.ceil(this.stock / 200), 0, 6); }
  adLevel() { return this.tvMonthly + this.pressMonthly > 0 ? Math.min(3, 1 + Math.floor((this.tvMonthly + this.pressMonthly) / 150000)) : 0; }

  // ------------------------------------------------------------------------------------------------
  // Money

  // book() [C 0x4434a0]: debits are paid payDelayDays late; the trade balance moves immediately.
  book(amount, cat) {
    if (!amount) return;
    const signed = cat < DEBITS ? -amount : amount;
    this.ledger[cat] += amount;
    if (cat < DEBITS && this.payDelayDays > 0) this.deferred.add(signed, this.payDelayDays - 1);
    else this.cash += signed;
    const old = this.balance;
    this.balance += signed;
    if (old > 15000 && this.balance < 15000) this.news(NEWS.BANKRUPTCY_WARNING, {});
  }

  refSalary(job, level) {
    const key = `E_JOB_TYPE_${['ACCOUNTANT', 'FINANCIER', 'MANAGER', 'SPY', 'PUB', 'COM', 'MAFIOSI', 'SEARCHER', 'DRIVER_CHIEF', 'DRIVER', 'GUARDIAN'][job]}`;
    return trunc((this.sim.salaryTable[key] ?? 0) * (this.data.salaryMultiplier[level] ?? level));
  }

  effectiveBudget(budget, work) {
    const S = this.setup;
    const lo = idiv((S.MIN_PUB_OPTIMIZED_BUDGET - S.MAX_PUB_BUDGET) * 100, S.MAX_PUB_BUDGET);
    const hi = idiv((S.MAX_PUB_OPTIMIZED_BUDGET - S.MAX_PUB_BUDGET) * 100, S.MAX_PUB_BUDGET);
    const e = idiv((hi - lo) * work, S.AMOUNT_OF_WORK_PER_SIM_LOOP) + lo;
    return budget + idiv(budget * e, 100);
  }

  // Distributor price (C 0x449c40) and retail price (C 0x449f40).
  get distributorPrice() {
    const S = this.setup;
    const lo = idiv((S.MIN_SELLING_PRICE - S.MAX_PRICE) * 100, S.MAX_PRICE);
    const hi = idiv((S.MAX_SELLING_PRICE - S.MAX_PRICE) * 100, S.MAX_PRICE);
    const H = S.MAX_ILLEGAL_POINTS_HISTORY * S.AMOUNT_OF_WORK_PER_DAY;
    const x = clamp(this.negotiateHist.sum, 0, H);
    const pct = idiv((hi - lo) * (H - x), H) + lo;
    return idiv(this.price * (100 + pct), 100);
  }
  get retailPrice() {
    return clamp(idiv((this.extraMargin + 100) * this.distributorPrice, 100), 0, this.setup.MAX_SELLING_PRICE);
  }

  // ------------------------------------------------------------------------------------------------
  // Tech tree and product line

  component(cat, L, E) {
    return this.tech[cat]?.find((t) => t.comp.Level === L && t.comp.Evolution === E) ?? null;
  }

  // Availability [C 0x455af0].
  updateAvailability() {
    for (let c = 0; c < this.tech.length; c++) {
      for (const t of this.tech[c]) {
        if (t.state !== 0) continue;
        const { Level: L, Evolution: E } = t.comp;
        const prevOK = (L === 0 && E === 0) || (E > 0 && this.component(c, L, E - 1)?.state === 3)
          || (E === 0 && L > 0 && this.component(c, L - 1, 0)?.state === 3);
        const machOK = t.comp.RequiredMachine === -1 || this.machines[t.comp.RequiredMachine];
        const reqOK = t.comp.RequiredComponent === -1
          || this.component(t.comp.RequiredComponent, t.comp.RequiredLevel, t.comp.RequiredEvolution)?.state === 3;
        if (prevOK && machOK && reqOK) { t.state = 1; t.blocked = false; } else t.blocked = prevOK;
      }
    }
  }

  startResearch(ws, cat, L, E) {
    const w = this.workstations[ws];
    const t = this.component(cat, L, E);
    if (!t || !w.worker || L + 1 > w.level || (t.state !== 1 && t.state !== 2)) return false;
    t.state = 2;
    this.research[ws] = { cat, L, E };
    return true;
  }

  stopResearch(ws) {
    const r = this.research[ws];
    delete this.research[ws];
    if (!r) return;
    const t = this.component(r.cat, r.L, r.E);
    if (t?.state === 2 && !Object.values(this.research).some((x) => x.cat === r.cat && x.L === r.L && x.E === r.E)) t.state = 1;
  }

  buyMachine(m) {
    if (this.machines[m]) return false;
    this.machines[m] = true;
    this.book(this.data.techno.machines[m].Price, BOOK.OBJECTS);
    this.updateAvailability();
    return true;
  }

  // Choose a component for a category of the product (provider -1 = in-house, >= 0 = bought).
  setLine(cat, L, E, provider) {
    const t = this.component(cat, L, E);
    if (!t || t.state !== 3) return false;
    const old = this.line[cat];
    if (old && (old.L !== L || old.E !== E) && this.stock > 0) this.oldStock = { units: this.stock, unitCost: this.unitCost };
    this.line[cat] = { L, E, provider };
    this.lineChanged = true;
    const cost = this.unitCost;
    if (this.hasProduct && this.price < cost) this.price = Math.min(this.setup.MAX_PRICE, Math.ceil(cost / 10) * 10);
    return true;
  }

  clearLine(cat) {
    if (this.line[cat] && this.stock > 0) this.oldStock = { units: this.stock, unitCost: this.unitCost };
    this.line[cat] = null;
    this.lineChanged = true;
  }

  // Leftover stock of a discontinued product [C 0x4442d0]: sold off if "deal old stock" was done, else thrown
  // away. (The original credits the sale outside the account book so cash never sees it; it is credited here.)
  handleOldStock() {
    if (!this.oldStock) return;
    const { units, unitCost } = this.oldStock;
    this.oldStock = null;
    this.stock = 0;
    if (this.oldStockDeal) {
      this.book(units * unitCost, BOOK.SALES);
      this.news(NEWS.OLD_STOCK_SOLD, { qty: units, amount: units * unitCost });
    } else this.news(NEWS.THROW_STOCK, { qty: units });
  }

  get hasProduct() { return this.line.every((l) => l); }

  unitPrice(cat) {
    const l = this.line[cat];
    if (!l) return 0;
    const t = this.component(cat, l.L, l.E);
    return t.comp.Price * (l.provider >= 0 ? this.setup.PROVIDER_PRICE_MULTIPLICATOR : 1);
  }

  get unitCost() { return this.line.reduce((a, l, i) => a + (l ? this.unitPrice(i) : 0), 0); }

  // Line complete [C 0x45d980]: product chosen, chief present and working, in-house drivers present.
  lineComplete() {
    if (!this.hasProduct) return false;
    const chief = this.workstations[9];
    if (!chief.worker || chief.broken) return false;
    return this.line.every((l, i) => l.provider >= 0 || (this.workstations[10 + i].worker && !this.workstations[10 + i].broken));
  }

  levelsEvos() {
    return { levels: this.line.map((l) => l?.L ?? 0), evos: this.line.map((l) => l?.E ?? 0) };
  }

  // ------------------------------------------------------------------------------------------------
  // Workers

  hire(wsIndex, workerId, salary) {
    const ws = this.workstations[wsIndex];
    const w = this.sim.workers[workerId];
    if (!w || w.JobType !== ws.job) return false;
    if (w.owner !== -1 && w.owner !== this.slot) {
      // Poaching another company's employee: no severance for them.
      const other = this.sim.companies[w.owner];
      const ows = other?.workstations.find((x) => x.worker === w);
      if (ows) { other.vacate(ows); other.news(NEWS.POACHED, { ws: ows.index, worker: w }); }
    }
    if (ws.worker) this.fire(wsIndex);
    w.owner = this.slot;
    w.salary = salary ?? Math.max(this.refSalary(w.JobType, w.level), w.salary);
    ws.worker = w;
    ws.generation++;
    ws.training = -1;
    ws.recomputeBars();
    ws.computeSpirit();
    for (const x of this.workstations) x.cv = x.cv.filter((id) => id !== workerId);
    return true;
  }

  vacate(ws) {
    if (ws.worker) ws.worker.owner = -1;
    ws.worker = null;
    ws.generation++;
    ws.training = -1;
    ws.cancelButton();
    if (ws.job === JOB.SEARCHER) this.stopResearch(ws.index);
    ws.updateProductivity();
  }

  // Fire [C 0x45a720]: severance = reference salary for the job and level.
  fire(wsIndex) {
    const ws = this.workstations[wsIndex];
    const w = ws.worker;
    if (!w) return;
    this.book(this.refSalary(w.JobType, w.level), BOOK.SEVERANCE);
    this.vacate(ws);
  }

  raiseSalary(wsIndex, delta = 50) {
    const ws = this.workstations[wsIndex];
    if (!ws.worker) return;
    ws.worker.salary = clamp(ws.worker.salary + delta, 0, 999999);
    ws.computeSpirit();
  }

  // Poach price [C 0x45f760]; -1 = cannot be poached.
  poachPrice(w) {
    const S = this.setup;
    const MI = S.MAX_INFLUENCE, FS = S.FULL_SPIRIT;
    const base = this.sim.salaryTable[`E_JOB_TYPE_${['ACCOUNTANT', 'FINANCIER', 'MANAGER', 'SPY', 'PUB', 'COM', 'MAFIOSI', 'SEARCHER', 'DRIVER_CHIEF', 'DRIVER', 'GUARDIAN'][w.JobType]}`];
    const p0 = Math.max(w.salary + 500, base);
    const inf = idiv((w.spirit - w.BasicSpirit) * MI * 3, 2 * FS);
    const myWs = this.workstations.find((x) => x.job === w.JobType);
    const sector = myWs ? clamp(myWs.infl.spirit, -MI, MI) + clamp(myWs.infl.wall, -MI, MI) : 0;
    const need = idiv(5 * inf - sector, 2);
    let price;
    if (need > MI) price = -1;
    else if (need > 0) price = Math.max(p0, base + idiv(base, MI) * need);
    else price = p0;
    return price > 999999 ? -1 : price;
  }

  hirePrice(w) {
    if (w.owner === -1) return Math.max(this.refSalary(w.JobType, w.level), w.salary);
    return this.poachPrice(w);
  }

  // Training [C 0x45ac30]: kind 0 level, 1 efficiency, 2 morale; 15 days at half productivity.
  startTraining(wsIndex, kind) {
    const ws = this.workstations[wsIndex];
    const w = ws.worker;
    if (!w || ws.training !== -1) return false;
    if (kind === 0 && w.level >= w.LevelMax) return false;
    this.book(this.setup.TRAINING_PRICE, BOOK.ACTIONS);
    ws.training = kind;
    ws.trainingWork = this.setup.TRAINING_TIME;
    ws.trainingGeneration = ws.generation;
    ws.updateProductivity();
    return true;
  }

  finishTraining(ws) {
    const S = this.setup;
    const w = ws.worker;
    const kind = ws.training;
    ws.training = -1;
    if (!w || ws.trainingGeneration !== ws.generation) return;
    if (kind === 0 && w.level < w.LevelMax) { w.level++; this.news(NEWS.TRAINING_LEVEL, { ws: ws.index, worker: w }); }
    if (kind === 1) { w.BasicProductivity = Math.min(w.BasicProductivity + S.FULL_SPIRIT / 10, (S.FULL_EFFICIENCY * 9) / 10); this.news(NEWS.TRAINING_EFFICIENCY, { ws: ws.index, worker: w }); }
    if (kind === 2) { w.BasicSpirit = Math.min(w.BasicSpirit + S.FULL_SPIRIT / 10, (S.FULL_SPIRIT * 9) / 10); this.news(NEWS.TRAINING_SPIRIT, { ws: ws.index, worker: w }); }
    ws.computeSpirit();
  }

  // ------------------------------------------------------------------------------------------------
  // Desks and objects

  desksFor(wsIndex) {
    const job = this.workstations[wsIndex].job;
    return this.data.desktops.filter((d) => d.JobType === job).sort((a, b) => a.Level - b.Level);
  }

  buyDesk(wsIndex, level) {
    const ws = this.workstations[wsIndex];
    const d = this.desksFor(wsIndex).find((x) => x.Level === level);
    if (!d || level <= ws.deskLevel) return false;
    this.book(d.Price, BOOK.WORKSTATIONS);
    ws.deskId = d.index;
    ws.integrity = this.setup.FULL_INTEGRITY;
    ws.broken = false;
    ws.updateProductivity();
    return true;
  }

  objectEntry(type, level) {
    return this.data.objects.find((o) => o.ObjectType === type && o.Level === level);
  }

  maxObjectLevel(type) {
    return Math.max(...this.data.objects.filter((o) => o.ObjectType === type).map((o) => o.Level));
  }

  // Buy an object [C 0x443e50]: walls +30 spirit, efficiency objects +20 efficiency, spirit objects +20 spirit.
  buyObject(type, level) {
    const old = this.objects[type];
    const e = this.objectEntry(type, level);
    if (!e || level <= old) return false;
    this.book(e.Price, BOOK.OBJECTS);
    this.objects[type] = level;
    this.applyObjectEffects(type, level - old);
    if (type % 4 === 0) {
      const dept = DEPT_NAMES[type >> 2];
      this.construction[dept] = 4 * this.setup.NUMBER_OF_SIM_LOOPS_PER_DAY; // building site shown for a few days
    }
    return true;
  }

  applyObjectEffects(type, delta) {
    const MI = this.setup.MAX_INFLUENCE;
    const dept = type >> 2, kind = type & 3;
    for (const ws of this.workstations) {
      if (WS_OBJECT_DEPT[ws.index] !== dept) continue;
      if (kind === 0) ws.infl.wall += delta * idiv(MI, 2);
      if (kind === 2) ws.infl.efficiency += delta * idiv(MI, 3);
      if (kind === 3) ws.infl.spirit += delta * idiv(MI, 3);
      ws.computeSpirit();
    }
  }

  // Security per sector [C 0x443990]: alarm level + guardian control work.
  security(sector) {
    const AOW = this.setup.AMOUNT_OF_WORK_PER_SIM_LOOP;
    const g = this.guardWork ?? { admin: 0, prod: 0, labo: 0 };
    const sec = (alarm, work) => idiv((alarm * idiv(AOW, 3) + work) * 100, 2 * AOW);
    if (sector === 'LABO') return sec(this.objects[9], g.labo);
    if (sector === 'PROD') return sec(this.objects[13], g.prod);
    if (sector === 'ADMIN') return sec(this.objects[5], g.admin);
    return sec(this.objects[1], g.admin);
  }

  get guardianLevel() {
    const ws = this.workstations[14];
    return ws.worker ? ws.level : 0;
  }

  // ------------------------------------------------------------------------------------------------
  // Action handlers (cAction table, C 0x43f2e0..0x441050)

  runAction(id, work, ws, params = {}) {
    const S = this.setup;
    const L = S.NUMBER_OF_SIM_LOOPS_PER_DAY;
    const r = ws.peakProductivity ? (S.MAX_ACTION_BAR_VALUE * S.FULL_EFFICIENCY * work) / (ws.peakProductivity * S.AMOUNT_OF_WORK_PER_SIM_LOOP) : 0;
    const wear = () => {
      let w = trunc((S.MAX_MACHINE_WEAR_PER_LOOP * r) / 100);
      if (r > 100) w *= S.MACHINE_WEAR_OVERUSE_MULTIPLICATOR;
      return w;
    };
    switch (id) {
      case ACTION.BAR_ORGANIZE_TREASURY:
        this.illegal.add(-idiv(idiv(S.MAX_REGULARIZATION_POINTS * work, S.AMOUNT_OF_WORK_PER_SIM_LOOP), L));
        break;
      case ACTION.BAR_OPTIMIZE_DELAYS:
        this.delayWork += work;
        break;
      case ACTION.BAR_SEARCH_LOAN:
        break; // never affects offers in the shipped game (finance.md §6.3)
      case ACTION.FLG_BLACK_OPS:
        this.flags.blackOps = true;
        this.illegal.add(S.BLACK_OPS_ILLEGALITY_COST);
        this.news(NEWS.BLACK_OPS, {});
        break;
      case ACTION.FLG_CONTACT_MAFIA:
        this.flags.mafia = true;
        this.illegal.add(S.MAFIA_CONTACT_ILLEGALITY_COST);
        this.news(NEWS.MAFIA_CONTACT, {});
        break;
      case ACTION.BTN_ESPIONAGE_TRIAL:
        this.sim.espionageTrial(this, params.target);
        break;
      case ACTION.BTN_SLANDER_SOCIETY:
        this.illegal.add(S.SLANDER_ILLEGALITY_COST);
        this.sim.slander(this, params.target);
        break;
      case ACTION.BTN_LAUNCH_FISCAL_CONTROL:
        this.sim.requestFiscalControl(this);
        break;
      case ACTION.BAR_POPULATE_CV_DRH_PARTICIPATION:
        this.drhWork = (this.drhWork ?? 0) + work;
        break;
      case ACTION.BAR_CORRUPT_EXTERNAL_WORKERS:
        this.corruptWork = (this.corruptWork ?? 0) + work;
        break;
      case ACTION.BTN_MOTIVATE_ADMIN_AND_MARK:
      case ACTION.BTN_MOTIVATE_PRODUCTION:
      case ACTION.BTN_MOTIVATE_LABORATORY:
      case ACTION.BTN_MOTIVATE_SPECIALS: {
        const sector = { [ACTION.BTN_MOTIVATE_ADMIN_AND_MARK]: 'ADMIN_MARK', [ACTION.BTN_MOTIVATE_PRODUCTION]: 'PROD', [ACTION.BTN_MOTIVATE_LABORATORY]: 'LABO', [ACTION.BTN_MOTIVATE_SPECIALS]: 'SPECIALS' }[id];
        const bonus = ws.level * idiv(S.MAX_INFLUENCE, 3);
        this.sectorInfluence(sector, 'motivation', bonus, S.MOTIVATION_DURATION);
        this.news({ ADMIN_MARK: 24, PROD: 21, LABO: 23, SPECIALS: 22 }[sector], {});
        break;
      }
      case ACTION.BAR_OPTIMIZE_TECHNOIDS_BUDGET:
        this.pressWork = work;
        break;
      case ACTION.BAR_OPTIMIZE_EMOTIVES_BUDGET:
        this.tvWork = work;
        break;
      case ACTION.FLG_GET_ZEPPELIN:
        this.zeppelinRequest = true;
        break;
      case ACTION.FLG_GET_MOON_CONCESSION:
        this.moonRequest = true;
        break;
      case ACTION.BAR_NEGOTIATE_SELLING_PRICE:
        this.negotiateHist.add(work);
        break;
      case ACTION.BAR_PRODUCT_PRESENCE:
        this.presenceHist.add(work);
        break;
      case ACTION.BTN_CORRUPT_DISTRIBUTOR:
        this.corruptionHist.add(1);
        this.illegal.add(S.CORRUPT_ILLEGALITY_COST);
        this.news(NEWS.CORRUPTION, {});
        break;
      case ACTION.FLG_DEAL_OLD_STOCK:
        this.oldStockDeal = true;
        break;
      case ACTION.BAR_SEARCH_COMPONENT: {
        const rs = this.research[ws.index];
        if (!rs) break;
        const t = this.component(rs.cat, rs.L, rs.E);
        if (t?.state !== 2) break;
        t.progress += work;
        if (t.progress >= t.comp.SearchNeeded * S.AMOUNT_OF_WORK_PER_DAY) this.completeResearch(rs.cat, rs.L, rs.E);
        break;
      }
      case ACTION.BAR_ASSEMBLE_COMPONENTS: {
        if (!this.hasProduct || this.lineChanged) break;
        let units = S.PRODUCTION_MULTIPLICATOR * work;
        if (work > 0 && this.target - units < 10) units = this.target;
        ws.integrity -= wear();
        this.book(this.unitCost * units, BOOK.COMPONENTS);
        this.unitsThisLoop = units;
        this.produced += units;
        this.stock += units;
        this.line.forEach((l, i) => {
          if (l.provider >= 0) {
            const owner = this.sim.patentOwner(i, l.L, l.E);
            if (owner >= 0 && owner !== this.slot) this.book(this.unitPrice(i), BOOK.COMPONENTS);
          }
        });
        break;
      }
      case ACTION.BAR_MANUFACTURE_COMPONENT:
        ws.integrity -= wear();
        break;
      case ACTION.BAR_MAINTAIN_MACHINE:
        ws.integrity += trunc((S.MAX_MACHINE_MAINTAINING_PER_LOOP * r) / 100);
        break;
      case ACTION.BTN_REPAIR_MACHINE:
        ws.broken = false;
        ws.integrity = S.FULL_INTEGRITY;
        this.news(ws.index === 9 ? NEWS.CHIEF_REPAIRED : NEWS.DRIVER_REPAIRED, { ws: ws.index });
        break;
      case ACTION.BAR_CONTROL_ADMIN_AND_MARK:
        (this.guardWorkNext ??= {}).admin = work;
        break;
      case ACTION.BAR_CONTROL_PRODUCTION:
        (this.guardWorkNext ??= {}).prod = work;
        break;
      case ACTION.BAR_CONTROL_LABORATORY:
        (this.guardWorkNext ??= {}).labo = work;
        break;
      case ACTION.BTN_STEAL_PATENT:
      case ACTION.BTN_SABOTAGE_PRODUCTION:
      case ACTION.BTN_SPY_ADMIN_AND_MARK:
        this.illegal.add(S.SPY_ACTION_ILLEGALITY_COST);
        this.sim.spyAction(this, id, params.target, ws);
        break;
      case ACTION.BTN_THREATEN_ADMIN_AND_MARK_WORKER:
      case ACTION.BTN_THREATEN_PRODUCTION_WORKER:
      case ACTION.BTN_THREATEN_LABORATORY_WORKER:
      case ACTION.BTN_THREATEN_SPECIAL_WORKER:
        this.illegal.add(S.MAFIOSI_ACTION_ILLEGALITY_COST);
        this.sim.threaten(this, id, params.target, ws);
        break;
      default:
        break;
    }
  }

  // Temporary sector influence (motivation +, threats -), reverted after `duration` work units (≈ days*1000).
  sectorInfluence(sector, key, amount, duration) {
    for (const i of SECTOR_WS[sector]) {
      this.workstations[i].infl[key] += amount;
      this.workstations[i].computeSpirit();
    }
    const days = Math.round(duration / this.setup.AMOUNT_OF_WORK_PER_DAY);
    this.sim.schedule(this, days, { kind: 'influence', sector, key, amount: -amount });
  }

  // Delayed check from a low-morale news: the worker resigns if still unhappy (News.ini effect 3 -> news 119).
  spiritCheck(wsIndex, workerIndex) {
    const ws = this.workstations[wsIndex];
    if (ws.worker?.index === workerIndex && ws.spirit < this.setup.CHECK__WORKER_SPIRIT_LOW) {
      this.news(NEWS.RESIGNATION, { ws: wsIndex, worker: ws.worker });
      this.fire(wsIndex);
    } else ws.lowSpiritNotified = false;
  }

  completeResearch(cat, L, E) {
    const t = this.component(cat, L, E);
    t.state = 3;
    for (const [ws, r] of Object.entries(this.research)) if (r.cat === cat && r.L === L && r.E === E) delete this.research[ws];
    this.updateAvailability();
    this.sim.onResearched(this, cat, L, E);
  }

  // ------------------------------------------------------------------------------------------------
  // Simulation steps

  // Automatic bars for production workstations [C 0x45b660].
  productionBars() {
    const S = this.setup;
    const prodBars = (ws) => {
      if (!ws.productivity) return [0, 100];
      let a = idiv(100 * 100 * this.target, ws.productivity * S.MAX_PRODUCTION_BAR_VALUE);
      if (this.target > 0 && a === 0) a = 1;
      return [a, a > 100 ? 0 : 100 - a];
    };
    const complete = this.lineComplete();
    const set = (ws, a, m) => { ws.bars[0].effective = a; ws.bars[1].effective = m; };
    // Components above the chief's / driver's level drop out of the line [C 0x45b1f0].
    const chief = this.workstations[9];
    // (Only evaluated for workstations with a worker seated, as the per-workstation update does.)
    this.line.forEach((l, i) => {
      if (!l) return;
      const driver = this.workstations[10 + i];
      if ((chief.worker && l.L >= chief.level) || (l.provider < 0 && driver.worker && l.L >= driver.level)) this.clearLine(i);
    });
    const handle = (ws, inHouse) => {
      if (ws.activeButton >= 0) return;
      if (ws.broken) { set(ws, 0, 0); this.autoRepair(ws); return; }
      if (!complete) { set(ws, 0, 100); return; }
      if (inHouse) { const [a, m] = prodBars(ws); set(ws, a, m); } else set(ws, 0, 100);
    };
    handle(chief, true);
    for (let i = 0; i < 4; i++) {
      const ws = this.workstations[10 + i];
      if (i >= this.tech.length) continue;
      handle(ws, this.line[i] ? this.line[i].provider < 0 : false);
    }
  }

  autoRepair(ws) {
    if (ws.activeButton >= 0 || !ws.worker) return;
    const i = ws.buttons.findIndex((b) => b.id === ACTION.BTN_REPAIR_MACHINE);
    if (i >= 0) ws.launchButton(ACTION.BTN_REPAIR_MACHINE);
  }

  // Per loop (C 0x457cb0 order): sales applied by the simulation first, then finance, workstations, loans.
  beginLoop() {
    this.ledger.fill(0);
  }

  loop() {
    const S = this.setup;
    const L = S.NUMBER_OF_SIM_LOOPS_PER_DAY;
    this.guardWork = this.guardWorkNext ?? { admin: 0, prod: 0, labo: 0 };
    this.guardWorkNext = { admin: 0, prod: 0, labo: 0 };
    this.sim.payRoyalties(this);
    this.book(idiv(this.tvMonthly, 30 * L), BOOK.TV);
    this.book(idiv(this.pressMonthly, 30 * L), BOOK.PRESS);
    if (this.lineChanged) this.handleOldStock();
    this.lineChanged = false;
    this.unitsThisLoop = 0;
    // Workstations: actions, productivity, production bars, break checks.
    this.productionBars();
    for (const ws of this.workstations) {
      ws.peakProductivity = ws.productivity;
      ws.updateProductivity();
      if (ws.job === JOB.SEARCHER && this.research[ws.index]) {
        const r = this.research[ws.index];
        if (ws.level <= r.L || !ws.worker) this.stopResearch(ws.index);
      }
      ws.fireActions();
      if (ws.worker) {
        // Payroll: monthly salary spread per loop; spy & mafioso salaries count as illegal points.
        this.book(idiv(ws.worker.salary, 30 * L), BOOK.SALARIES);
        if (ws.index === 15 || ws.index === 16) this.illegal.add(idiv(ws.worker.salary, 10 * L));
      }
      if (ws.training !== -1) {
        ws.trainingWork -= S.AMOUNT_OF_WORK_PER_SIM_LOOP;
        if (ws.trainingWork <= 0) this.finishTraining(ws);
      }
      if (ws.pointActionTimer > 0) ws.pointActionTimer--;
    }
    for (let i = 9; i <= 9 + this.tech.length && i < 14; i++) {
      const ws = this.workstations[i];
      if (ws.deskLevel <= 0) continue;
      ws.integrity = clamp(ws.integrity, 0, S.FULL_INTEGRITY);
      if (ws.integrity < S.LEVEL_OF_INTEGRITY_WHEN_BREAKING && !ws.broken) {
        ws.broken = true;
        this.news(NEWS.MACHINE_BROKEN, { ws: i });
      }
    }
    this.populateCVs();
    for (const k of Object.keys(this.construction)) if (--this.construction[k] <= 0) delete this.construction[k];
    // Share price [C 0x443030]: in practice (trade balance - debt) * 1.6384e-4.
    const u = Math.min(this.unitsThisLoop, 2000);
    const w = clamp(this.balance - this.debt, 0, 200000000);
    this.sharePrice = trunc(0.5 * (u * 65535 * 0.0005 + w * 65535 * 5e-9));
  }

  endLoop() {
    for (let c = 0; c < 16; c++) this.ledgerDay[c] += this.ledger[c];
    this.history.cash.push(this.cash);
    if (this.history.cash.length > 200) this.history.cash.shift();
  }

  // CV list population [C 0x45d820]: unemployed workers appear over time (faster with HR work);
  // employed ones only through the "corrupt external workers" bar.
  populateCVs() {
    const S = this.setup;
    const drh = this.workstations[2];
    const drhWork = this.drhWork ?? 0;
    const corruptWork = this.corruptWork ?? 0;
    this.drhWork = 0;
    this.corruptWork = 0;
    this.cvProgress ??= new Map();
    for (const w of this.sim.workers) {
      if (w.owner === this.slot) continue;
      const listed = this.workstations.some((ws) => ws.job === w.JobType && ws.cv.includes(w.index));
      if (listed) continue;
      let progress;
      if (w.owner === -1) progress = drhWork + S.DEFAULT_TIME_SPEND_ON_POPULATING_CV;
      else {
        const lvl = Math.min(w.level, 3);
        progress = drh.worker && drh.level >= lvl && this.poachPrice(w) !== -1
          ? idiv(corruptWork * (100 + idiv(w.spirit * (S.MIN_DRH_EFFECT_ON_CORRUPTION - 100), S.FULL_SPIRIT)), 100) : 0;
      }
      if (w.JobType === JOB.SPY && !this.flags.blackOps) progress = 0;
      if (w.JobType === JOB.MAFIOSI && !(this.flags.blackOps && this.flags.mafia)) progress = 0;
      if (!progress) continue;
      const p = (this.cvProgress.get(w.index) ?? 0) + progress;
      if (p >= 2 * S.AMOUNT_OF_WORK_PER_DAY) {
        this.cvProgress.delete(w.index);
        for (const ws of this.workstations) if (ws.job === w.JobType && !ws.cv.includes(w.index)) ws.cv.push(w.index);
      } else this.cvProgress.set(w.index, p);
    }
    // Drop CVs of workers who were hired elsewhere and can no longer be poached.
    for (const ws of this.workstations) {
      ws.cv = ws.cv.filter((id) => {
        const w = this.sim.workers[id];
        return w.owner !== this.slot && (w.owner === -1 || this.poachPrice(w) !== -1);
      });
    }
  }

  // Per day (C 0x443130 / 0x4497d0).
  day() {
    const S = this.setup;
    const L = S.NUMBER_OF_SIM_LOOPS_PER_DAY;
    // Payment delays.
    const s1 = idiv(idiv(this.delayWork, L) + this.delaySmooth, 2);
    this.delaySmooth = s1;
    this.delayWork = 0;
    this.payDelayDays = idiv(s1 * S.MAX_DELAY_MONEY, S.AMOUNT_OF_WORK_PER_SIM_LOOP);
    // Loan instalment.
    if (this.debtDays > 0) {
      const pay = idiv(this.debt, this.debtDays);
      this.book(pay, BOOK.LOAN_REPAY);
      this.debt -= pay;
      this.debtDays--;
    }
    // Histories, illegality and fiscal risk.
    this.cash += this.deferred.advance();
    this.deferred.sum = 0;
    const illegal = Math.max(0, this.illegal.advance());
    this.illegalPoints = illegal;
    this.fiscalRisk = illegal > S.MAX_ILLEGAL_POINTS_THRESHOLD ? S.MAX_FISCAL_RISK : idiv(illegal * S.MAX_FISCAL_RISK, S.MAX_ILLEGAL_POINTS_THRESHOLD);
    this.slander.advance();
    this.presenceHist.advance();
    this.corruptionHist.advance();
    this.negotiateHist.advance();
    // Notoriety [C 0x443af0]: building quality, slander, the moon concession.
    const walls = [0, 4, 8, 12].reduce((a, t) => a + this.objects[t], 0);
    const wallMax = [0, 4, 8, 12].reduce((a, t) => a + this.maxObjectLevel(t), 0) || 1;
    this.notoriety = Math.max(0, idiv(40 * walls, wallMax) - 10 * this.slander.sum + 15 + (this.moon ? 45 : 0));
    // Product image [C 0x443bd0].
    this.image = Math.min(S.FULL_IMAGE_PRODUCT, (this.corruption > 0 ? 30 : 0)
      + idiv(this.presence * 40, S.HISTORY_DAY * S.AMOUNT_OF_WORK_PER_DAY) + (this.zeppelin ? 30 : 0) + this.newsImage);
    // Daily account totals (rolling 30 days, shown in the account book).
    for (let c = 0; c < 16; c++) {
      this.monthHist[c].add(this.ledgerDay[c]);
      this.ledgerMonth[c] = this.monthHist[c].advance();
      this.ledgerDay[c] = 0;
    }
    if (this.sim.day % 10 === 0) {
      this.statsHistory.push({ day: this.sim.day, sales: this.ledgerMonth[BOOK.SALES], patents: this.ledgerMonth[BOOK.PATENTS],
        misc: this.ledgerMonth[BOOK.LOAN] + this.ledgerMonth[BOOK.TRIALS], balance: this.bottomLine,
        components: this.ledgerMonth[BOOK.COMPONENTS], salaries: this.ledgerMonth[BOOK.SALARIES],
        pub: this.ledgerMonth[BOOK.TV] + this.ledgerMonth[BOOK.PRESS], other: this.totalDebits() - this.ledgerMonth[BOOK.COMPONENTS] - this.ledgerMonth[BOOK.SALARIES] - this.ledgerMonth[BOOK.TV] - this.ledgerMonth[BOOK.PRESS] });
    }
  }

  totalDebits() { return this.ledgerMonth.slice(0, DEBITS).reduce((a, b) => a + b, 0); }
  totalCredits() { return this.ledgerMonth.slice(DEBITS).reduce((a, b) => a + b, 0); }

  // Sales from the market this loop (C 0x449a70 / 0x444460): revenue = units x product price.
  applySales(r) {
    const units = r.soldE + r.soldT;
    this.stock = Math.max(0, this.stock - units);
    this.soldE += r.soldE;
    this.soldT += r.soldT;
    this.soldTotal += units;
    this.lastSales = { E: r.soldE, T: r.soldT };
    this.noteE = r.noteE;
    this.noteT = r.noteT;
    this.book(units * this.price, BOOK.SALES);
  }

  // ------------------------------------------------------------------------------------------------
  // Loans (C 0x447d40 / 0x4482d0 / 0x4445e0)

  loanOffers(amount) {
    const S = this.setup;
    if (amount < this.debt) return [];
    const offers = [];
    for (const c of this.sim.creditors) {
      if (!this.flags.mafia && c.CreditorType === 2) continue;
      if (amount < c.MinMoney || amount > c.MaxMoney) continue;
      const t = c.MaxMoney === c.MinMoney ? 0 : (amount - c.MinMoney) / (c.MaxMoney - c.MinMoney);
      let rate = trunc(Math.max(c.MinInterestRate + (c.rateDelta ?? 0), 1) * (1 - t) + Math.max(c.MaxInterestRate + (c.rateDelta ?? 0), 1) * t);
      let days = trunc(c.MinRefundTime * (1 - t) + c.MaxRefundTime * t);
      if (c.CreditorType !== 0) {
        days = idiv(days * (100 - S.MAX_REFUND_TIME_INFLUENCE), 100) + idiv(S.MAX_REFUND_TIME_INFLUENCE * days * this.notoriety, 50 * S.FULL_NOTORIETY);
        rate = idiv(rate * (100 + S.MAX_INTEREST_RATE_INFLUENCE), 100);
      }
      days = Math.min(days, S.MAX_REFUND_TIME_ALLOWED);
      if (rate <= S.MAX_INTEREST_RATE_ALLOWED) offers.push({ creditor: c, name: c.name, rate, days, amount });
    }
    return offers;
  }

  takeLoan(offer) {
    this.book(offer.amount - this.debt, BOOK.LOAN);
    this.debt = idiv(offer.amount * (100 + offer.rate), 100);
    this.debtDays = offer.days;
  }

  // ------------------------------------------------------------------------------------------------
  // News

  news(id, params = {}, opts = {}) {
    return this.sim.newsEngine.post(this, id, params, opts);
  }
}
