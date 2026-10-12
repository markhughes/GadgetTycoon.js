// The whole simulation in one process: what the original split between GadgetTycoon.exe (player company)
// and CrazyFactoryServer.exe (market, AI companies, inter-company actions, news server). docs/simulation.md.
import { Market } from './market.js';
import { NewsEngine } from './news.js';
import { Company, BOOK, NEWS, SECTOR_WS } from './company.js';
import { ACTION, listText } from './data.js';

const idiv = (a, b) => (b ? Math.trunc(a / b) : 0);
const JOB_KEYS = ['ACCOUNTANT', 'FINANCIER', 'MANAGER', 'SPY', 'PUB', 'COM', 'MAFIOSI', 'SEARCHER', 'DRIVER_CHIEF', 'DRIVER', 'GUARDIAN'];

export const AI_NAMES = ['Sanizex', 'HotSeat', 'TechPal', 'Yugaray', 'Scentico', 'Zebuco', 'Flushco', "Doonut'n", 'Ziroco', 'Tamito',
  'Tuptek', 'Wincey', 'SlapBang', 'Criptoe', 'Wrenty', 'Flacto', 'Plactec', 'Pantheo', 'Orleo', 'Monotik', 'Mintiko', 'Africor',
  'CrossCor', 'Ismery', 'Briskorp', 'USKOR', 'Spexor', 'Preterco', 'Attavix', 'Desikate', 'WeeKling', 'MyMax', 'Miksita', 'Quortix',
  'Dedloss', 'Jacaray', 'Costcorp', 'Aspekt', 'Hemisfia', 'Krypaya', 'Ibidem', 'She Hot', 'Distich', 'ByteWize', 'Isohyet',
  'Techtoid', 'FreeTek', 'Krotek', 'TechEst', 'HareRaze', 'GoFaze', "K'Boom", 'Robrich', 'LokStok', 'LaDida', 'Cheekery', 'Maksiko',
  'Sponty', 'Prectos', 'Fee See', 'Lo Down', 'Arabesk', 'Traget'];

// Starting money options (C 0x448f30): cash, debt, days.
export const START_MONEY = [[1000000, 0, 0], [500000, 0, 0], [250000, 0, 0], [100000, 0, 0], [0, 0, 0],
  [10000, 110000, 365], [25000, 275000, 365], [50000, 550000, 365], [100000, 1100000, 365]];

export class Simulation {
  constructor(data, { game = null, victoryType = 21 } = {}) {
    this.data = data;
    this.game = game;
    this.victoryType = victoryType;
    this.loop = 0;
    this.day = 0;
    this.clock = 0; // ms accumulated toward the next loop
    this.paused = false;
    this.companies = new Array(8).fill(null);
    this.playerSlot = 0;
    this.patents = new Map(); // `${cat},${L},${E}` -> owner (-1 none, -2 public)
    this.moon = { owner: -1, days: 0 };
    this.zeppelins = new Map(); // slot -> days left
    this.fiscal = { countdown: -1 };
    this.lastSpy = new Map(); // victim slot -> { spier, day }
    this.tasks = []; // { day, fn }
    this.salaryTable = { ...data.salary };
    this.creditors = data.creditors.map((c) => ({ ...c, name: listText(data, 'CreditorList', c.Name) }));
    this.workers = data.workers.map((w) => ({ ...w, level: w.Level, salary: 0, owner: -1, spirit: w.BasicSpirit }));
    this.newsEngine = new NewsEngine(this);
    this.result = null; // { won, code, reason }
    this.graph = []; // per-company objective progress samples
    this.messages = []; // short announcements for the HUD chat line
  }

  get player() { return this.companies[this.playerSlot]; }
  get alive() { return this.companies.filter((c) => c?.alive); }

  jobKey(job) { return `E_JOB_TYPE_${JOB_KEYS[job]}`; }
  workerName(w) { return listText(this.data, 'WorkerList', w.Name); }

  addCompany(slot, opts) {
    const c = new Company(this, slot, opts);
    this.companies[slot] = c;
    return c;
  }

  createMarket() {
    this.market = new Market(this.data, this.alive.length);
  }

  // Run in-game time. dtMs of real time; one sim loop every REAL_TIME_PER_SIM_LOOP ms.
  advance(dtMs) {
    if (this.paused || this.result) return;
    this.clock += dtMs;
    const step = this.data.setup.REAL_TIME_PER_SIM_LOOP;
    let n = 0;
    while (this.clock >= step && n < 10 && !this.result) {
      this.clock -= step;
      this.tick();
      n++;
    }
  }

  // One sim loop (server 0x43ebd0 + each company 0x43c3f0).
  tick() {
    const S = this.data.setup;
    this.loop++;
    for (const c of this.alive) c.beginLoop();
    // Market.
    const offers = this.companies.map((c, i) => {
      if (!c?.alive) return { id: i, active: false, stock: 0 };
      const { levels, evos } = c.levelsEvos();
      return {
        id: i, active: true, stock: c.hasProduct ? c.stock : 0, retailPrice: c.retailPrice, unitCost: c.unitCost,
        notoriety: c.notoriety, image: c.image, levels, evos, pressBudget: c.pressBudget, tvBudget: c.tvBudget,
        zeppelin: c.zeppelin, moon: c.moon,
      };
    });
    const res = this.market.computeSales(offers);
    for (const r of res.results) {
      const c = this.companies[r.id];
      if (c?.alive) c.applySales(r);
    }
    this.concessionsLoop();
    // Companies (AI decides first, like the server's think-before-update).
    for (const c of this.alive) c.ai?.think();
    for (const c of this.alive) c.loop();
    for (const c of this.alive) c.endLoop();
    this.updatePatents();
    this.newsEngine.perLoop();
    for (const c of this.alive) this.checkVictory(c);
    this.sampleGraph();
    if (this.loop % S.NUMBER_OF_SIM_LOOPS_PER_DAY === 0) this.dailyTick();
  }

  dailyTick() {
    this.day++;
    for (const c of this.alive) c.day();
    // Inflation of salaries every day by job group and desk prices every 2 days [C 0x4465a0].
    const groups = [[0, 1, 2], [9, 8], [7], [4, 5], [3, 6, 10], [], [], []][this.day % 8];
    for (const j of groups) {
      const k = this.jobKey(j);
      this.salaryTable[k] = Math.min(idiv(this.salaryTable[k] * 104, 100), 999999);
      for (const c of this.alive) c.workstations.filter((w) => w.job === j).forEach((w) => w.computeSpirit());
    }
    if (this.day % 2 === 0) for (const d of this.data.desktops) d.Price = Math.min(idiv(d.Price * 101, 100), 999999);
    this.newsEngine.daily();
    this.fiscalDaily();
    this.concessionsDaily();
    // Scheduled tasks (delayed news effects, end of motivation/threat, ...).
    const due = this.tasks.filter((t) => t.day <= this.day);
    this.tasks = this.tasks.filter((t) => t.day > this.day);
    for (const t of due) this.runTask(t);
  }

  // Delayed work is stored as plain data so games can be saved: { kind, ... } run by runTask().
  schedule(company, days, task) {
    this.tasks.push({ slot: company?.slot ?? -1, day: this.day + Math.max(1, Math.round(days)), task });
  }

  runTask({ slot, task }) {
    const c = this.companies[slot];
    if (slot >= 0 && !c?.alive) return;
    switch (task.kind) {
      case 'influence':
        for (const i of SECTOR_WS[task.sector]) { c.workstations[i].infl[task.key] += task.amount; c.workstations[i].computeSpirit(); }
        break;
      case 'newsImage': c.newsImage += task.amount; break;
      case 'spiritCheck': c.spiritCheck(task.ws, task.worker); break;
      case 'effect': this.newsEngine.runEffect(c, task.effect, { params: this.unref(task.params) }); break;
      default: break;
    }
  }

  // Object references inside news params are stored as { $company } / { $worker } for saving.
  ref(params) {
    const out = {};
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v && typeof v === 'object' && 'slot' in v && 'workstations' in v) out[k] = { $company: v.slot };
      else if (v && typeof v === 'object' && 'JobType' in v && 'owner' in v) out[k] = { $worker: v.index };
      else out[k] = v;
    }
    return out;
  }

  unref(params) {
    const out = {};
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v && typeof v === 'object' && '$company' in v) out[k] = this.companies[v.$company];
      else if (v && typeof v === 'object' && '$worker' in v) out[k] = this.workers[v.$worker];
      else out[k] = v;
    }
    return out;
  }

  announce(text) {
    this.messages.unshift({ text, time: performance.now() });
    if (this.messages.length > 6) this.messages.length = 6;
  }

  // ------------------------------------------------------------------------------------------------
  // Patents [S 0x40c700]: first company to finish a component owns the patent; a second one makes it public.

  patentOwner(cat, L, E) {
    return this.patents.get(`${cat},${L},${E}`) ?? -1;
  }

  updatePatents() {
    for (const c of this.alive) {
      c.tech.forEach((comps, cat) => comps.forEach((t) => {
        if (t.state !== 3) return;
        const key = `${cat},${t.comp.Level},${t.comp.Evolution}`;
        const owner = this.patents.get(key) ?? -1;
        if (owner === -2) return;
        if (owner === -1) {
          this.patents.set(key, c.slot);
          this.newsEngine.post(null, NEWS.PATENT_REPORT, { s1: c, c1: { cat, L: t.comp.Level, E: t.comp.Evolution } });
        } else if (owner !== c.slot) {
          this.patents.set(key, -2);
        }
      }));
    }
    for (const c of this.alive) c.patentsOwned = [...this.patents.values()].filter((o) => o === c.slot).length;
  }

  onResearched(c, cat, L, E) {
    // Patent assignment happens at the end of the loop (updatePatents).
    if (c.isPlayer) this.game?.sounds.play('INT_VALIDATE2');
  }

  // Royalties [C 0x443240]: price x units for every other company using our patented component,
  // plus BASIC_PATENT_INPUT_PER_LOOP per owned patent.
  payRoyalties(c) {
    const S = this.data.setup;
    for (const b of this.alive) {
      if (b === c) continue;
      b.line.forEach((l, cat) => {
        if (l && this.patentOwner(cat, l.L, l.E) === c.slot) c.book(b.component(cat, l.L, l.E).comp.Price * (b.lastSales.E + b.lastSales.T), BOOK.PATENTS);
      });
    }
    c.book(c.patentsOwned * S.BASIC_PATENT_INPUT_PER_LOOP, BOOK.PATENTS);
  }

  // ------------------------------------------------------------------------------------------------
  // Concessions [S 0x40f040 / 0x40f140]

  concessionsLoop() {
    for (const c of this.alive) {
      if (c.moonRequest) {
        c.moonRequest = false;
        if (this.moon.owner === -1) { this.moon = { owner: c.slot, days: this.data.setup.MOON_CONCESSION_TIME }; this.newsEngine.post(null, 30, { s1: c }); }
      }
      if (c.zeppelinRequest) {
        c.zeppelinRequest = false;
        this.zeppelins.set(c.slot, this.data.setup.ZEPPELIN_CONCESSION_TIME);
        this.newsEngine.post(c, 32, {});
      }
      c.moon = this.moon.owner === c.slot;
      c.zeppelin = this.zeppelins.has(c.slot);
    }
    this.market.moonOwner = this.moon.owner;
  }

  concessionsDaily() {
    if (this.moon.owner >= 0) {
      this.moon.days--;
      if (this.moon.days === 10) this.newsEngine.post(this.companies[this.moon.owner], NEWS.MOON_END, { days: 10 });
      if (this.moon.days <= 0) this.moon = { owner: -1, days: 0 };
    }
    for (const [slot, d] of this.zeppelins) {
      if (d - 1 === 10) this.newsEngine.post(this.companies[slot], NEWS.ZEPPELIN_END, { days: 10 });
      if (d - 1 <= 0) this.zeppelins.delete(slot); else this.zeppelins.set(slot, d - 1);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Fiscal control [S 0x40d170]: audits the company with the most illegal points.

  requestFiscalControl() {
    if (this.fiscal.countdown >= 0) return;
    this.fiscal.countdown = this.data.setup.TIME_BEFORE_FISCAL_CONTROL;
    this.newsEngine.post(null, NEWS.FISCAL_NOTICE, { days: this.fiscal.countdown });
  }

  fiscalDaily() {
    if (this.fiscal.countdown < 0) return;
    if (--this.fiscal.countdown > 0) return;
    this.fiscal.countdown = -1;
    this.fiscalControl(false);
  }

  fiscalControl(surprise) {
    const S = this.data.setup;
    let target = null, pts = -1;
    for (const c of this.alive) {
      const p = Math.min(c.illegalPoints ?? 0, S.MAX_ILLEGAL_POINTS_THRESHOLD);
      if (p > pts) { pts = p; target = c; }
    }
    if (target && pts > S.ILLEGAL_POINTS_TOLERANCE) {
      const range = S.MAX_ILLEGALITY_PENALTY - S.MIN_ILLEGALITY_PENALTY;
      const den = S.MAX_ILLEGAL_POINTS_THRESHOLD - S.ILLEGAL_POINTS_TOLERANCE;
      const penalty = idiv(range, den) * pts - idiv(range * S.ILLEGAL_POINTS_TOLERANCE, den) + S.MIN_ILLEGALITY_PENALTY;
      if (penalty > 0) {
        // The original books the fine twice (direct + news effect 14); it is charged once here.
        this.newsEngine.post(null, surprise ? 106 : NEWS.FISCAL_REPORT, { s1: target, amount: penalty }, { noEffect: true });
        target.book(penalty, BOOK.FINES);
        return;
      }
    }
    this.newsEngine.post(null, surprise ? 107 : NEWS.FISCAL_CLEAN, {});
  }

  // ------------------------------------------------------------------------------------------------
  // Inter-company special actions [S cSpecialActionHandler]

  espionageTrial(plaintiff, accused) {
    const acc = this.companies[accused];
    if (!acc) return;
    const spy = this.lastSpy.get(plaintiff.slot);
    this.newsEngine.post(plaintiff, NEWS.TRIAL, { s1: acc });
    if (spy && spy.spier === accused && this.day - spy.day < 30) {
      const fine = this.data.setup.SPY_TRIAL_PENALTY;
      acc.book(fine, BOOK.FINES);
      plaintiff.book(fine, BOOK.TRIALS);
      this.newsEngine.post(null, NEWS.GUILTY, { s1: acc, s2: plaintiff, amount: fine });
    } else {
      this.newsEngine.post(null, NEWS.INNOCENT, { s1: acc, s2: plaintiff });
    }
    this.notifyAI('court', plaintiff, acc);
  }

  slander(from, target) {
    const t = this.companies[target];
    if (!t) return;
    t.slander.add(1);
    this.newsEngine.post(from, NEWS.SLANDER, { s1: t });
    this.notifyAI('rumour', from, t);
  }

  // Spy actions [S 0x40d260]: refused if the target's guardian outranks the spy; certain success if the spy
  // outranks the guardian; otherwise a random draw of spy efficiency against sector security.
  spyAction(spier, actionId, target, ws) {
    const S = this.data.setup;
    const tgt = this.companies[target];
    if (!tgt?.alive) return;
    const spyLevel = ws.level;
    const guard = tgt.guardianLevel;
    let result;
    const sector = actionId === ACTION.BTN_SPY_ADMIN_AND_MARK ? 0 : actionId === ACTION.BTN_SABOTAGE_PRODUCTION ? 1 : 2;
    if (spyLevel < guard) result = 0;
    else if (spyLevel > guard) result = 3;
    else {
      const eff = idiv(ws.efficiency * 75, S.FULL_EFFICIENCY);
      const sec = sector === 0 ? idiv(tgt.security('ADMIN') + tgt.security('MARKETING'), 2) : sector === 1 ? tgt.security('PROD') : tgt.security('LABO');
      result = Math.floor(Math.random() * Math.max(1, sec + eff)) < eff ? 2 : 1;
    }
    this.lastSpy.set(target, { spier: spier.slot, day: this.day });
    this.notifyAI('spy', spier, tgt);
    if (result === 0) { this.newsEngine.post(spier, NEWS.SPY_REFUSED, { s1: tgt }); return; }
    if (result === 1) {
      this.newsEngine.post(null, NEWS.SPY_CAPTURED, { s1: spier, s2: tgt, amount: S.SPY_CAPTURE_PENALTY }, { noEffect: true });
      spier.book(S.SPY_CAPTURE_PENALTY, BOOK.FINES);
      this.newsEngine.post(tgt, NEWS.GUARD_BEATEN, { s1: spier });
      return;
    }
    if (actionId === ACTION.BTN_SPY_ADMIN_AND_MARK) {
      this.newsEngine.post(tgt, NEWS.ADMIN_BURGLED, {});
      this.newsEngine.post(spier, NEWS.SPY_REPORT, { s1: tgt, amount: tgt.bottomLine, pct: tgt.fiscalRisk });
      spier.intel = { ...(spier.intel ?? {}), [target]: { day: this.day, fiscalRisk: tgt.fiscalRisk, bottomLine: tgt.bottomLine, image: tgt.image, notoriety: tgt.notoriety } };
    } else if (actionId === ACTION.BTN_SABOTAGE_PRODUCTION) {
      const machines = [9, 10, 11, 12, 13].filter((i) => tgt.workstations[i].deskLevel > 0 && !tgt.workstations[i].broken);
      if (machines.length) {
        const ws2 = tgt.workstations[machines[Math.floor(Math.random() * machines.length)]];
        ws2.broken = true;
        ws2.integrity = 0;
        tgt.news(NEWS.MACHINE_BROKEN, { ws: ws2.index });
      }
      this.newsEngine.post(spier, 53, { s1: tgt });
    } else {
      // Steal a patent: a component the target owns and we have not finished becomes ours.
      for (let cat = 0; cat < spier.tech.length; cat++) {
        const t = spier.tech[cat].find((x) => (x.state === 1 || x.state === 2) && this.patentOwner(cat, x.comp.Level, x.comp.Evolution) === target);
        if (t) {
          t.state = 3;
          for (const [w, r] of Object.entries(spier.research)) if (r.cat === cat && r.L === t.comp.Level && r.E === t.comp.Evolution) delete spier.research[w];
          spier.updateAvailability();
          this.newsEngine.post(spier, 54, { s1: tgt, c1: { cat, L: t.comp.Level, E: t.comp.Evolution } });
          this.newsEngine.post(tgt, 55, { s1: spier });
          break;
        }
      }
    }
  }

  // Mafioso threats: workers of the target sector lose spirit for THREATEN_DURATION.
  threaten(from, actionId, target, ws) {
    const S = this.data.setup;
    const tgt = this.companies[target];
    if (!tgt?.alive) return;
    const sector = { [ACTION.BTN_THREATEN_ADMIN_AND_MARK_WORKER]: 'ADMIN_MARK', [ACTION.BTN_THREATEN_PRODUCTION_WORKER]: 'PROD',
      [ACTION.BTN_THREATEN_LABORATORY_WORKER]: 'LABO', [ACTION.BTN_THREATEN_SPECIAL_WORKER]: 'SPECIALS' }[actionId];
    const infl = ws.level * idiv(S.MAX_INFLUENCE, 3);
    tgt.sectorInfluence(sector, 'threat', -infl, S.THREATEN_DURATION);
    tgt.news(61, { s1: from });
    from.news(62 + ['ADMIN_MARK', 'PROD', 'LABO', 'SPECIALS'].indexOf(sector), { s1: tgt });
    this.notifyAI('mafia', from, tgt, sector);
  }

  notifyAI(kind, source, target, sector) {
    for (const c of this.alive) c.ai?.onAttack(kind, source, target, sector);
  }

  // ------------------------------------------------------------------------------------------------
  // Victory / defeat [S 0x43c450]

  checkVictory(c) {
    if (this.result || !c.alive) return;
    const L = this.data.setup.NUMBER_OF_SIM_LOOPS_PER_DAY;
    const D2Y = 730 * L, D1Y = 365 * L;
    const t = this.victoryType;
    if (c.cash < 0) {
      if (t === 14 && this.alive.length === 1) { this.win(c, 14); return; }
      this.eliminate(c);
      return;
    }
    const researchedAll = () => c.tech.every((cat) => cat.every((x) => x.state === 3));
    const nResearched = () => c.tech.reduce((a, cat) => a + cat.filter((x) => x.state === 3).length, 0);
    const scoreWin = (score) => this.scoreVictory(t, score);
    switch (t) {
      case 0: if (researchedAll()) this.win(c, 0); break;
      case 1: if (c.bottomLine > 5000000) this.win(c, 1); break;
      case 2: if (c.sharePrice > 700) this.win(c, 2); break;
      case 3: if (c.soldT > 300) this.win(c, 3); break;
      case 4: if (c.soldE > 300) this.win(c, 4); break;
      case 5: if (this.loop > D2Y) scoreWin((x) => x.tech.reduce((a, cat) => a + cat.filter((y) => y.state === 3).length, 0)); else if (researchedAll()) this.win(c, 0); break;
      case 6: if (this.loop > D2Y) scoreWin((x) => x.bottomLine); break;
      case 7: if (this.loop > D2Y) scoreWin((x) => x.sharePrice); break;
      case 8: if (this.loop > D2Y) scoreWin((x) => x.soldT); break;
      case 9: if (this.loop > D2Y) scoreWin((x) => x.soldE); break;
      case 10: if (this.loop * this.data.setup.REAL_TIME_PER_SIM_LOOP > 1800000) scoreWin((x) => x.bottomLine); break;
      case 11: if (c.line.slice(0, 3).every((l) => l && l.provider < 0 && l.L === 2 && l.E === 2) && c.stock > 0) this.win(c, 11); break;
      case 12: if (c.soldTotal > 400) this.win(c, 12); break;
      case 13: if (c.bottomLine > 10000000) this.win(c, 13); break;
      case 15: if (this.newsEngine.crash.crashed) scoreWin((x) => x.bottomLine); break;
      case 17:
        if (c === this.player) { if (c.bottomLine > 0) this.win(c, 17); else if (this.loop > D1Y) this.lose(1); }
        break;
      case 18: if (c === this.player && c.bottomLine > 2500000) this.win(c, 18); break;
      case 19: if (c.noteE > 60) this.win(c, 19); break;
      case 20: if (this.alive.length === 1) this.win(c, 20); break;
      default: break;
    }
    if (t !== 14 && t !== 16 && this.alive.length === 1 && this.companies.filter(Boolean).length > 1 && c === this.player) this.win(c, -2);
    void nResearched;
  }

  scoreVictory(t, score) {
    const best = this.alive.reduce((a, b) => (score(b) > score(a) ? b : a));
    this.win(best, t);
  }

  win(c, code) {
    if (this.result) return;
    if (c === this.player) this.result = { won: true, code, reason: code === -2 || code === 14 || code === 20 ? 0 : 1 };
    else this.result = { won: false, code, reason: 1 };
  }

  lose(reason) {
    if (!this.result) this.result = { won: false, reason };
  }

  eliminate(c) {
    c.alive = false;
    for (const ws of c.workstations) if (ws.worker) ws.worker.owner = -1;
    this.newsEngine.post(null, NEWS.BANKRUPT, { s1: c });
    if (c === this.player) this.lose(0);
    else if (this.alive.length === 1 && this.alive[0] === this.player && this.victoryType !== 14) this.win(this.player, -2);
  }

  // Objective progress per company for the lower-bar graph (one sample per loop).
  sampleGraph() {
    for (const c of this.companies) {
      if (!c) continue;
      const v = this.objectiveValue(c);
      const g = (this.graph[c.slot] ??= []);
      g.push(c.alive ? v : 0);
      if (g.length > 50) g.shift();
    }
  }

  objectiveValue(c) {
    switch (this.victoryType) {
      case 0: case 5: return c.tech.reduce((a, cat) => a + cat.filter((x) => x.state === 3).length, 0);
      case 2: case 7: return c.sharePrice;
      case 3: case 8: return c.soldT;
      case 4: case 9: return c.soldE;
      case 12: return c.soldTotal;
      case 19: return c.noteE;
      default: return c.bottomLine;
    }
  }

  graphSeries() {
    const all = this.companies.map((c, i) => (c ? this.graph[i] ?? [] : null));
    let max = 1;
    for (const g of all) if (g) for (const v of g) max = Math.max(max, v + 1);
    let min = 0;
    for (const g of all) if (g) for (const v of g) min = Math.min(min, v);
    return all.map((g, i) => (g && this.companies[i]?.alive ? { color: i, values: g, min, max } : null)).filter(Boolean);
  }
}
