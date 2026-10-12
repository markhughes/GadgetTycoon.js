// Loads the content produced by tools/extract.js (public/data).
// Sprites are loaded lazily: request() starts a load and returns null until ready,
// so rendering code can draw whatever is available without blocking the frame.

const DATA = 'data';

// Shadow pixels are stored with alpha exactly 128 (see tools/lib/databank.js SHADOW_ALPHA).
const SHADOW_ALPHA = 128;

function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

function stripShadows(img) {
  const c = toCanvas(img);
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < d.data.length; i += 4) if (d.data[i] === SHADOW_ALPHA) d.data[i] = 0;
  ctx.putImageData(d, 0, 0);
  return c;
}

export class Assets {
  constructor() {
    this.shadows = true;
    this.manifest = null;
    this.sprites = new Map(); // name -> { meta, image } | Promise
    this.images = new Map();
    this.ini = new Map();
    this.text = new Map();
    this.missing = new Set();
  }

  async init() {
    const res = await fetch(`${DATA}/manifest.json`);
    if (!res.ok) throw new Error('public/data/manifest.json not found — run `npm run unpack && npm run extract` first.');
    this.manifest = await res.json();
  }

  hasSprite(name) {
    return !!this.manifest.sprites?.[name];
  }

  loadImageElement(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load ${url}`));
      img.src = url;
    });
  }

  async loadSprite(name) {
    if (this.sprites.has(name)) {
      const s = this.sprites.get(name);
      return s instanceof Promise ? s : s;
    }
    if (!this.hasSprite(name)) {
      if (!this.missing.has(name)) console.warn(`unknown sprite ${name}`);
      this.missing.add(name);
      return null;
    }
    const p = Promise.all([
      fetch(`${DATA}/sprites/${name}.json`).then((r) => r.json()),
      this.loadImageElement(`${DATA}/sprites/${encodeURIComponent(name)}.png`),
    ]).then(([meta, image]) => {
      const s = { meta, image: this.shadows ? image : stripShadows(image), name };
      this.sprites.set(name, s);
      return s;
    });
    this.sprites.set(name, p);
    return p;
  }

  // Selected objects are drawn with every pixel ANDed with RGB565 0xF81F (green removed) [code 0x48e29d].
  tinted(s) {
    if (s.tinted) return s.tinted;
    const c = toCanvas(s.image);
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) if (d.data[i + 3] === 255) d.data[i + 1] = 0;
    ctx.putImageData(d, 0, 0);
    s.tinted = c;
    return c;
  }

  // Non-blocking accessor used while rendering.
  sprite(name) {
    const s = this.sprites.get(name);
    if (s && !(s instanceof Promise)) return s;
    if (!s) this.loadSprite(name).catch((e) => console.warn(e));
    return null;
  }

  async loadImage(name) {
    if (this.images.has(name)) return this.images.get(name);
    const p = this.loadImageElement(`${DATA}/images/${name}.png`).then((img) => {
      this.images.set(name, img);
      return img;
    });
    this.images.set(name, p);
    return p;
  }

  image(name) {
    const s = this.images.get(name);
    if (s && !(s instanceof Promise)) return s;
    if (!s) this.loadImage(name).catch((e) => console.warn(e));
    return null;
  }

  // True if the extractor produced this INI/TRAD file (paths are case-insensitive, as on Windows).
  hasIni(path) {
    this.iniIndex ??= new Map((this.manifest.ini ?? []).map((p) => [p.toLowerCase(), p]));
    return this.iniIndex.has(path.toLowerCase());
  }

  // Parsed INI: [{ name, entries: [[key, value]...] }]. path is relative to DATA/, e.g. "INI/Sounds.ini".
  async loadIni(path) {
    if (this.manifest?.ini) {
      if (!this.hasIni(path)) throw new Error(`missing ini ${path}`);
      path = this.iniIndex.get(path.toLowerCase());
    }
    if (this.ini.has(path)) return this.ini.get(path);
    const p = fetch(`${DATA}/ini/${path}.json`).then((r) => {
      if (!r.ok) throw new Error(`missing ini ${path}`);
      return r.json();
    });
    this.ini.set(path, p);
    const v = await p;
    this.ini.set(path, v);
    return v;
  }

  async preload({ sprites = [], images = [], ini = [] }) {
    await Promise.all([
      ...sprites.map((s) => this.loadSprite(s)),
      ...images.map((s) => this.loadImage(s)),
      ...ini.map((s) => this.loadIni(s)),
    ]);
  }
}

// Helpers for the parsed INI structure.
export function section(ini, name) {
  return ini.find((s) => s.name === name);
}

export function sectionObject(sec) {
  const o = {};
  if (!sec) return o;
  for (const [k, v] of sec.entries) {
    if (k in o) o[k] = [].concat(o[k], v);
    else o[k] = v;
  }
  return o;
}

export function iniObject(ini) {
  const out = {};
  for (const s of ini) out[s.name] = sectionObject(s);
  return out;
}
