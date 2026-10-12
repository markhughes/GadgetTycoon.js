// Computer-controlled companies (CrazyFactoryServer.exe cIAPlayer / brain; docs/simulation.md §AI).
//
// The original evaluates a data-driven need/effort decision graph (LEVEL01/Ia/*.ini, ~450 native functions)
// once per sim loop and executes at most one discrete action whose need/effort beats NEED_DO_NOTHING.
// This controller keeps that contract and the personality constants (IADef01..08) but evaluates a
// hand-written set of candidate actions mirroring the graph's modules instead of interpreting the INI graph:
//  * exact ports: production quantity & sale price (EntretienVSProd 0x41e1f0), pub budgets (0x41f7e0/0x41f8a0),
//    cost efforts (costToEffort 0x41ece0), enemy points / targeting (0x41ff40, 0x41fc50);
//  * approximations: staffing / desk / research / product / loan / firing / attack modules.
import { JOB, ACTION } from './data.js';

const INF = 1e7;
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

// Workstation order in which a fresh company staffs up (the Start*.ini modules).
const STAFF_ORDER = [9, 10, 11, 12, 13, 5, 2, 3, 4, 1, 0, 6, 7, 8, 14, 15, 16];
const FIRE_PRIORITY = { 9: 1, 10: 2, 11: 2, 12: 2, 13: 2, 14: 3, 2: 4, 5: 5, 16: 6, 3: 7, 4: 8, 1: 9, 0: 10, 15: 11, 6: 12, 7: 13, 8: 14 };

export class AIController {
  constructor(sim, company, personality, defsList, conspiratorial) {
    this.sim = sim;
    this.c = company;
    this.personality = personality; // 0..7 (7 = Inactive)
    this.D = defsList[personality] ?? {};
    this.conspiratorial = conspiratorial;
    this.nme = new Array(8).fill(0);
    this.fiscalPts = new Array(8).fill(0);
    this.courtNeed = 0;
    this.motiv = [0, 0, 0, 0];
    this.sales = [0, 0, 0];
    this.startProdNeed = 0;
    this.keep = [];
    this.thinks = 0;
    company.aiType = personality;
  }

  d(key, def = 0) { return num(this.D[key], def); }

  // costToEffort [0x41ece0]: a purchase's effort is its share of current cash x 1e7.
  costToEffort(price) {
    const t = this.c.cash;
    return t <= 0 ? INF : (price * this.d('EFFORT_CAISSE_MULT', 1) * 1e7) / t;
  }

  think() {
    if (this.personality === 7) { this.pubBudgets(); return; } // Inactive: never acts
    this.thinks++;
    this.motiv = this.motiv.map((m) => Math.max(0, m - Math.min(1, m)));
    this.courtNeed = Math.max(0, this.courtNeed - Math.min(1, this.courtNeed));
    if (this.c.production.running) { this.sales.shift(); this.sales.push(this.c.lastSales.E + this.c.lastSales.T); }
    this.keep = this.keep.map((k) => Math.max(0, k - 1));
    const best = this.chooseAction();
    if (best) best.run();
    this.pubBudgets();
    this.timeShares();
    this.productionManager();
  }

  // ------------------------------------------------------------------------------------------------
  // Native managers

  // EntretienVSProd [0x41e1f0]: production target from recent sales and stock; price between cost-plus and 3x.
  productionManager() {
    const c = this.c;
    const minStock = this.d('IA_STOCK_MINIMUM', 50);
    if (!c.hasProduct) {
      c.target = 0;
      this.startProdNeed += this.d('NEED_START_PRODUCTION', 1e5);
      return;
    }
    const recent = this.sales[0] + this.sales[1] + this.sales[2];
    const target = Math.max(minStock, recent);
    if (target > c.stock && c.lineComplete()) {
      const q = Math.trunc(target / 3);
      c.target = Math.min(c.setup.MAX_PRODUCTION_BAR_VALUE, q + 20);
      const periodic = (c.ledgerMonth[0] + c.ledgerMonth[5] + c.ledgerMonth[6]) / 60;
      const overhead = q ? periodic / q : 0;
      const a = 20 + c.unitCost;
      const b = c.line.reduce((s, l, i) => s + (l ? c.component(i, l.L, l.E).comp.Price : 0), 0);
      const cheap = this.personality === 3 || this.personality === 6; // General Public / Discount
      const DEFAULT = Math.min((3 * b + a + overhead) / 2, 3 * b);
      const price = cheap ? Math.min(a + overhead, 3 * b) : DEFAULT;
      c.price = Math.max(c.unitCost + 10, Math.min(c.setup.MAX_PRICE, Math.round(price / 10) * 10));
    } else c.target = 0;
    this.startProdNeed = c.lineComplete() ? 0 : this.startProdNeed + this.d('NEED_START_PRODUCTION', 1e5);
  }

  // Pub budgets [0x41f7e0 / 0x41f8a0].
  pubBudgets() {
    const c = this.c;
    const S = c.setup;
    const seg = (k) => this.sim.market?.[k]?.flow || 1;
    const cap = (pct) => Math.min((c.cash * pct) / 100, S.MAX_PUB_BUDGET);
    const techno = c.levelsEvos();
    const tech = this.sim.market ? this.sim.market.techLevel(techno.levels, techno.evos) : 0;
    const design = this.sim.market ? this.sim.market.designLevel(techno.levels, techno.evos) : 0;
    const press = ((tech + this.d('PUB_MIN_TECHNO_CONCERNED')) * cap(this.d('PUB_BUDGET_TECHNO_PERCENT'))) / seg('T');
    const tv = ((design + this.d('PUB_MIN_EMOTIVES_CONCERNED')) * cap(this.d('PUB_BUDGET_EMOTIVES_PERCENT'))) / seg('E');
    const step = S.PUB_BUDGET_INCREMENT;
    c.pressMonthly = c.hasProduct ? Math.max(0, Math.min(S.MAX_PUB_BUDGET, Math.round(press / step) * step)) : 0;
    c.tvMonthly = c.hasProduct ? Math.max(0, Math.min(S.MAX_PUB_BUDGET, Math.round(tv / step) * step)) : 0;
  }

  // Department time shares (TimerConflictors): split each department's bars by need.
  timeShares() {
    const c = this.c;
    const fin = c.workstations[1];
    if (fin.worker) {
      const delay = this.d('NEED_FIN_DELAY', 1);
      const regul = (c.fiscalRisk + 1) * this.d('NEED_LOW_FISCAL_RISK_MULTIPLICATOR', 1);
      const total = delay + regul + 1;
      fin.setBar(0, (100 * regul) / total);
      fin.setBar(1, (100 * delay) / total);
    }
    const drh = c.workstations[2];
    if (drh.worker) drh.setBar(0, this.needCV() > 0 ? 80 : 30);
    const pub = c.workstations[3];
    if (pub.worker) pub.setBar(0, 50);
    const com = c.workstations[4];
    if (com.worker) com.setBar(0, 40 + Math.min(40, this.d('NEED_NEGOCIATE_PRICE') / 20));
  }

  // ------------------------------------------------------------------------------------------------
  // Discrete actions: candidates { need, effort, run }; the best need/effort above NEED_DO_NOTHING wins.

  chooseAction() {
    const cands = [];
    const add = (need, effort, run, label) => { if (need > 0 && effort < INF) cands.push({ need, effort, run, label }); };
    this.staffing(add);
    this.research(add);
    this.product(add);
    this.hr(add);
    this.money(add);
    this.image(add);
    this.attacks(add);
    const threshold = this.d('NEED_DO_NOTHING', 0.1);
    let best = null, bestRatio = threshold;
    for (const x of cands) {
      if (x.effort === 0) return x;
      const r = x.need / x.effort;
      if (r > bestRatio) { best = x; bestRatio = r; }
    }
    return best;
  }

  // Start* modules: to use a department at level L you need a worker >= L and a desk >= L.
  staffing(add) {
    const c = this.c;
    const nCat = c.tech.length;
    const base = this.startProdNeed + 1000;
    const want = new Set([9, 5, 2, 4, 3]);
    for (let i = 0; i < nCat; i++) want.add(10 + i);
    if (this.d('NEED_FIN_DELAY') > 0 || c.cash < 300000) want.add(1);
    if (this.d('NEED_MULTIPLAYER_INTERACTIVE_FUN_SPECTACULAR_ACTIONS') >= 500 || this.courtNeed > 0) want.add(0);
    if (this.insecurity() > 0 || this.patentsOwned() > 1) want.add(14);
    if (c.flags.blackOps && this.d('NEED_MULTIPLAYER_INTERACTIVE_FUN_SPECTACULAR_ACTIONS') >= 500) want.add(15);
    if (c.flags.mafia && c.flags.blackOps && this.d('NEED_MULTIPLAYER_INTERACTIVE_FUN_SPECTACULAR_ACTIONS') >= 500) want.add(16);
    // Extra labs once research need passes NEED_STEP_FOR_NEW_WORKSTATION x N.
    const resNeed = this.researchNeed();
    for (let n = 1; n < 4; n++) if (resNeed >= n * this.d('NEED_STEP_FOR_NEW_WORKSTATION', 50000) / 10) want.add(5 + n);
    STAFF_ORDER.forEach((i, rank) => {
      if (!want.has(i)) return;
      const ws = c.workstations[i];
      const need = base / (1 + rank * 0.15);
      if (ws.deskLevel <= 0) {
        const d = c.desksFor(i).find((x) => x.Level === 1);
        if (d) add(need, this.costToEffort(d.Price), () => c.buyDesk(i, 1), `desk ${i}`);
        return;
      }
      if (!ws.worker) {
        const cand = this.bestCV(i);
        if (cand) {
          const sal = c.hirePrice(cand) + (cand.owner === -1 ? 0 : this.d('BONUS_DEBAUCHE'));
          add(need, this.costToEffort(sal * this.d('EFFORT_SALARY_MULT', 6)), () => c.hire(i, cand.index, sal), `hire ${i}`);
        }
      }
    });
  }

  bestCV(i) {
    const ws = this.c.workstations[i];
    const pool = ws.cv.map((id) => this.sim.workers[id]).filter((w) => w.owner === -1 || this.c.poachPrice(w) !== -1);
    if (!pool.length) return null;
    return pool.reduce((a, b) => ((b.level * 100 + b.BasicProductivity + b.BasicSpirit) > (a.level * 100 + a.BasicProductivity + a.BasicSpirit) ? b : a));
  }

  needCV() {
    const c = this.c;
    return c.workstations.filter((w) => !w.worker && w.deskLevel > 0 && !w.cv.length).length;
  }

  // Research targeting [need 4]: technology / design gaps, exclusivity, patents held by others.
  researchNeed() {
    const c = this.c;
    let total = 0;
    c.tech.forEach((cat) => cat.forEach((t) => { if (t.state === 1) total += 10; }));
    return total * (this.d('NEED_TECHNO_MULTIPLICATOR', 10) + this.d('NEED_DESIGN_MULTIPLICATOR', 10));
  }

  research(add) {
    const c = this.c;
    for (let i = 5; i <= 8; i++) {
      const ws = c.workstations[i];
      if (!ws.worker || c.research[i]) continue;
      let best = null, bestNeed = 0;
      c.tech.forEach((cat, ci) => cat.forEach((t) => {
        if (t.state !== 1 && t.state !== 2) return;
        if (t.comp.Level + 1 > ws.level) return;
        const owner = this.sim.patentOwner(ci, t.comp.Level, t.comp.Evolution);
        let need = Math.random() * 4 - ci
          + (t.comp.Evolution + 1) * this.d('NEED_DESIGN_MULTIPLICATOR', 10) + (t.comp.Level + 1) * this.d('NEED_TECHNO_MULTIPLICATOR', 10)
          + (owner === -1 ? this.d('NEED_EXCLUSIVE_COMPONENT') : 0) + (owner >= 0 && owner !== c.slot ? this.d('NEED_FREE_COMPONENT') : 0)
          + ([0, 5, 11].includes(this.sim.victoryType) ? this.d('NEED_VICTORY_TECHNO_TREE') : 0);
        need = Math.max(0, need);
        if (need > bestNeed) { bestNeed = need; best = { ci, t }; }
      }));
      if (best) add(this.d('NEED_SEARCH_UNUSED_LABO', 1e5), this.d('EPSILON_EFFORT', 1e-4), () => c.startResearch(i, best.ci, best.t.comp.Level, best.t.comp.Evolution), `research ${i}`);
      // Upgrade the lab desk when everything researchable needs a higher level.
      const blocked = c.tech.some((cat) => cat.some((t) => t.state === 1 && t.comp.Level + 1 > ws.level));
      if (blocked && ws.deskLevel < 4) {
        const d = c.desksFor(i).find((x) => x.Level === ws.deskLevel + 1);
        if (d) add(this.researchNeed() / 10, this.costToEffort(d.Price), () => c.buyDesk(i, ws.deskLevel + 1), `lab desk ${i}`);
      }
    }
    // Machines required by components.
    c.tech.forEach((cat) => cat.forEach((t) => {
      const m = t.comp.RequiredMachine;
      if (t.blocked && m >= 0 && !c.machines[m]) add(this.researchNeed() / 5, this.costToEffort(this.sim.data.techno.machines[m].Price), () => c.buyMachine(m), `machine ${m}`);
    }));
  }

  // Product line: best researched component per category, in-house if a driver can make it.
  product(add) {
    const c = this.c;
    const chief = c.workstations[9];
    if (!chief.worker) return;
    c.tech.forEach((cat, ci) => {
      if (this.keep[ci] > 0 && c.line[ci]) return;
      const driver = c.workstations[10 + ci];
      const options = cat.filter((t) => t.state === 3 && t.comp.Level < chief.level);
      if (!options.length) return;
      const score = (t) => t.comp.Level * this.d('NEED_TECHNO_MULTIPLICATOR', 10) + t.comp.Evolution * this.d('NEED_DESIGN_MULTIPLICATOR', 10);
      const best = options.reduce((a, b) => (score(b) > score(a) ? b : a));
      const inHouse = driver.worker && best.comp.Level < driver.level;
      const cur = c.line[ci];
      if (cur && cur.L === best.comp.Level && cur.E === best.comp.Evolution && (cur.provider < 0) === !!inHouse) return;
      const effort = inHouse ? this.costToEffort(best.comp.Price) : this.costToEffort(best.comp.Price * 2) * this.d('EFFORT_USE_PROVIDER_MULTIPLICATOR', 20) + this.d('EFFORT_USE_PROVIDER_BASIC', 7);
      add(this.startProdNeed + 1e4, Math.max(this.d('EPSILON_EFFORT', 1e-4), effort / 1e4), () => {
        c.setLine(ci, best.comp.Level, best.comp.Evolution, inHouse ? -1 : 0);
        this.keep[ci] = this.d('KEEP_COMPONENT_LOOPS', 10);
      }, `line ${ci}`);
    });
    // Machine desks: upgrade the chief / drivers when the line is limited by their level.
    for (const i of [9, 10, 11, 12, 13].slice(0, 1 + c.tech.length)) {
      const ws = c.workstations[i];
      if (!ws.worker || ws.deskLevel >= 4 || ws.deskLevel >= ws.worker.level) continue;
      const d = c.desksFor(i).find((x) => x.Level === ws.deskLevel + 1);
      if (d) add(this.startProdNeed / 4 + 100, this.costToEffort(d.Price) * 5, () => c.buyDesk(i, ws.deskLevel + 1), `prod desk ${i}`);
    }
  }

  // Spirit / efficiency / training.
  hr(add) {
    const c = this.c;
    const low = c.setup.CHECK__WORKER_SPIRIT_LOW;
    for (const ws of c.workstations) {
      if (!ws.worker) continue;
      const need = (ws.spirit < low ? (low - ws.spirit) * this.d('IA_NEED_SPIRIT_LOW', 50) : 0) + (100 - ws.spirit) * this.d('NEED_SPIRIT_AGAINST_DRH', 1);
      const ref = c.refSalary(ws.worker.JobType, ws.worker.level);
      if (ws.spirit < low + 10 && ws.worker.salary < 2 * ref) {
        const raise = Math.max(50, Math.round(((ws.worker.salary + ref) * 2) / 3 - ws.worker.salary));
        add(need, this.costToEffort(raise * this.d('EFFORT_SALARY_MULT', 6)), () => c.raiseSalary(ws.index, raise), `raise ${ws.index}`);
      }
      if (ws.training === -1 && c.workstations[2].worker) {
        const tp = this.costToEffort(c.setup.TRAINING_PRICE);
        if (ws.spirit < 90) add(need, tp + (ws.spirit / 100) * this.d('EFFORT_SPIRIT_TRAIN', 1000), () => c.startTraining(ws.index, 2), `train spirit ${ws.index}`);
        if (ws.worker.level < ws.worker.LevelMax && ws.deskLevel > ws.worker.level) add(this.researchNeed() / 20 + 10, tp + this.d('BASIC_EFFORT_TRAIN_LEVEL', 1e4), () => c.startTraining(ws.index, 0), `train level ${ws.index}`);
      }
    }
  }

  // Loans [need 46, effort 216] and crisis firing [need 47].
  money(add) {
    const c = this.c;
    const base = this.d('LOAN_BASIC_VALUE', 8000);
    for (let i = 0; i < 4; i++) {
      const want = base * 10 ** i;
      const need = Math.max(0, (want - c.bottomLine) * this.d('NEED_LOAN_TRESHOLD_MULTIPLICATOR', 0.001));
      if (!need || want <= c.debt) continue;
      const offers = c.loanOffers(want).filter((o) => o.rate < this.d('LOAN_MAXIMUM_RATE', 11));
      if (!offers.length) continue;
      const o = offers.reduce((a, b) => (b.rate < a.rate ? b : a));
      add(need, ((o.rate * want) / o.days) * this.d('NEED_LOAN_TRESHOLD_MULTIPLICATOR', 0.001) * 100, () => c.takeLoan(o), `loan ${want}`);
    }
    const lowT = this.d('IA_TREASURY_LOW', 10000);
    if (c.cash < lowT) {
      const need = (lowT - c.cash) * this.d('NEED_TREASURY_LOW', 500);
      for (const ws of c.workstations) {
        if (!ws.worker) continue;
        const sev = c.refSalary(ws.worker.JobType, ws.worker.level);
        if (sev > c.cash + 1e6) continue;
        add(need, FIRE_PRIORITY[ws.index] ?? 10, () => c.fire(ws.index), `fire ${ws.index}`);
      }
    }
  }

  // Notoriety (walls) and image (presence / zeppelin), security objects.
  image(add) {
    const c = this.c;
    const notNeed = Math.max(0, this.d('IA_WANTED_NOTORIETY') - c.notoriety);
    for (let dept = 0; dept < 4; dept++) {
      const type = dept * 4;
      const lvl = c.objects[type];
      const e = c.objectEntry(type, lvl + 1);
      if (e && notNeed > 0) add(notNeed, this.costToEffort(e.Price), () => c.buyObject(type, lvl + 1), `wall ${dept}`);
      for (const k of [2, 3]) {
        const t2 = dept * 4 + k;
        const e2 = c.objectEntry(t2, c.objects[t2] + 1);
        const wsOfDept = c.workstations.filter((w) => w.worker && [1, 1, 1, 0, 0, 2, 2, 2, 2, 3, 3, 3, 3, 3, -1, -1, -1][w.index] === dept);
        if (e2 && wsOfDept.length) add(wsOfDept.length * 20, this.costToEffort(e2.Price), () => c.buyObject(t2, c.objects[t2] + 1), `object ${t2}`);
      }
    }
    const imgNeed = Math.max(0, this.d('IA_WANTED_IMAGE') - c.image) * this.d('NEED_IMAGE_MULTIPLICATOR', 1);
    const pub = c.workstations[3];
    if (imgNeed > 0 && pub.worker && pub.level >= 2 && !c.zeppelin) add(imgNeed, this.costToEffort(c.data.actions[ACTION.FLG_GET_ZEPPELIN].Price), () => this.launch(3, ACTION.FLG_GET_ZEPPELIN), 'zeppelin');
    if (pub.worker && pub.level >= 3 && this.sim.moon.owner === -1) add(this.c.soldT * this.d('NEED_PUB_TECHNOIDS_MULTIPLICATOR', 1) + 1, this.costToEffort(c.data.actions[ACTION.FLG_GET_MOON_CONCESSION].Price), () => this.launch(3, ACTION.FLG_GET_MOON_CONCESSION), 'moon');
    // Security against observed enemies.
    const insec = this.insecurity();
    if (insec > 0) {
      for (const type of [5, 9, 13]) {
        const e = c.objectEntry(type, c.objects[type] + 1);
        if (e) add(insec + this.d('NEED_SECU_ALL_BASIC', 0.001), this.costToEffort(e.Price), () => c.buyObject(type, c.objects[type] + 1), `alarm ${type}`);
      }
    }
  }

  launch(ws, actionId, params) {
    this.c.pendingParams = params ?? null;
    return this.c.workstations[ws].launchButton(actionId);
  }

  // ------------------------------------------------------------------------------------------------
  // Multiplayer aggression [0x41ff40 / 0x41fc50]

  validEnemies() {
    return this.sim.alive.filter((o) => o !== this.c && !(this.conspiratorial && !o.isPlayer));
  }

  pickTarget(fiscal = false) {
    const base = this.d('BASIC_ENEMY_LEVEL');
    const list = this.validEnemies().map((o) => ({ o, w: fiscal ? (this.fiscalPts[o.slot] > 0 ? Math.max(0, this.fiscalPts[o.slot] + this.nme[o.slot] + base) : 0) : this.nme[o.slot] + base }))
      .filter((x) => x.w > 0);
    const total = list.reduce((a, x) => a + x.w, 0);
    if (!total) return null;
    let r = Math.random() * total;
    for (const x of list) { r -= x.w; if (r <= 0) return x.o; }
    return list[list.length - 1].o;
  }

  insecurity() {
    return this.nme.reduce((a, n, i) => a + (i === this.c.slot ? 0 : n), 0) * this.d('NEED_INSECURITY_ACTIVITY_MULTIPLICATOR', 1);
  }

  patentsOwned() { return this.c.patentsOwned; }

  attacks(add) {
    const c = this.c;
    const fun = this.d('NEED_MULTIPLAYER_INTERACTIVE_FUN_SPECTACULAR_ACTIONS') + this.nme.reduce((a, b) => a + b, 0) + this.fiscalPts.reduce((a, b) => a + b, 0);
    const illegal = (cost) => 1 + this.d('EFFORT_ILLEGALITY_MULTIPLICATOR') * cost;
    const S = c.setup;
    const act = (ws, id, extra = {}) => {
      const a = c.data.actions[id];
      return this.costToEffort(a.Price) + illegal(extra.illegality ?? 0);
    };
    const fin = c.workstations[1];
    if (fin.worker && !c.flags.blackOps && fin.level >= 2 && fun >= 500) add(fun, act(1, ACTION.FLG_BLACK_OPS, { illegality: S.BLACK_OPS_ILLEGALITY_COST }), () => this.launch(1, ACTION.FLG_BLACK_OPS), 'black ops');
    if (fin.worker && c.flags.blackOps && !c.flags.mafia && fin.level >= 3 && fun >= 500) add(fun, act(1, ACTION.FLG_CONTACT_MAFIA, { illegality: S.MAFIA_CONTACT_ILLEGALITY_COST }), () => this.launch(1, ACTION.FLG_CONTACT_MAFIA), 'mafia');
    const spy = c.workstations[15];
    if (spy.worker && spy.activeButton < 0) {
      const t = this.pickTarget();
      if (t) {
        const steal = this.validEnemies().length ? this.d('NEED_STEAL_BY_PATENT') * (t.patentsOwned || 0.1) : 0;
        add(fun / 3 + steal, act(15, ACTION.BTN_STEAL_PATENT, { illegality: S.SPY_ACTION_ILLEGALITY_COST }), () => this.launch(15, ACTION.BTN_STEAL_PATENT, { target: t.slot }), 'steal');
        add(fun / 3, act(15, ACTION.BTN_SABOTAGE_PRODUCTION, { illegality: S.SPY_ACTION_ILLEGALITY_COST }), () => this.launch(15, ACTION.BTN_SABOTAGE_PRODUCTION, { target: t.slot }), 'sabotage');
      }
    }
    const maf = c.workstations[16];
    if (maf.worker && maf.activeButton < 0) {
      const t = this.pickTarget();
      if (t) {
        const id = [ACTION.BTN_THREATEN_PRODUCTION_WORKER, ACTION.BTN_THREATEN_LABORATORY_WORKER, ACTION.BTN_THREATEN_ADMIN_AND_MARK_WORKER][Math.floor(Math.random() * 3)];
        add(fun / 3, act(16, id, { illegality: S.MAFIOSI_ACTION_ILLEGALITY_COST }), () => this.launch(16, id, { target: t.slot }), 'threaten');
      }
    }
    const law = c.workstations[0];
    if (law.worker && law.activeButton < 0) {
      if (this.courtNeed > 0) {
        const t = this.pickTarget(true) ?? this.pickTarget();
        if (t) add(this.courtNeed, act(0, ACTION.BTN_ESPIONAGE_TRIAL), () => this.launch(0, ACTION.BTN_ESPIONAGE_TRIAL, { target: t.slot }), 'trial');
      }
      const fpts = this.fiscalPts.reduce((a, b) => a + b, 0);
      if (fpts > 0 && law.level >= 3) add(fpts * 10, act(0, ACTION.BTN_LAUNCH_FISCAL_CONTROL) + c.fiscalRisk, () => this.launch(0, ACTION.BTN_LAUNCH_FISCAL_CONTROL), 'fiscal');
      if (law.level >= 2 && fun >= 500) {
        const t = this.pickTarget();
        if (t) add(fun / 4, act(0, ACTION.BTN_SLANDER_SOCIETY, { illegality: S.SLANDER_ILLEGALITY_COST }), () => this.launch(0, ACTION.BTN_SLANDER_SOCIETY, { target: t.slot }), 'slander');
      }
    }
  }

  // Enemy points [0x41ff40]: every attack anywhere updates hatred and fiscal suspicion.
  onAttack(kind, source, target, sector) {
    if (source === this.c) return;
    if (this.conspiratorial && !source.isPlayer) return;
    let pts = 0;
    if (kind === 'court') pts = this.d('NME_POINTS_FOR_COURT');
    if (kind === 'rumour') { this.fiscalPts[source.slot] += this.d('FISCAL_POINTS_FOR_RUMOUR'); pts = this.d('NME_POINTS_FOR_RUMOUR'); }
    if (kind === 'spy') { this.fiscalPts[source.slot] += this.d('FISCAL_POINTS_FOR_SPY'); pts = this.d('NME_POINTS_FOR_SPY'); }
    if (kind === 'mafia') {
      this.fiscalPts[source.slot] += this.d('FISCAL_POINTS_FOR_MAFIOSI');
      pts = this.d('NME_POINTS_FOR_MAFIOSI');
      const g = { ADMIN_MARK: 0, PROD: 1, LABO: 2, SPECIALS: 3 }[sector] ?? 0;
      if (target === this.c) this.motiv[g] += this.d('NEED_MOTIV_TRHEATEN');
    }
    if (target === this.c && (kind === 'spy' || kind === 'mafia')) this.courtNeed += this.d('NEED_COURT_FOR_ATTACK');
    let rel = 0;
    if (target === this.c) rel = this.d('NME_POINTS_FOR_PERSONAL_ATTACK');
    else if (this.nme[source.slot] < this.nme[target.slot]) rel = this.d('NME_POINTS_FOR_ALLY_ATTACK');
    else if (this.nme[source.slot] > this.nme[target.slot]) rel = this.d('NME_POINTS_FOR_NME_ATTACK');
    this.nme[source.slot] = Math.max(0, this.nme[source.slot] + pts * rel);
  }
}

void JOB;
