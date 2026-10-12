// The consumer market, ported from the server's cPopulation / cSegment (CrazyFactoryServer.exe 0x40a140..0x40c015).
// See docs/simulation.md §market. Two segments: emotives (E) and technoids (T). Each loop every company offers
// one product; buyers are split between products by score, then a buy-percentage converts them into sales,
// capped by stock. Integer arithmetic truncates toward zero like the original (ftol / int division).

const trunc = Math.trunc;
const idiv = (a, b) => trunc(a / b);

// Rolling maximum over the last HISTORY_DAY days (cHistory, srv 0x40c020).
class History {
  constructor(len) { this.v = new Array(len).fill(0); this.i = 0; this.max = 0; }
  store(x) { this.v[this.i] = x; if (x > this.max) this.max = x; }
  advance() {
    this.i = (this.i + 1) % this.v.length;
    const old = this.v[this.i];
    this.v[this.i] = 0;
    if (old >= this.max) this.max = Math.max(...this.v);
  }
}

class Segment {
  constructor(name, cfg, market, setup, nPlayers) {
    this.name = name;
    this.crit = String(cfg.Criteria).trim().split(/\s+/).map(Number);
    this.maxFlow = cfg.MaxFlow;
    this.minFlow = cfg.MinFlow + (nPlayers > 2 ? (cfg.MinFlowPlayerBonus ?? 0) * (nPlayers - 2) : 0);
    this.step = idiv(400, cfg.DaysForMaxFlow);
    this.x0 = Math.sqrt(-40000 * Math.log(1 - this.minFlow / this.maxFlow));
    this.x = cfg.FlowCursorBegin ? cfg.FlowCursorBegin : this.x0;
    this.minAccessFactor = cfg.MinAccessFactor ?? 1;
    this.minNotoriety = cfg.MinNotoriety ?? 0;
    this.minImage = cfg.MinImageProduct ?? 0;
    this.minTech = cfg.MinTechLevel ?? 0;
    this.minDesign = cfg.MinDesignLevel ?? 0;
    this.minPress = cfg.MinSpecializedPress ?? 0;
    this.minTV = cfg.MinPubTV ?? 0;
    this.eventInfluence = (cfg.EventInfluence ?? -200) * 0.01;
    this.pubInfluence = (cfg.PubInfluence ?? 0) * 0.01;
    this.christmasInfluence = (cfg.ChristmasInfluence ?? 0) * 0.01;
    this.mpf = cfg.MaxPriceFactor ?? 2;
    this.sat = 0;
    this.infl = 0;
    this.flow = this.minFlow;
    this.setup = setup;
    this.market = market;
  }

  // 0x40b960: move the flow cursor by satisfaction + influence of the previous loop.
  updateFlow() {
    const d = Math.max(-1, Math.min(1, this.sat + this.infl));
    this.x = Math.max(this.x0, Math.min(400, this.x + d * this.step));
    this.flow = Math.max(this.minFlow, trunc(this.maxFlow * (1 - Math.exp(-(this.x * this.x) / 40000))));
  }

  // 0x40ba20
  setSatisfaction(unsat) {
    this.sat = this.flow ? (idiv((this.flow - unsat) * 100, this.flow) - 50) * 0.02 : 0;
  }

  // 0x40bba0 / 0x40be80: score = weighted attributes minus the segment's access threshold.
  score(P, techMax, designMax) {
    const S = this.setup;
    const c = this.crit;
    const MSP = S.MAX_SELLING_PRICE;
    const MPO = S.MAX_PUB_OPTIMIZED_BUDGET;
    const MAXL = this.market.maxLevelSum;
    const priceTerm = P.price <= this.mpf * P.cost
      ? 1000 - idiv(P.price * 1000, MSP)
      : 1000 + idiv(4000 * this.mpf * P.cost - 5000 * P.price, MSP);
    const raw = c[0] * priceTerm + c[1] * P.notor + c[2] * P.image + c[3] * P.tech + c[4] * P.design + c[5] * P.press + c[6] * P.tv;
    const T = this.name === 'E' ? idiv(this.minTech * 1000, MAXL) : idiv(techMax * 1000, MAXL);
    const D = this.name === 'E' ? idiv(designMax * 1000, MAXL) : idiv(this.minDesign * 1000, MAXL);
    const thr = c[0] * (1000 - idiv(this.minAccessFactor * P.cost * 1000, MSP))
      + c[1] * idiv(this.minNotoriety * 1000, S.FULL_NOTORIETY) + c[2] * idiv(this.minImage * 1000, S.FULL_IMAGE_PRODUCT)
      + c[3] * T + c[4] * D + c[5] * idiv(this.minPress * 1000, MPO) + c[6] * idiv(this.minTV * 1000, MPO);
    return raw - thr;
  }

  // 0x40bab0 (emotives: TV + zeppelins) / 0x40bda0 (technoids: press + moon).
  computeInfluence(offers, n, christmas, moonOwner) {
    const S = this.setup;
    let infl = 0;
    let sum = 0;
    if (this.name === 'E') {
      const k = offers.filter((o) => o.zeppelin).length;
      for (const o of offers) sum += o.tvBudget;
      if (n > 0) infl += (this.eventInfluence * k) / n;
    } else {
      if (moonOwner !== -1) infl = this.eventInfluence;
      for (const o of offers) sum += o.pressBudget;
    }
    if (n >= 2) sum = trunc(sum * 1.5);
    if (n > 0) sum = idiv(sum, n);
    sum = Math.min(sum, S.MAX_PUB_OPTIMIZED_BUDGET);
    infl += idiv(sum * 100, S.MAX_PUB_OPTIMIZED_BUDGET) * this.pubInfluence;
    if (christmas) infl += this.christmasInfluence;
    this.infl = infl;
  }
}

export class Market {
  // data: level data (sim/data.js); nPlayers: companies in the game.
  constructor(data, nPlayers) {
    const cfg = data.market;
    const S = data.setup;
    this.setup = S;
    this.maxDistribution = cfg.MARKET?.MaxDistribution ?? 100;
    this.scoreDivider = cfg.MARKET?.ScoreDivider ?? 100;
    this.abp = cfg.MARKET?.AverageBuyerPercent ?? 70;
    // MaxLevelSum (0x40afc0): components × ((maxLvl+1)(maxEvo+1) − 1), maxima taken from the first component file.
    const first = data.techno.categories[0].components;
    this.maxLvl = Math.max(...first.map((c) => c.Level));
    this.maxEvo = Math.max(...first.map((c) => c.Evolution));
    this.nComponents = data.techno.categories.length;
    this.maxLevelSum = this.nComponents * ((this.maxLvl + 1) * (this.maxEvo + 1) - 1);
    const segName = (k) => Object.keys(cfg).find((n) => n.toUpperCase().startsWith(k));
    this.E = new Segment('E', cfg[segName('EMOTI')] ?? cfg.EMOTIVES, this, S, nPlayers);
    this.T = new Segment('T', cfg[segName('TECHNO')] ?? cfg.TECHNOIDS, this, S, nPlayers);
    const histLen = S.NUMBER_OF_SIM_LOOPS_PER_DAY * S.HISTORY_DAY;
    this.techHistory = new History(histLen);
    this.designHistory = new History(histLen);
    this.christmas = false;
    this.moonOwner = -1;
    this.last = null;
  }

  // levels / evos are arrays of component Level / Evolution indices (TechLevel 0x40aee0, DesignLevel 0x40af50).
  techLevel(levels, evos) {
    return levels.reduce((a, l, i) => a + l * (this.maxEvo + 1) + evos[i], 0);
  }
  designLevel(levels, evos) {
    return evos.reduce((a, e, i) => a + e * (this.maxLvl + 1) + levels[i], 0);
  }

  // Weight (0x40ae50) and BuyPercent (0x40ae70).
  weight(s) { return this.maxDistribution * (1 + (2 / Math.PI) * Math.atan(s / this.scoreDivider)); }
  buyPercent(s) {
    s = Math.max(s, -100000);
    return s > 0 ? this.abp + ((100 - this.abp) * s) / 100000 : this.abp * (1 + s / 100000);
  }

  // offers: one per company slot { id, active, stock, retailPrice, unitCost, notoriety, image, levels[], evos[],
  //   pressBudget, tvBudget, zeppelin, moon }. Returns per-company { soldE, soldT, noteE, noteT, scoreE, scoreT }
  // plus segment totals. Called once per sim loop (cPopulation_ComputeSales, srv 0x40a660).
  computeSales(offers) {
    const S = this.setup;
    const segs = [this.E, this.T];
    for (const seg of segs) seg.updateFlow();
    const res = offers.map((o) => ({ id: o.id, soldE: 0, soldT: 0, noteE: 0, noteT: 0, scoreE: 0, scoreT: 0 }));
    const active = offers.filter((o) => o.active && o.stock > 0);
    let maxTech = 0, maxDesign = 0;
    const best = { E: -1, T: -1 }, bestScore = { E: -100000, T: -100000 };
    const sums = { E: 0, T: 0 };
    const w = { E: new Map(), T: new Map() }, sc = { E: new Map(), T: new Map() };
    for (const o of active) {
      const tech = this.techLevel(o.levels, o.evos);
      const design = this.designLevel(o.levels, o.evos);
      const P = {
        notor: idiv(o.notoriety * 1000, S.FULL_NOTORIETY),
        image: idiv(o.image * 1000, S.FULL_IMAGE_PRODUCT),
        tech: idiv(tech * 1000, this.maxLevelSum),
        design: idiv(design * 1000, this.maxLevelSum),
        press: trunc((o.pressBudget * 1000) / S.MAX_PUB_OPTIMIZED_BUDGET),
        tv: trunc((o.tvBudget * 1000) / S.MAX_PUB_OPTIMIZED_BUDGET),
        cost: o.unitCost,
        price: o.retailPrice,
      };
      maxTech = Math.max(maxTech, tech);
      maxDesign = Math.max(maxDesign, design);
      for (const seg of segs) {
        const s = seg.score(P, this.techHistory.max, this.designHistory.max);
        sc[seg.name].set(o.id, s);
        if (s > bestScore[seg.name]) { bestScore[seg.name] = s; best[seg.name] = o.id; }
        const wt = this.weight(s);
        w[seg.name].set(o.id, wt);
        sums[seg.name] += wt;
      }
    }
    this.techHistory.store(maxTech);
    this.designHistory.store(maxDesign);

    const unsat = { E: 0, T: 0 };
    const demand = { E: new Map(), T: new Map() }, pct = { E: new Map(), T: new Map() };
    for (const seg of segs) {
      const k = seg.name;
      const flow = seg.flow;
      let total = 0;
      const att = new Map();
      for (const o of active) {
        const share = sums[k] > 0 ? (w[k].get(o.id) * 100) / sums[k] : 0;
        const a = idiv(trunc(flow * share), 100);
        att.set(o.id, a);
        total += a;
      }
      if (total !== flow && best[k] !== -1) att.set(best[k], att.get(best[k]) + flow - total);
      for (const o of active) {
        const p = this.buyPercent(sc[k].get(o.id));
        pct[k].set(o.id, p);
        const d = trunc(att.get(o.id) * p * 0.01);
        demand[k].set(o.id, d);
        unsat[k] += att.get(o.id) - d;
      }
    }
    for (const o of active) {
      const r = res.find((x) => x.id === o.id);
      const pE = pct.E.get(o.id), pT = pct.T.get(o.id);
      const stockE = pE + pT > 0 ? trunc((o.stock * pE) / (pE + pT)) : 0;
      const stockT = o.stock - stockE;
      for (const [k, stock] of [['E', stockE], ['T', stockT]]) {
        const d = demand[k].get(o.id);
        const sold = Math.min(d, stock);
        if (d > stock) unsat[k] += d - stock;
        r[`sold${k}`] = sold;
        const s = sc[k].get(o.id);
        r[`score${k}`] = s;
        // Product note 0..99 shown in the indicator panel.
        r[`note${k}`] = idiv(Math.max(-50000, Math.min(20000, s)) * 100, 70000) - idiv(-50000 * 100, 70000);
      }
    }
    const n = offers.filter((o) => o.active).length;
    this.E.computeInfluence(active, n, this.christmas, this.moonOwner);
    this.T.computeInfluence(active, n, this.christmas, this.moonOwner);
    if (!active.length) { unsat.E = this.E.flow; unsat.T = this.T.flow; }
    this.E.setSatisfaction(unsat.E);
    this.T.setSatisfaction(unsat.T);
    this.techHistory.advance();
    this.designHistory.advance();
    this.last = { results: res, flowE: this.E.flow, flowT: this.T.flow, unsatE: unsat.E, unsatT: unsat.T };
    return this.last;
  }

  toJSON() {
    const seg = (s) => ({ x: s.x, sat: s.sat, infl: s.infl, flow: s.flow });
    return { E: seg(this.E), T: seg(this.T), tech: this.techHistory, design: this.designHistory, christmas: this.christmas, moonOwner: this.moonOwner };
  }

  restore(j) {
    Object.assign(this.E, j.E);
    Object.assign(this.T, j.T);
    Object.assign(this.techHistory, j.tech);
    Object.assign(this.designHistory, j.design);
    this.christmas = j.christmas;
    this.moonOwner = j.moonOwner;
  }
}
