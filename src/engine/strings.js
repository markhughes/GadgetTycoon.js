// Localised text from DATA/TRAD. Languages: eng, fre, ger, ita, esp, bra, neh.
//
// Strings__TRAD.<lang>: [ID] sections with STRING = "...".  Other list files (ObjectList, WorkerList,
// ProviderList, ...) use [n] sections with String = "...". News__TRAD / Scenario__TRAD follow the
// Strings__TRAD layout.

export class Strings {
  constructor(assets, lang = 'eng') {
    this.assets = assets;
    this.lang = lang;
    this.table = new Map();
    this.lists = new Map();
  }

  async init() {
    for (const file of ['Strings__TRAD', 'Scenario__TRAD', 'News__TRAD', 'Credits__TRAD', 'Song__TRAD', 'Song2__TRAD']) {
      try {
        const ini = await this.assets.loadIni(`TRAD/${file}.${this.lang}`);
        for (const s of ini) {
          const e = s.entries.find(([k]) => k.toUpperCase() === 'STRING');
          if (e) this.table.set(s.name, String(e[1]));
        }
      } catch (e) {
        console.warn(e.message);
      }
    }
  }

  // Returns the string for an id, or the id itself so missing strings are visible.
  get(id, ...args) {
    let s = this.table.get(id) ?? id;
    if (args.length) s = format(s, args);
    return s;
  }

  has(id) {
    return this.table.has(id);
  }

  // List-style TRAD files (ObjectList, WorkerList, DesktopList, ...): returns { index: { String, ... } }.
  async list(name) {
    if (this.lists.has(name)) return this.lists.get(name);
    const ini = await this.assets.loadIni(`TRAD/${name}.${this.lang}`);
    const out = {};
    for (const s of ini) {
      const o = {};
      for (const [k, v] of s.entries) o[k] = v;
      out[s.name] = o;
    }
    this.lists.set(name, out);
    return out;
  }
}

// printf-style %s / %d / %i / %f substitution used by the original string table.
export function format(s, args) {
  let i = 0;
  return String(s).replace(/%(\.\d+)?[sdif%]/g, (m, prec) => {
    if (m === '%%') return '%';
    const v = args[i++];
    if (m.endsWith('f') && typeof v === 'number') return v.toFixed(prec ? Number(prec.slice(1)) : 2);
    return v ?? '';
  });
}
