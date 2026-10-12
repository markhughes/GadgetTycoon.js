// Loads one level's simulation data from the decoded INIs (DATA/LEVEL/LEVELxx/Simulation/*.ini) plus the
// localised name lists from DATA/TRAD. Everything here is static for the duration of a game.
import { iniObject, sectionObject } from '../engine/assets.js';

// E_JOB_TYPE (WorkstationList.ini / DesktopList.ini "new" numbering).
export const JOB = {
  LAWYER: 0, FINANCIER: 1, MANAGER: 2, SPY: 3, PUB: 4, COM: 5, MAFIOSI: 6, SEARCHER: 7, DRIVER_CHIEF: 8, DRIVER: 9, GUARDIAN: 10,
};
export const JOB_KEYS = ['ACCOUNTANT', 'FINANCIER', 'MANAGER', 'SPY', 'PUB', 'COM', 'MAFIOSI', 'SEARCHER', 'DRIVER_CHIEF', 'DRIVER', 'GUARDIAN'];

// The 17 workstations, in WorkstationList.ini order, with the MakeSave key naming each slot.
export const WORKSTATION_KEYS = ['Lawyer', 'Accountant', 'Manager', 'Pub', 'Com', 'Searcher1', 'Searcher2', 'Searcher3', 'Searcher4',
  'DriverChief', 'Driver1', 'Driver2', 'Driver3', 'Driver4', 'Guardian', 'Spy', 'Mafiosi'];

// Department of each job (used for equipment objects, motivation and threats).
export const DEPT = { MARKETING: 0, ADMIN: 1, LABO: 2, PROD: 3, OUTSIDE: 4 };
export const JOB_DEPT = [DEPT.ADMIN, DEPT.ADMIN, DEPT.ADMIN, DEPT.OUTSIDE, DEPT.MARKETING, DEPT.MARKETING, DEPT.OUTSIDE,
  DEPT.LABO, DEPT.PROD, DEPT.PROD, DEPT.OUTSIDE];

// ObjectList.ini object types: 4 per department (wall, alarm, efficiency, spirit).
export const OBJECT_KIND = ['WALL', 'ALARM', 'EFFICIENT', 'SPIRIT'];
export const OBJECT_DEPTS = ['MARKETING', 'ADMIN', 'LABO', 'PROD'];
// MakeSaveSim [OBJECTS] keys in ObjectType order.
export const OBJECT_KEYS = ['WallMark', 'AlarmMark', 'EffMark', 'SpiritMark', 'WallAdmin', 'AlarmAdmin', 'EffAdmin', 'SpiritAdmin',
  'WallLabo', 'AlarmLabo', 'EffLabo', 'SpiritLabo', 'WallProd', 'AlarmProd', 'EffProd', 'SpiritProd'];

// E_ACTIONS order (ActionList.ini section order; the comment block at the top of that file is out of date).
export const ACTIONS = [
  'BAR_ORGANIZE_TREASURY', 'BAR_OPTIMIZE_DELAYS', 'BAR_SEARCH_LOAN', 'FLG_BLACK_OPS', 'FLG_CONTACT_MAFIA',
  'BTN_ESPIONAGE_TRIAL', 'BTN_SLANDER_SOCIETY', 'BTN_LAUNCH_FISCAL_CONTROL', 'BAR_POPULATE_CV_DRH_PARTICIPATION',
  'BAR_CORRUPT_EXTERNAL_WORKERS', 'BTN_MOTIVATE_ADMIN_AND_MARK', 'BTN_MOTIVATE_PRODUCTION',
  'BTN_MOTIVATE_LABORATORY', 'BTN_MOTIVATE_SPECIALS', 'BAR_OPTIMIZE_TECHNOIDS_BUDGET',
  'BAR_OPTIMIZE_EMOTIVES_BUDGET', 'FLG_GET_ZEPPELIN', 'FLG_GET_MOON_CONCESSION', 'BAR_NEGOTIATE_SELLING_PRICE',
  'BAR_PRODUCT_PRESENCE', 'BTN_CORRUPT_DISTRIBUTOR', 'FLG_DEAL_OLD_STOCK', 'BAR_SEARCH_COMPONENT',
  'BAR_ASSEMBLE_COMPONENTS', 'BAR_MANUFACTURE_COMPONENT', 'BAR_MAINTAIN_MACHINE', 'BTN_REPAIR_MACHINE',
  'BAR_CONTROL_ADMIN_AND_MARK', 'BAR_CONTROL_PRODUCTION', 'BAR_CONTROL_LABORATORY', 'BTN_STEAL_PATENT',
  'BTN_SABOTAGE_PRODUCTION', 'BTN_SPY_ADMIN_AND_MARK', 'BTN_THREATEN_ADMIN_AND_MARK_WORKER',
  'BTN_THREATEN_PRODUCTION_WORKER', 'BTN_THREATEN_LABORATORY_WORKER', 'BTN_THREATEN_SPECIAL_WORKER', 'POPULATE_CV',
  'TRAINING', 'END_MOTIVATION_SECTOR', 'END_THREATEN_SECTOR', 'END_NEWS_INFLUENCE_ON_IMAGE_PRODUCT', 'LAUNCH_NEWS',
  'LAUNCH_NEWS_EFFECT',
];
export const ACTION = Object.fromEntries(ACTIONS.map((n, i) => [n, i]));

export const PRODUCTS = {
  Toilet: { key: 'WC', sign: 'WC', stocks: 'ProductionStocks', board: 'Prod_Board', cartons: 'Market_CartonsWC', plv: 'Market_PLV_WC', preview: 'Product_WC' },
  Roller: { key: 'Roller', sign: 'Roller', stocks: 'ProductionStocksRollers', board: 'Prod_Board_Rollers', cartons: 'Market_CartonsRoller', plv: 'Market_PLV_Roller', preview: 'Product_Roller' },
  Robot: { key: 'Robot', sign: 'Robot', stocks: 'ProductionStocksRobot', board: 'Prod_Board_Robot', cartons: 'Market_CartonsRobot', plv: 'Market_PLV_Robot', preview: 'Product_Robot' },
};

const csv = (v) => (v === undefined || v === null || v === '' ? [] : String(v).split(/[ ,]+/).filter(Boolean).map(Number));

// Indexed sections ([0], [1], ...) -> array of objects.
function list(ini) {
  return ini.filter((s) => /^\d+$/.test(s.name)).sort((a, b) => a.name - b.name).map((s) => sectionObject(s));
}

export async function loadLevelData(assets, strings, levelNo) {
  const dir = `LEVEL/LEVEL${String(levelNo).padStart(2, '0')}/Simulation`;
  const ini = (name) => assets.loadIni(`${dir}/${name}`);
  const opt = async (name) => { try { return await ini(name); } catch { return null; } };

  const simLevel = iniObject(await ini('SimLevel.ini'));
  const files = simLevel.FILES;
  const setup = iniObject(await ini('SetupSim.ini')).SimGlobal;
  const salaries = iniObject(await ini(files.WorkersSalary));

  const techno = await ini(files.TechnoTree);
  const productName = String(files.TechnoTree).replace(/\.ini$/i, '');
  const technoHead = sectionObject(techno.find((s) => s.name === '0'));
  const categories = [];
  for (const s of techno.filter((x) => x.name !== '0').sort((a, b) => a.name - b.name)) {
    const file = sectionObject(s).CompoFile;
    const comps = list(await ini(file)).map((c, i) => ({ ...c, index: i }));
    categories.push({ file, name: file.replace(/\.ini$/i, '').replace(productName, ''), components: comps });
  }
  const machines = list(await ini(technoHead.MachineFile));

  const data = {
    level: levelNo,
    dir,
    product: productName,
    productInfo: PRODUCTS[productName] ?? PRODUCTS.Toilet,
    setup,
    simLevel,
    salary: salaries.SALARY,
    salaryMultiplier: [0, ...[1, 2, 3, 4].map((l) => salaries.MULTIPLICATOR?.[`LEVEL${l}`] ?? l)],
    workers: list(await ini(files.Workers)).map((w, i) => ({ ...w, index: i })),
    workstations: list(await ini(files.Workstations)).map((w, i) => ({
      ...w, index: i, key: WORKSTATION_KEYS[i], barActions: csv(w.BarActions), buttonActions: csv(w.ButtonActions), flags: csv(w.Flags),
    })),
    desktops: list(await ini(files.Desktops)).map((d, i) => ({ ...d, index: i })),
    objects: list(await ini(files.Objects)).map((o, i) => ({ ...o, index: i })),
    creditors: list(await ini(files.Creditors)).map((c, i) => ({ ...c, index: i })),
    actions: list(await ini(files.ActionList)).map((a, i) => ({ ...a, index: i, id: ACTIONS[i] })),
    market: iniObject(await ini(files.Market)),
    levelNews: await opt(files.LevelNews),
    techno: { head: technoHead, categories, machines },
    providers: technoHead.ProviderName ? list((await opt(`${technoHead.ProviderName}.ini`)) ?? []) : [],
    makeSave: await opt('MakeSave.ini'),
    makeSaveSims: {},
    text: {},
  };

  // MakeSave*.ini describe the starting state of campaign/tutorial levels (see docs/simulation.md).
  if (data.makeSave) {
    const ms = iniObject(data.makeSave);
    for (const [k, v] of Object.entries(ms)) {
      if (/^CLIENT\d+$/.test(k) && v.Save) data.makeSaveSims[k] = iniObject(await ini(v.Save));
    }
  }

  // Localised lists (names/descriptions referenced by index from the INIs above).
  for (const name of ['WorkerList', 'WorkstationList', 'DesktopList', 'ObjectList', 'CreditorList', 'ProviderList',
    `${productName}Machines`, `${productName}Provider`, ...categories.map((c) => c.file.replace(/\.ini$/i, ''))]) {
    try { data.text[name] = await strings.list(name); } catch { /* not every list exists for every product */ }
  }
  return data;
}

// Text lookup helper for list files: text(data, 'WorkerList', id) -> String.
export function listText(data, list, id) {
  const e = data.text[list]?.[id];
  return e?.String ?? e?.string ?? e?.STRING ?? '';
}
