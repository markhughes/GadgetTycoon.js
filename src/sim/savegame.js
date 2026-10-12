// Save / load of a running game. A save stores the level parameters (to rebuild the static data) plus the
// mutable simulation state as plain JSON. Object references are stored as indices.
import { History } from './history.js';

const VERSION = 1;

const hist = (h) => h.toJSON();
const unhist = (j) => History.from(j);
const HIST_KEYS = ['deferred', 'illegal', 'slander', 'presenceHist', 'corruptionHist', 'negotiateHist'];
const COMPANY_KEYS = ['name', 'isPlayer', 'aiType', 'alive', 'cash', 'balance', 'debt', 'debtDays', 'sharePrice', 'payDelayDays', 'delayWork',
  'delaySmooth', 'ledger', 'ledgerMonth', 'ledgerDay', 'fiscalRisk', 'illegalPoints', 'notoriety', 'image', 'newsImage', 'flags', 'zeppelin',
  'moon', 'oldStockDeal', 'construction', 'price', 'extraMargin', 'tvMonthly', 'pressMonthly', 'tvWork', 'pressWork', 'stock', 'produced',
  'soldTotal', 'soldE', 'soldT', 'lastSales', 'noteE', 'noteT', 'unitsThisLoop', 'history', 'statsHistory', 'objects', 'machines', 'line',
  'research', 'target', 'patentsOwned', 'intel', 'guardWork', 'guardWorkNext'];
const WS_KEYS = ['deskId', 'spirit', 'efficiency', 'productivity', 'level', 'peakProductivity', 'infl', 'training', 'trainingWork',
  'trainingGeneration', 'generation', 'integrity', 'broken', 'activeButton', 'cv', 'lowSpiritNotified'];

export function serializeGame(scene) {
  const sim = scene.sim;
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, structuredClone(o[k])]));
  return {
    version: VERSION,
    params: scene.params,
    world: { cam: { ...scene.world.cam }, inside: scene.world.inside },
    sim: {
      loop: sim.loop, day: sim.day, clock: sim.clock, victoryType: sim.victoryType,
      patents: [...sim.patents], moon: sim.moon, zeppelins: [...sim.zeppelins], fiscal: sim.fiscal, lastSpy: [...sim.lastSpy],
      tasks: sim.tasks, salaryTable: sim.salaryTable, graph: sim.graph,
      creditors: sim.creditors.map((c) => c.rateDelta ?? 0),
      desktopPrices: sim.data.desktops.map((d) => d.Price),
      objectPrices: sim.data.objects.map((o) => o.Price),
      componentPrices: sim.data.techno.categories.map((cat) => cat.components.map((c) => c.Price)),
      workers: sim.workers.map((w) => ({ level: w.level, salary: w.salary, owner: w.owner, spirit: w.spirit, BasicSpirit: w.BasicSpirit, BasicProductivity: w.BasicProductivity })),
      market: sim.market.toJSON(),
      news: {
        relaunch: [...sim.newsEngine.relaunch], challenges: sim.newsEngine.challenges.map((c) => ({ ...c, accepted: [...c.accepted], acc: c.acc ? [...c.acc] : undefined })),
        tutorialStep: sim.newsEngine.tutorialStep, tutorialAux: sim.newsEngine.tutorialAux, crash: sim.newsEngine.crash, serial: sim.newsEngine.serial, begun: sim.newsEngine.begun,
      },
      companies: sim.companies.map((c) => c && {
        slot: c.slot,
        ...pick(c, COMPANY_KEYS),
        ...Object.fromEntries(HIST_KEYS.map((k) => [k, hist(c[k])])),
        monthHist: c.monthHist.map(hist),
        tech: c.tech.map((cat) => cat.map((t) => ({ state: t.state, progress: t.progress, blocked: t.blocked }))),
        workstations: c.workstations.map((w) => ({
          ...pick(w, WS_KEYS), worker: w.worker?.index ?? -1,
          bars: w.bars.map((b) => ({ requested: b.requested, effective: b.effective })),
          buttons: w.buttons.map((b) => ({ remaining: b.remaining, active: b.active, queued: b.queued, done: b.done, params: b.params })),
        })),
        inbox: c.inbox.map((m) => ({ ...m, params: sim.ref(m.params) })),
        cvProgress: c.cvProgress ? [...c.cvProgress] : [],
        ai: c.ai ? { personality: c.ai.personality, nme: c.ai.nme, fiscalPts: c.ai.fiscalPts, courtNeed: c.ai.courtNeed, motiv: c.ai.motiv, sales: c.ai.sales, startProdNeed: c.ai.startProdNeed, keep: c.ai.keep } : null,
      }),
    },
  };
}

// Applies a save onto a freshly created simulation for the same level (see GameScene.load).
export function restoreGame(sim, save) {
  const s = save.sim;
  Object.assign(sim, { loop: s.loop, day: s.day, clock: s.clock, victoryType: s.victoryType, moon: s.moon, fiscal: s.fiscal, tasks: s.tasks,
    salaryTable: s.salaryTable, graph: s.graph });
  sim.patents = new Map(s.patents);
  sim.zeppelins = new Map(s.zeppelins);
  sim.lastSpy = new Map(s.lastSpy);
  sim.creditors.forEach((c, i) => { c.rateDelta = s.creditors[i]; });
  sim.data.desktops.forEach((d, i) => { d.Price = s.desktopPrices[i]; });
  sim.data.objects.forEach((o, i) => { o.Price = s.objectPrices[i]; });
  sim.data.techno.categories.forEach((cat, ci) => cat.components.forEach((c, i) => { c.Price = s.componentPrices[ci][i]; }));
  sim.workers.forEach((w, i) => Object.assign(w, s.workers[i]));
  sim.market.restore(s.market);
  const ne = sim.newsEngine;
  ne.relaunch = new Map(s.news.relaunch);
  ne.challenges = s.news.challenges.map((c) => ({ ...c, accepted: new Set(c.accepted), acc: c.acc ? new Map(c.acc) : undefined }));
  Object.assign(ne, { tutorialStep: s.news.tutorialStep, tutorialAux: s.news.tutorialAux, crash: s.news.crash, serial: s.news.serial, begun: s.news.begun });
  s.companies.forEach((cs, slot) => {
    const c = sim.companies[slot];
    if (!cs || !c) return;
    for (const k of COMPANY_KEYS) if (cs[k] !== undefined) c[k] = cs[k];
    for (const k of HIST_KEYS) c[k] = unhist(cs[k]);
    c.monthHist = cs.monthHist.map(unhist);
    c.tech.forEach((cat, ci) => cat.forEach((t, i) => Object.assign(t, cs.tech[ci][i])));
    c.workstations.forEach((w, i) => {
      const ws = cs.workstations[i];
      for (const k of WS_KEYS) w[k] = ws[k];
      w.worker = ws.worker >= 0 ? sim.workers[ws.worker] : null;
      w.bars.forEach((b, k) => Object.assign(b, ws.bars[k]));
      w.buttons.forEach((b, k) => Object.assign(b, ws.buttons[k]));
    });
    c.inbox = cs.inbox.map((m) => ({ ...m, params: sim.unref(m.params) }));
    c.cvProgress = new Map(cs.cvProgress);
    if (cs.ai && c.ai) Object.assign(c.ai, cs.ai);
  });
}
