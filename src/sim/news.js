// News / mail engine (cNewsList, cNewsServer, cNewsHandler, cNewsConditions; docs/simulation.md §news).
// Every message has a News.ini entry (type, icon, effect, delays, condition, yes/no) and English text in
// TRAD/News__TRAD (title) and TRAD/NewsText (mail body, '§' = line break, '#x' placeholders).
import { BOOK } from './company.js';

const idiv = (a, b) => Math.trunc(a / b);

export class NewsEngine {
  constructor(sim) {
    this.sim = sim;
    this.defs = {};
    this.titles = {};
    this.bodies = {};
    this.relaunch = new Map(); // `${slot}:${id}` -> day
    this.challenges = [];
    this.tutorialStep = 0;
    this.tutorialAux = 0;
    this.crash = { day: 400, prob: [[5, 5, 5, 5], [10, 10, 10, 10], [25, 25, 25, 25]], crashed: false };
    this.serial = 0;
  }

  async load(assets, lang) {
    const toDefs = (ini) => {
      for (const s of ini) {
        if (!/^\d+$/.test(s.name)) continue;
        const o = Object.fromEntries(s.entries);
        this.defs[Number(s.name)] = o;
      }
    };
    toDefs(await assets.loadIni('INI/News.ini'));
    const titles = await assets.loadIni(`TRAD/News__TRAD.${lang}`);
    for (const s of titles) if (/^\d+$/.test(s.name)) this.titles[Number(s.name)] = Object.fromEntries(s.entries).Title ?? '';
    try {
      const r = await fetch(`data/ini/TRAD/NewsText.${lang}.json`);
      this.bodies = await r.json();
    } catch { this.bodies = {}; }
    // Level-specific news ranges ([PRODUCT] / [MISSION] First..Max-1) live in News.ini as well.
    const ln = this.sim.data.levelNews ?? [];
    const range = (name) => { const s = ln.find((x) => x.name === name); if (!s) return []; const o = Object.fromEntries(s.entries); const out = []; for (let i = o.First; i < o.Max; i++) out.push(i); return out; };
    this.productNews = range('PRODUCT');
    this.missionNews = range('MISSION');
    this.randomPool = Object.entries(this.defs).filter(([id, d]) => d.NewsType === 1 && (Number(id) < 150 || this.productNews.includes(Number(id)) || this.missionNews.includes(Number(id)))).map(([id]) => Number(id));
    this.conditional = Object.entries(this.defs).filter(([id, d]) => d.NewsType === 2 && (Number(id) < 150 || this.missionNews.includes(Number(id)))).map(([id]) => Number(id));
  }

  def(id) { return this.defs[id] ?? {}; }

  // Post a news item to one company (or null for everyone).
  // opts.task overrides the INI effect, opts.noEffect suppresses it; opts.delayDays overrides TimeBeforeEffect.
  post(company, id, params = {}, opts = {}) {
    const d = this.def(id);
    const targets = company ? [company] : this.sim.companies.filter((c) => c?.alive);
    for (const c of targets) {
      const key = `${c.slot}:${id}`;
      const rd = d.RelaunchDelay ?? 0;
      if (rd !== 0 && !opts.force) {
        if (this.relaunch.has(key)) continue;
        this.relaunch.set(key, { day: this.sim.day, delay: rd });
      }
      const msg = {
        serial: ++this.serial, id, day: this.sim.day, params, read: false,
        title: this.format(this.titles[id] ?? `News ${id}`, params, c),
        body: this.format(this.bodies[id] ?? '', params, c),
        icon: d.Icon ?? 0, email: (d.EMail ?? 0) === 1 || !!this.bodies[id], alert: d.AlertNews ?? 0,
        yesNo: (d.YesNoNews ?? 0) === 1, answer: null,
      };
      c.inbox.unshift(msg);
      if (c.inbox.length > 128) c.inbox.length = 128;
      if (c.isPlayer) this.sim.onPlayerNews?.(msg);
      // Effects run now or after TimeBeforeEffect days (stored as a task so the game can be saved).
      const task = opts.task ?? (d.Effect >= 0 && !opts.noEffect ? { kind: 'effect', effect: d.Effect, params: this.sim.ref(params) } : null);
      if (task && !msg.yesNo) {
        const delay = opts.delayDays ?? (d.TimeBeforeEffect > 0 ? d.TimeBeforeEffect : 0);
        if (delay > 0) this.sim.schedule(c, delay, task); else this.sim.runTask({ slot: c.slot, task });
      }
      if (msg.yesNo) msg.effect = task;
    }
  }

  // Placeholder substitution: #s1/#s2 company, #e employee, #j job, #c1..#c4 components, #t days, #a amount,
  // #q quantity, #p percent.
  format(text, p, company) {
    const data = this.sim.data;
    const comp = (v) => {
      if (!v) return '';
      const t = company.component(v.cat, v.L, v.E);
      const cat = data.techno.categories[v.cat];
      return t ? data.text[cat.file.replace(/\.ini$/i, '')]?.[t.comp.Name]?.String ?? '' : '';
    };
    // TRAD's JOB_TYPE_ACCOUNTANT / JOB_TYPE_FINANCIER strings are swapped relative to the job enum (job 0 is the lawyer).
    const jobName = (j) => this.sim.game?.strings.get(`JOB_TYPE_${['FINANCIER', 'ACCOUNTANT', 'MANAGER', 'SPY', 'PUB', 'COM', 'MAFIOSI', 'SEARCHER', 'DRIVER_CHIEF', 'DRIVER', 'GUARDIAN'][j]}`) ?? '';
    return String(text)
      .replace(/#s1/g, p.s1?.name ?? p.company?.name ?? company.name)
      .replace(/#s2/g, p.s2?.name ?? '')
      .replace(/#e/g, p.worker ? this.sim.workerName(p.worker) : '')
      .replace(/#j/g, p.worker ? jobName(p.worker.JobType) : p.job !== undefined ? jobName(p.job) : '')
      .replace(/#c([1-4])/g, (m, n) => comp(p[`c${n}`]))
      .replace(/#t/g, p.days ?? '')
      .replace(/#a/g, p.amount !== undefined ? Number(p.amount).toLocaleString('en-US') : '')
      .replace(/#q/g, p.qty ?? '')
      .replace(/#p/g, p.pct ?? '')
      .replace(/#[lf]/g, '');
  }

  // Effects 0..18 [S 0x42ca70 table].
  runEffect(c, effect, msg) {
    const p = msg.params;
    const sim = this.sim;
    switch (effect) {
      case 0: if (p.ws !== undefined) c.fire(p.ws); break;
      case 4: c.extraMargin = idiv(c.extraMargin - 33, 2); break;
      case 5: c.extraMargin = idiv(c.extraMargin + 33, 2); break;
      case 6: for (const cr of sim.creditors) if (cr.CreditorType === 1) cr.rateDelta = (cr.rateDelta ?? 0) + 1; break;
      case 7: for (const cr of sim.creditors) if (cr.CreditorType === 1) cr.rateDelta = (cr.rateDelta ?? 0) - 1; break;
      case 8: case 9: {
        const k = sim.jobKey(p.job);
        sim.salaryTable[k] = Math.min(999999, idiv(sim.salaryTable[k] * (effect === 8 ? 110 : 90), 100));
        for (const co of sim.companies) co?.workstations.filter((w) => w.job === p.job).forEach((w) => w.computeSpirit());
        break;
      }
      case 10: case 11:
        for (const d of sim.data.desktops) d.Price = Math.min(999999, idiv(d.Price * (effect === 10 ? 110 : 90), 100));
        for (const o of sim.data.objects) o.Price = Math.min(999999, idiv(o.Price * (effect === 10 ? 110 : 90), 100));
        break;
      case 12: if (p.company === c) { c.book(p.amount, BOOK.AWARDS); c.stock = Math.max(0, c.stock - p.qty); } break;
      case 13: if (p.company === c) { c.newsImage += p.pct; sim.schedule(c, 30, { kind: 'newsImage', amount: -p.pct }); } break;
      case 14: if (p.company === c || p.company === undefined) c.book(p.amount, BOOK.FINES); break;
      case 16: this.tutorialAux = 0x38; break;
      case 17: sim.endTutorial = true; break;
      case 18: if (p.company === c) c.book(p.amount, BOOK.AWARDS); break;
      default: break; // 1, 2 no-op; 3 handled by the morale check; 15 tutorial flag
    }
  }

  // Yes/No mail (orders, tutorial end): accepting runs the effect and enrols the company in the challenge.
  answer(c, msg, yes) {
    if (msg.answer !== null) return;
    msg.answer = yes;
    if (yes && msg.effect) this.sim.runTask({ slot: c.slot, task: msg.effect });
    const ch = this.challenges.find((x) => x.msgSerial === msg.serial || x.id === msg.id);
    if (ch && yes) ch.accepted.add(c.slot);
  }

  // ------------------------------------------------------------------------------------------------
  // Server side (daily)

  daily() {
    const sim = this.sim;
    const S = sim.data.setup;
    // Relaunch bookkeeping.
    for (const [k, v] of this.relaunch) if (v.delay >= 0 && sim.day - v.day >= v.delay) this.relaunch.delete(k);
    // Random news.
    if (this.randomPool.length && Math.random() * 100 < S.RANDOM_NEWS_PROBABILITY) {
      for (let a = 0; a < 20; a++) {
        const id = this.randomPool[Math.floor(Math.random() * this.randomPool.length)];
        if (this.launchRandom(id)) break;
      }
    }
    this.christmas();
    // Challenges count down.
    for (const ch of [...this.challenges]) {
      ch.days--;
      if (ch.days > 0) continue;
      this.challenges.splice(this.challenges.indexOf(ch), 1);
      if (ch.id === 104) { sim.market.christmas = false; continue; }
      if (ch.id === 101) {
        const winners = sim.companies.filter((c) => c?.alive && (ch.acc.get(c.slot) ?? 0) < 5000);
        if (winners.length) winners.forEach((c) => this.post(c, 102, { company: c, amount: ch.amount }));
        else this.post(null, 103, {});
      } else if (ch.kind === 'order') this.post(null, 126, {});
    }
  }

  launchRandom(id) {
    const sim = this.sim;
    const S = sim.data.setup;
    const d = this.def(id);
    const key = `all:${id}`;
    if ((d.RelaunchDelay ?? 0) !== 0 && this.relaunch.has(key)) return false;
    const cond = d.Condition ?? '';
    if (cond === 'NoResearchOrderInProgress' && this.challenges.some((c) => c.id === 100)) return false;
    if (cond === 'NoProdOrderInProgress' && this.challenges.some((c) => c.kind === 'order')) return false;
    if (cond === 'NoEcoChallengeInProgress' && this.challenges.some((c) => c.id === 101)) return false;
    const p = {};
    const rnd = (n) => Math.floor(Math.random() * n);
    if (id === 96 || id === 97) p.job = rnd(11);
    if (id === 100) {
      const cat = rnd(sim.data.techno.categories.length);
      const comps = sim.data.techno.categories[cat].components;
      const comp = comps[rnd(comps.length)];
      p.c1 = { cat, L: comp.Level, E: comp.Evolution };
      p.pct = 25;
      this.challenges.push({ id, kind: 'research', comp: p.c1, pct: 25, days: 90, accepted: new Set() });
    }
    if (id === 101) {
      p.amount = 100000 + 3000 * rnd(101);
      p.days = 30;
      this.challenges.push({ id, kind: 'eco', amount: p.amount, days: 30, acc: new Map(), accepted: new Set(sim.companies.filter(Boolean).map((c) => c.slot)) });
    }
    if (id === 105) { sim.fiscalControl(true); this.relaunch.set(key, { day: sim.day, delay: d.RelaunchDelay ?? 0 }); return true; }
    if ([300, 400, 500].includes(id) || (id >= 1300 && id <= 1309)) {
      const nCat = sim.data.techno.categories.length;
      const comps = [];
      for (let c = 0; c < Math.min(nCat, 3); c++) {
        if (id >= 1300) comps.push({ cat: c, L: rnd(2), E: rnd(3) });
        else comps.push({ cat: c, ...[{ L: 0, E: 0 }, { L: 1, E: 0 }, { L: 0, E: 1 }][rnd(3)] });
      }
      if (id === 500 && nCat > 3) comps.push({ cat: 3, L: rnd(3), E: 0 });
      comps.forEach((v, i) => { p[`c${i + 1}`] = v; });
      p.qty = 10 * (100 + rnd(101));
      p.amount = (id >= 1300 ? 500 : 300) * p.qty;
      p.days = 100;
      this.challenges.push({ id, kind: 'order', comps, qty: p.qty, amount: p.amount, days: 100 * S.NUMBER_OF_SIM_LOOPS_PER_DAY, accepted: new Set() });
    }
    if ((d.RelaunchDelay ?? 0) !== 0) this.relaunch.set(key, { day: sim.day, delay: d.RelaunchDelay });
    this.post(null, id, p, { force: true });
    const ch = this.challenges.find((c) => c.id === id && !c.msgSerial);
    if (ch) ch.msgSerial = this.serial;
    return true;
  }

  // Christmas [S 0x40e730]: announcement 30 days before, sales boost from 15 days before 25 Dec.
  christmas() {
    const date = (d) => new Date(Date.UTC(2000, 0, 1) + d * 86400000);
    const isXmas = (d) => { const t = date(d); return t.getUTCMonth() === 11 && t.getUTCDate() === 25; };
    if (isXmas(this.sim.day + 30)) this.post(null, 104, { days: 30 });
    if (isXmas(this.sim.day + 15)) {
      this.challenges.push({ id: 104, kind: 'christmas', days: 15, accepted: new Set() });
      this.sim.market.christmas = true;
    }
  }

  // Per loop: challenge completion [S 0x40e260] and conditional / mission news [S 0x42e020].
  perLoop() {
    const sim = this.sim;
    for (const ch of [...this.challenges]) {
      if (ch.kind === 'research') {
        const winner = sim.companies.find((c) => c?.alive && c.component(ch.comp.cat, ch.comp.L, ch.comp.E)?.state === 3 && ch.accepted.has(c.slot));
        if (winner) { this.challenges.splice(this.challenges.indexOf(ch), 1); this.post(winner, 67, { company: winner, pct: ch.pct, c1: ch.comp }); }
      } else if (ch.kind === 'order') {
        for (const c of sim.companies) {
          if (!c?.alive || !ch.accepted.has(c.slot) || c.stock < ch.qty) continue;
          const match = ch.comps.every((v) => c.line[v.cat] && c.line[v.cat].L === v.L && c.line[v.cat].E === v.E);
          if (!match) continue;
          this.challenges.splice(this.challenges.indexOf(ch), 1);
          this.post(c, 68, { company: c, amount: ch.amount, qty: ch.qty });
          break;
        }
      } else if (ch.kind === 'eco') {
        for (const c of sim.companies) if (c?.alive) ch.acc.set(c.slot, (ch.acc.get(c.slot) ?? 0) + (c.production.running ? c.unitsThisLoop * c.line.filter((l) => l?.provider < 0).length : 0));
      }
    }
    this.conditions();
  }

  // Scripted mission conditions [S 0x429b40]. Only the player's company (slot 0) runs the tutorial steps.
  conditions() {
    const sim = this.sim;
    const player = sim.player;
    const L = sim.data.setup.NUMBER_OF_SIM_LOOPS_PER_DAY;
    for (const id of this.conditional) {
      const d = this.def(id);
      const cond = d.Condition ?? '';
      if (!cond) continue;
      if (this.evalCondition(cond, player)) this.post(player, id, {});
    }
    if (this.missionNews.includes(900) || sim.data.level === 6) {
      const ai = sim.companies[1];
      if (ai?.alive) ai.book(idiv(1000, L), BOOK.OTHER);
    }
    if (sim.data.level === 7) this.inflation();
    if (sim.data.level === 8 && sim.loop % L === 0) this.crashTick();
  }

  evalCondition(cond, c) {
    const st = this.tutorialStep;
    const step = (from, ok = true) => { if (st === from && ok) { this.tutorialStep = from + 1; return true; } return false; };
    const desks = (a, b) => c.workstations.slice(a, b + 1).some((w) => w.worker);
    switch (cond) {
      case 'TutorialLabo0': case 'TutorialProd0': case 'TutorialVendre0': case 'TutorialAttaque0': return step(0);
      case 'TutorialLabo1': case 'TutorialProd1': case 'TutorialVendre1': case 'TutorialAttaque1': return step(1);
      case 'TutorialLabo2': return step(2, desks(5, 8));
      case 'TutorialLabo3': return step(3, c.tech.every((cat) => cat.find((t) => t.comp.Level === 0 && t.comp.Evolution === 0)?.state === 3));
      case 'TutorialLabo4': return step(4, c.tech.every((cat) => cat.some((t) => (t.comp.Level || t.comp.Evolution) && t.state === 3)));
      case 'TutorialProd2': return step(2, c.line.slice(0, 3).every((l) => l && l.L === 0 && l.E === 1) && c.stock > 1000);
      case 'TutorialVendre2': return step(2, c.soldTotal > 200);
      case 'TutorialVendre3': return step(3, c.soldE > 150);
      case 'TutorialAttaque2': return step(2, c.workstations.slice(5, 9).every((w) => w.worker && w.spirit >= 60));
      case 'TutorialAttaque3': return step(3, !!c.workstations[0].worker);
      case 'TutorialAttaque4': return step(4, this.tutorialAux === 0x38);
      case 'TutorialAttaque5': return step(5, c.workstations[14].worker?.level >= 3 && c.objects[9] >= 3 && c.workstations[14].efficiency > 95);
      case 'BeginningOfGame': {
        if (this.begun) return false;
        this.begun = true;
        const t = this.sim.victoryType;
        if (t !== 16 && t >= 0 && t <= 20) this.post(c, 127 + t, {});
        return false;
      }
      default: return false;
    }
  }

  // LEVEL07 Hyper inflation [S 0x42a9c0].
  inflation() {
    const sim = this.sim;
    const L = sim.data.setup.NUMBER_OF_SIM_LOOPS_PER_DAY;
    const bump = (list, key, pct) => list.forEach((x) => { x[key] = Math.min(999999, idiv(x[key] * (100 + pct), 100)); });
    if (sim.loop % (2 * L) === 0) {
      sim.data.techno.categories.forEach((cat) => bump(cat.components, 'Price', 2));
      bump(sim.data.desktops, 'Price', 1);
      bump(sim.data.objects, 'Price', 1);
    }
    const alive = sim.companies.filter((c) => c?.alive);
    for (const c of alive) c.book(idiv(sim.day * (alive.length === 1 ? 800 : 40), L), BOOK.FINES);
  }

  // LEVEL08 Market crash countdown [S 0x42ad00].
  crashTick() {
    const sim = this.sim;
    const cr = this.crash;
    if (cr.crashed) return;
    const rem = cr.day - sim.day;
    const announce = () => sim.announce?.(sim.game?.strings.get('MISSION5_CRASH', rem) ?? `MARKET CRASH D-${rem}`);
    const shift = (ph) => {
      const r = Math.floor(Math.random() * 1000);
      const p = cr.prob[ph];
      if (r > p[0] + p[1] + p[2] + p[3]) return;
      const b = r <= p[0] ? 0 : r <= p[0] + p[1] ? 1 : r <= p[0] + p[1] + p[2] ? 2 : 3;
      const delta = [[90, 90, -90, -90], [30, 30, -30, -30], [10, 10, -10, -10]][ph][b];
      cr.day += delta;
      p[b] = idiv(p[b], 2);
      this.post(null, 1101 + ph * 4 + b, {});
    };
    if (rem > 180) { if (rem % 15 === 0) announce(); shift(0); }
    else if (rem > 60) { if (rem % 10 === 0) announce(); shift(1); }
    else if (rem > 15) { if (rem % 4 === 0) announce(); shift(2); }
    else if (rem > 0) announce();
    else { cr.crashed = true; this.post(null, 1100, {}); }
  }
}
