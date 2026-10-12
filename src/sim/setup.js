// Builds a Simulation for a level: freeplay from the menu options, campaign/tutorial levels from the
// MakeSave*.ini authoring files that generated the original LevelXX.SAV/.sa2 start states.
import { loadLevelData, WORKSTATION_KEYS, OBJECT_KEYS } from './data.js';
import { Simulation, AI_NAMES, START_MONEY } from './simulation.js';
import { iniObject } from '../engine/assets.js';
import { AIController } from './ai.js';

// Victory type per level (from the .sa2 files; docs/simulation.md §levels).
export const LEVEL_VICTORY = { 4: 11, 5: 12, 6: 13, 7: 14, 8: 15, 9: 17, 10: 18, 11: 19, 12: 20, 90: 16, 91: 16, 92: 16, 93: 16 };
// Mission opponents' names, in CLIENT1.. order (from the .SAV "Clients" chunk).
const MISSION_NAMES = {
  4: ['TechEst', 'Dedloss'], 5: ['Mintiko', 'Preterco', 'Cheekery', 'TechEst'], 6: ['Monotik'], 7: ['Cheekery', 'TechEst', 'She Hot', 'Dedloss'],
  8: ['Cheekery', 'Traget'], 9: ['Krotek', 'Ibidem'], 10: ['Desikate'], 11: ['Criptoe', 'SlapBang', 'Wincey'],
  12: ['Dedloss', 'Quortix', 'Miksita', 'MyMax'], 90: ['Criptoe'], 91: ['Criptoe'], 92: ['Mintiko'], 93: ['Criptoe'],
};

export async function createGame(game, params) {
  const level = Number(params.level ?? 1);
  const data = await loadLevelData(game.assets, game.strings, level);
  const victoryType = params.victory !== undefined && level <= 3 ? Number(params.victory) : LEVEL_VICTORY[level] ?? 0;
  const sim = new Simulation(data, { game, victoryType });
  sim.mode = params.mode ?? (level <= 3 ? 'freeplay' : level >= 90 ? 'tutorial' : 'campaign');
  await sim.newsEngine.load(game.assets, game.strings.lang);
  const aiDefs = await loadAIDefs(game.assets);
  const playerName = game.settings?.playerName || 'Player';
  const usedNames = new Set();
  const pickName = () => {
    const free = AI_NAMES.filter((n) => !usedNames.has(n));
    const n = free[Math.floor(Math.random() * free.length)];
    usedNames.add(n);
    return n;
  };

  if (data.makeSave) {
    const ms = iniObject(data.makeSave);
    const clients = Object.keys(ms).filter((k) => /^CLIENT\d+$/.test(k)).sort((a, b) => a.slice(6) - b.slice(6));
    clients.forEach((k, i) => {
      const slot = Number(k.slice(6));
      const sims = data.makeSaveSims[k] ?? {};
      const set = sims.SETTINGS ?? {};
      const cash = set.Treasury || 1000000;
      const isPlayer = slot === 0;
      const name = isPlayer ? playerName : MISSION_NAMES[level]?.[slot - 1] ?? pickName();
      usedNames.add(name);
      const c = sim.addCompany(slot, { name, isPlayer, cash, debt: set.Debts || 0, debtDays: set.DebtsTime || 0 });
      applyMakeSave(sim, c, sims);
      if (!isPlayer) c.ai = new AIController(sim, c, Math.min(7, Math.floor((ms[k].AI ?? 0) / 10)), aiDefs, !!params.conspiratorial);
    });
    // Global [TECHNOTREE] = patent registry: -2 public domain, -1 nobody, n = owner slot.
    for (const [key, v] of Object.entries(ms.TECHNOTREE ?? {})) {
      const m = /^C(\d)(\d)(\d)$/.exec(key);
      if (m && v !== -1) sim.patents.set(`${m[1]},${m[2]},${m[3]}`, v);
    }
  } else {
    const opt = START_MONEY.findIndex(([cash, debt]) => cash === Number(params.playerCash ?? 1000000) && debt === 0);
    const [cash, debt, days] = START_MONEY[opt >= 0 ? opt : 0];
    sim.addCompany(0, { name: playerName, isPlayer: true, cash, debt, debtDays: days });
    const opponents = params.opponents ?? [{ slot: 1, ai: 0 }, { slot: 2, ai: 1 }];
    for (const o of opponents) {
      // Computer players never start in debt (start option clamped to <= 3) [C 0x448f30].
      const optAI = Math.min(3, Math.max(0, START_MONEY.findIndex(([c2]) => c2 === o.cash)));
      const [c2] = START_MONEY[o.cash === undefined ? 0 : optAI];
      const c = sim.addCompany(o.slot, { name: pickName(), cash: c2 });
      c.ai = new AIController(sim, c, o.ai, aiDefs, !!params.conspiratorial);
    }
  }
  for (const c of sim.companies) if (c) c.updateAvailability();
  // Job applicants: an unemployed worker's CV needs 2 days of HR work (POPULATE_CV, 100 free per tick plus the
  // HR manager's recruitment bar) before it reaches a company. Workers start at staggered points so each job's
  // applicants arrive one by one over roughly two months (the first straight away) rather than all on day 10
  // [inferred: the original's starting progress could not be confirmed from the code].
  const need = 2 * sim.data.setup.AMOUNT_OF_WORK_PER_DAY;
  const perDay = sim.data.setup.DEFAULT_TIME_SPEND_ON_POPULATING_CV * sim.data.setup.NUMBER_OF_SIM_LOOPS_PER_DAY;
  for (const c of sim.companies) {
    if (!c) continue;
    c.cvProgress = new Map();
    const byJob = new Map();
    for (const w of sim.workers) if (w.owner === -1) (byJob.get(w.JobType) ?? byJob.set(w.JobType, []).get(w.JobType)).push(w);
    for (const list of byJob.values()) {
      list.sort(() => Math.random() - 0.5);
      const spacing = 60 / list.length; // days between applicants of this job
      list.forEach((w, k) => c.cvProgress.set(w.index, k === 0 ? need : Math.round(need - (k * spacing + Math.random() * spacing * 0.5) * perDay)));
    }
  }
  sim.createMarket();
  sim.levelNo = level;
  // Campaign levels LEVEL04..12 are missions 0..8 (MISSIONn strings).
  sim.mission = params.mission !== undefined ? Number(params.mission) : level >= 4 && level <= 12 ? level - 4 : null;
  return sim;
}

// MakeSaveSim [OBJECTS] / [DESKTOPS] / [WORKERS] / [SETTINGS] / [LABOMACHINE] / [TECHNOTREE].
function applyMakeSave(sim, c, ms) {
  const objs = ms.OBJECTS ?? {};
  OBJECT_KEYS.forEach((k, type) => {
    const lvl = objs[k] ?? 0;
    if (lvl > 0) { c.objects[type] = lvl; c.applyObjectEffects(type, lvl); }
  });
  const desks = ms.DESKTOPS ?? {};
  WORKSTATION_KEYS.forEach((k, i) => {
    const lvl = desks[k] ?? 0;
    const d = c.desksFor(i).find((x) => x.Level === lvl);
    if (d && lvl > 0) c.workstations[i].deskId = d.index;
  });
  for (const [k, v] of Object.entries(ms.LABOMACHINE ?? {})) {
    const m = /Machine(\d+)/.exec(k);
    if (m && v) c.machines[Number(m[1])] = true;
  }
  for (const [key, v] of Object.entries(ms.TECHNOTREE ?? {})) {
    const m = /^C(\d)(\d)(\d)$/.exec(key);
    if (!m || v !== 1) continue;
    const t = c.component(Number(m[1]), Number(m[2]), Number(m[3]));
    if (t) t.state = 3;
  }
  c.updateAvailability();
  const set = ms.SETTINGS ?? {};
  c.flags.blackOps = !!set.BlackOps;
  c.flags.mafia = !!set.ContactMafia;
  if (set.Stock > 0) {
    // Starting stock of a product made of C<cat>L / C<cat>E components.
    for (let cat = 0; cat < c.tech.length; cat++) {
      const L = set[`C${cat}L`] ?? 0, E = set[`C${cat}E`] ?? 0;
      const t = c.component(cat, L, E);
      if (t) { t.state = 3; c.line[cat] = { L, E, provider: 0 }; }
    }
    c.stock = set.Stock;
    c.price = Math.min(c.setup.MAX_PRICE, Math.max(10, Math.ceil((c.unitCost * 2) / 10) * 10));
    c.updateAvailability();
  }
  const workers = ms.WORKERS ?? {};
  WORKSTATION_KEYS.forEach((k, i) => {
    const id = workers[k];
    if (id === undefined || id < 0) return;
    const w = sim.workers[id];
    if (!w || w.owner !== -1) return;
    w.salary = c.refSalary(w.JobType, w.level);
    c.hire(i, id, w.salary);
  });
}

// AI personality defines IADef01..08 (LEVEL01/Ia; every level uses LEVEL01's AI files).
async function loadAIDefs(assets) {
  const out = [];
  for (let i = 1; i <= 8; i++) {
    try {
      const ini = await assets.loadIni(`LEVEL/LEVEL01/Ia/IADef0${i}.ini`);
      out.push(iniObject(ini).DEFINES ?? {});
    } catch { out.push({}); }
  }
  return out;
}
