// Widget toolkit modelled on the original engine's widgets.
//
// Button sprites have 6 frames (verified at 0x49bb37 in GadgetTycoon.exe):
//   0/1 disabled (usually 1x1 blanks -> disabled buttons are invisible), 2 normal, 3 hover,
//   4 pressed/checked, 5 pressed/checked + hover. Toggles with more than 6 frames use 6/7 when disabled.
// Button labels use a normal font and a hover font (0x40cc70 sets normal/hover/disabled fonts).

export class Widget {
  constructor(x, y, w, h) {
    Object.assign(this, { x, y, w, h, visible: true, enabled: true, children: [], parent: null });
  }

  add(...ws) {
    for (const w of ws) { w.parent = this; this.children.push(w); }
    return ws[0];
  }

  remove(w) {
    this.children = this.children.filter((c) => c !== w);
  }

  get game() { return this._game ?? this.parent?.game; }
  set game(g) { this._game = g; }

  get ax() { return this.x + (this.parent?.ax ?? 0); }
  get ay() { return this.y + (this.parent?.ay ?? 0); }

  contains(px, py) {
    return px >= this.ax && py >= this.ay && px < this.ax + this.w && py < this.ay + this.h;
  }

  // Returns true if handled.
  event(ev, input) {
    if (!this.visible) return false;
    for (let i = this.children.length - 1; i >= 0; i--) if (this.children[i].event(ev, input)) return true;
    return this.onEvent?.(ev, input) ?? false;
  }

  update(dt, input) {
    // selfVisible widgets decide their own visibility in onUpdate, so they must keep updating while hidden.
    if (!this.visible && !this.selfVisible) return;
    this.onUpdate?.(dt, input);
    if (!this.visible) return;
    for (const c of this.children) c.update(dt, input);
  }

  draw(r, input) {
    if (!this.visible) return;
    this.onDraw?.(r, input);
    for (const c of this.children) c.draw(r, input);
  }
}

// Top of a widget tree; gives every descendant access to the game (for UI sounds) and shows tooltips.
// Tooltips follow the original [code 0x483cd0]: shown after the pointer rests HINT_DELAY (200 ms) on a
// widget, drawn as a 50%-darkened box (text width + 4) above the pointer in Fonte_White_11x13VABBd.
export const HINT_DELAY = 0.2;

export class Root extends Widget {
  constructor(game, w, h) {
    super(0, 0, w, h);
    this.game = game;
    this.hintTarget = null;
    this.hintTime = 0;
  }

  // Deepest visible widget under (px, py) that has a tooltip.
  hintAt(w, px, py) {
    if (!w.visible) return null;
    for (let i = w.children.length - 1; i >= 0; i--) {
      const hit = this.hintAt(w.children[i], px, py);
      if (hit) return hit;
    }
    return w !== this && w.tooltip && w.contains(px, py) ? w : null;
  }

  event(ev, input) {
    for (const c of openCombos(this)) if (c.event(ev, input)) return true;
    return super.event(ev, input);
  }

  update(dt, input) {
    super.update(dt, input);
    const t = input.inside && !input.down ? this.hintAt(this, input.x, input.y) : null;
    if (t !== this.hintTarget) { this.hintTarget = t; this.hintTime = 0; }
    else this.hintTime += dt;
  }

  draw(r, input) {
    super.draw(r, input);
    for (const c of openCombos(this)) c.drawDrop(r);
    if (!this.hintTarget || this.hintTime < HINT_DELAY) return;
    const raw = typeof this.hintTarget.tooltip === 'function' ? this.hintTarget.tooltip() : this.hintTarget.tooltip;
    const text = raw && this.game.strings ? this.game.strings.get(raw) : raw;
    if (!text) return;
    const font = 'Fonte_White_11x13VABBd';
    const lines = String(text).split(/\n|\\n/);
    const lh = 14;
    const w = Math.max(...lines.map((l) => r.measure(font, l))) + 4;
    const h = lines.length * lh + 4;
    const x = Math.max(0, Math.min(r.width - w, input.x + 8));
    const y = Math.max(0, Math.min(r.height - h, input.y - h));
    r.rect(x, y, w, h, 'rgba(0,0,0,0.5)');
    lines.forEach((l, i) => r.text(font, l, x + w / 2, y + 2 + (i + 1) * lh - 3, { align: 'center' }));
  }
}

// Plain container with optional background (image name, sprite, or fill colour).
export class Panel extends Widget {
  constructor(x, y, w, h, { image = null, sprite = null, frame = 0, fill = null, border = null, modal = false } = {}) {
    super(x, y, w, h);
    Object.assign(this, { image, spriteName: sprite, frame, fill, border, modal });
  }
  onDraw(r) {
    if (this.fill) r.rect(this.ax, this.ay, this.w, this.h, this.fill);
    if (this.image) r.image(this.image, this.ax, this.ay);
    if (this.spriteName) r.sprite(this.spriteName, this.frame, this.ax, this.ay, { anchor: 'topleft' });
    if (this.border) r.strokeRect(this.ax, this.ay, this.w, this.h, this.border);
  }
  onEvent(ev) {
    // Swallow clicks that land on the panel so they don't reach the world underneath.
    return (this.modal || ev.type === 'down' || ev.type === 'up') && ev.x !== undefined && this.contains(ev.x, ev.y);
  }
}

export class Label extends Widget {
  constructor(x, y, text, { font = 'Fonte_White_11x13VABBd', align = 'left', width = 0, lineHeight = 14 } = {}) {
    super(x, y, width, lineHeight);
    Object.assign(this, { text, font, align, lineHeight });
  }
  onDraw(r) {
    const t = typeof this.text === 'function' ? this.text() : this.text;
    if (t === undefined || t === null) return;
    if (this.w) {
      const ax = this.align === 'center' ? this.ax : this.ax;
      r.textBox(this.font, String(t), ax, this.ay, this.w, this.lineHeight, { align: this.align });
    } else {
      r.text(this.font, String(t), this.ax, this.ay, { align: this.align });
    }
  }
}

export class Button extends Widget {
  // sprite: 6-frame button sprite set; label: optional text drawn over it.
  constructor(x, y, sprite, { w, h, label = null, font = null, hoverFont = null, labelX = null, labelY = null,
    onClick = null, toggle = false, checked = false, sound = 'click', tooltip = null } = {}) {
    super(x, y, w ?? 0, h ?? 0);
    Object.assign(this, { sprite, label, font, hoverFont, labelX, labelY, onClick, toggle, checked, sound, tooltip });
    this.pressed = false;
    this.hover = false;
    this.sized = w !== undefined;
  }

  frame() {
    if (!this.enabled) return 0;
    const down = this.pressed && this.hover;
    if (this.toggle && this.checked) return this.hover ? 5 : 4;
    if (down) return 4;
    return this.hover ? 3 : 2;
  }

  onUpdate(dt, input) {
    this.hover = this.enabled && input.inside && this.contains(input.x, input.y);
    if (this.hover && !this.wasHover) this.game?.ui.hovered(this);
    this.wasHover = this.hover;
  }

  onEvent(ev) {
    if (!this.enabled || ev.x === undefined) return false;
    if (ev.type === 'down' && ev.button === 0 && this.contains(ev.x, ev.y)) {
      this.pressed = true;
      return true;
    }
    if (ev.type === 'up' && ev.button === 0 && this.pressed) {
      this.pressed = false;
      if (this.contains(ev.x, ev.y)) {
        if (this.toggle) this.checked = !this.checked;
        this.game?.ui.clicked(this);
        this.onClick?.(this);
      }
      return true;
    }
    return false;
  }

  onDraw(r) {
    if (this.sprite) {
      const f = r.sprite(this.sprite, this.frame(), this.ax, this.ay, { anchor: 'topleft' });
      if (f && !this.sized && f.w > 2) { this.w = f.w; this.h = f.h; }
    }
    if (this.label) {
      const font = this.hover && this.hoverFont ? this.hoverFont : this.font;
      if (!font) return;
      const t = typeof this.label === 'function' ? this.label() : this.label;
      const lx = this.labelX ?? this.w / 2;
      const ly = this.labelY ?? this.h / 2 + 6;
      r.text(font, t, this.ax + lx, this.ay + ly, { align: this.labelX === null ? 'center' : 'left' });
    }
  }
}

// Text-only button (menu entries drawn with a font and a highlight font).
export class TextButton extends Button {
  constructor(x, y, w, h, label, opts = {}) {
    super(x, y, null, { w, h, label, labelX: opts.labelX ?? 0, labelY: opts.labelY ?? h - 4, ...opts });
  }
}

export class Slider extends Widget {
  constructor(x, y, w, { value = 0.5, onChange = null, sprite = 'Menu_Slider', track = '#3a4a8a' } = {}) {
    super(x, y, w, 19);
    Object.assign(this, { value, onChange, sprite, track, dragging: false });
  }
  setFromX(px) {
    this.value = Math.max(0, Math.min(1, (px - this.ax) / this.w));
    this.onChange?.(this.value);
  }
  onEvent(ev) {
    if (ev.type === 'down' && ev.button === 0 && this.contains(ev.x, ev.y)) { this.dragging = true; this.setFromX(ev.x); return true; }
    if (ev.type === 'up' && this.dragging) { this.dragging = false; return true; }
    return false;
  }
  onUpdate(dt, input) {
    if (this.dragging) this.setFromX(input.x);
  }
  onDraw(r) {
    if (this.track) r.rect(this.ax, this.ay + 8, this.w, 3, this.track);
    r.sprite(this.sprite, 2, this.ax + this.value * this.w - 5, this.ay, { anchor: 'topleft' });
  }
}

// Scrollable list of rows. items: array of anything; renderRow(r, item, x, y, w, selected, hover).
export class ListBox extends Widget {
  constructor(x, y, w, h, { rowHeight = 16, items = [], renderRow, onSelect = null, onActivate = null } = {}) {
    super(x, y, w, h);
    Object.assign(this, { rowHeight, items, renderRow, onSelect, onActivate, scroll: 0, selected: -1, hoverRow: -1 });
  }
  get visibleRows() { return Math.floor(this.h / this.rowHeight); }
  setItems(items) {
    this.items = items;
    this.scroll = Math.min(this.scroll, Math.max(0, items.length - this.visibleRows));
    if (this.selected >= items.length) this.selected = -1;
  }
  rowAt(py) {
    const i = Math.floor((py - this.ay) / this.rowHeight) + this.scroll;
    return i >= 0 && i < this.items.length ? i : -1;
  }
  onUpdate(dt, input) {
    this.hoverRow = input.inside && this.contains(input.x, input.y) ? this.rowAt(input.y) : -1;
  }
  onEvent(ev) {
    if (ev.x === undefined || !this.contains(ev.x, ev.y)) return false;
    if (ev.type === 'wheel') {
      this.scroll = Math.max(0, Math.min(Math.max(0, this.items.length - this.visibleRows), this.scroll + ev.delta));
      return true;
    }
    if (ev.type === 'down' && ev.button === 0) {
      const i = this.rowAt(ev.y);
      const now = performance.now();
      if (i >= 0) {
        const dbl = i === this.selected && now - (this.lastClick ?? 0) < 350;
        this.selected = i;
        this.onSelect?.(this.items[i], i);
        if (dbl) this.onActivate?.(this.items[i], i);
        this.game?.ui.clicked(this);
      }
      this.lastClick = now;
      return true;
    }
    return ev.type === 'up';
  }
  onDraw(r) {
    const c = r.ctx;
    c.save();
    c.beginPath();
    c.rect(this.ax, this.ay, this.w, this.h);
    c.clip();
    for (let k = 0; k < this.visibleRows + 1; k++) {
      const i = this.scroll + k;
      if (i >= this.items.length) break;
      this.renderRow(r, this.items[i], this.ax, this.ay + k * this.rowHeight, this.w, i === this.selected, i === this.hoverRow);
    }
    c.restore();
    if (this.items.length > this.visibleRows) {
      const th = Math.max(8, (this.visibleRows / this.items.length) * this.h);
      const ty = this.ay + (this.scroll / (this.items.length - this.visibleRows)) * (this.h - th);
      r.rect(this.ax + this.w - 3, ty, 3, th, 'rgba(160,190,255,0.6)');
    }
  }
}

// Horizontal gauge [code 0x488162]: a sprite whose frame 0 is the empty bar and frame 1 the full bar,
// clipped to value / max.
export class Gauge extends Widget {
  constructor(x, y, w, h, sprite, { value = 0, max = 100, tooltip = null } = {}) {
    super(x, y, w, h);
    Object.assign(this, { sprite, value, max, tooltip });
  }
  onDraw(r) {
    const v = typeof this.value === 'function' ? this.value() : this.value;
    const s = r.assets.sprite(this.sprite);
    if (!s) return;
    const [bg, fg] = s.meta.frames;
    r.ctx.drawImage(s.image, bg.x, bg.y, bg.w, bg.h, this.ax, this.ay, bg.w, bg.h);
    const fw = Math.round(Math.max(0, Math.min(1, v / this.max)) * fg.w);
    if (fw > 0) r.ctx.drawImage(s.image, fg.x, fg.y, fw, fg.h, this.ax, this.ay, fw, fg.h);
  }
}

// Line graph on the lower bar's green screen [code 0x488244/0x49e799]: up to 8 curves of 50 samples,
// no axes; a half-intensity zero baseline per curve, 1px polyline in the curve colour.
export const CURVE_COLORS = [[255, 0, 0], [123, 244, 212], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 0], [255, 127, 0], [127, 64, 255]];

export class Graph extends Widget {
  constructor(x, y, w, h, { samples = 50, tooltip = null, series = () => [] } = {}) {
    super(x, y, w, h);
    Object.assign(this, { samples, tooltip, series });
  }
  onDraw(r) {
    const curves = this.series(); // [{ color: index, values: number[], min, max }]
    const c = r.ctx;
    for (const cv of curves) {
      const min = cv.min ?? 0, max = cv.max ?? Math.max(1, ...cv.values);
      const span = max - min || 1;
      const [cr, cg, cb] = CURVE_COLORS[cv.color % 8];
      const base = this.ay + (this.h * max) / span;
      if (min <= 0 && max >= 0) {
        c.fillStyle = `rgb(${cr >> 1},${cg >> 1},${cb >> 1})`;
        c.fillRect(this.ax, Math.round(base), this.w, 1);
      }
      c.strokeStyle = `rgb(${cr},${cg},${cb})`;
      c.lineWidth = 1;
      c.beginPath();
      const n = cv.values.length;
      cv.values.forEach((v, i) => {
        const px = this.ax + ((this.samples - n + i) * (this.w - 1)) / (this.samples - 1) + 0.5;
        const py = Math.round(base - (this.h * v) / span) + 0.5;
        i ? c.lineTo(px, py) : c.moveTo(px, py);
      });
      c.stroke();
    }
  }
}

// Grid of icon cells (faces, tech-tree components, competitor logos) with a scroll offset.
export class IconGrid extends Widget {
  constructor(x, y, w, h, { cols, cellW, cellH, items = [], drawCell, onSelect = null, tooltipFor = null } = {}) {
    super(x, y, w, h);
    Object.assign(this, { cols, cellW, cellH, items, drawCell, onSelect, tooltipFor, scroll: 0, selected: -1, hoverCell: -1 });
    this.tooltip = () => (this.hoverCell >= 0 && this.tooltipFor ? this.tooltipFor(this.items[this.hoverCell]) : null);
  }
  get rows() { return Math.floor(this.h / this.cellH); }
  cellAt(px, py) {
    const cx = Math.floor((px - this.ax) / this.cellW), cy = Math.floor((py - this.ay) / this.cellH);
    if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) return -1;
    const i = (cy + this.scroll) * this.cols + cx;
    return i < this.items.length ? i : -1;
  }
  onUpdate(dt, input) {
    this.hoverCell = input.inside && this.contains(input.x, input.y) ? this.cellAt(input.x, input.y) : -1;
  }
  onEvent(ev) {
    if (ev.x === undefined || !this.contains(ev.x, ev.y)) return false;
    if (ev.type === 'wheel') {
      const maxScroll = Math.max(0, Math.ceil(this.items.length / this.cols) - this.rows);
      this.scroll = Math.max(0, Math.min(maxScroll, this.scroll + ev.delta));
      return true;
    }
    if (ev.type === 'down' && ev.button === 0) {
      const i = this.cellAt(ev.x, ev.y);
      if (i >= 0) { this.selected = i; this.onSelect?.(this.items[i], i); this.game?.ui.clicked(this); }
      return true;
    }
    return ev.type === 'up';
  }
  onDraw(r) {
    for (let k = 0; k < this.rows * this.cols; k++) {
      const i = this.scroll * this.cols + k;
      if (i >= this.items.length) break;
      const x = this.ax + (k % this.cols) * this.cellW, y = this.ay + Math.floor(k / this.cols) * this.cellH;
      this.drawCell(r, this.items[i], x, y, i === this.selected, i === this.hoverCell);
    }
  }
}

// Text in a rectangle, vertically centred on the font's cap height (like the original's aligned labels).
// text and font may be functions so values refresh every frame.
export class TextField extends Widget {
  constructor(x, y, w, h, text, { font = 'Fonte_Tahoma_violet_13x17_FAR', align = 'left', tooltip = null, pad = 0 } = {}) {
    super(x, y, w, h);
    Object.assign(this, { text, font, align, tooltip, pad });
  }
  onDraw(r) {
    const t = typeof this.text === 'function' ? this.text() : this.text;
    if (t === null || t === undefined || t === '') return;
    const font = typeof this.font === 'function' ? this.font() : this.font;
    const s = r.assets.sprite(font);
    if (!s) return;
    const g = s.meta.frames[48]?.h > 1 ? s.meta.frames[48] : s.meta.frames[65];
    const cap = g ? g.hotY - (g.firstRow ?? 0) : 8; // inked height: some fonts pad glyphs with blank rows on top
    const base = this.ay + Math.round((this.h + cap) / 2);
    const x = this.align === 'right' ? this.ax + this.w - this.pad : this.align === 'center' ? this.ax + this.w / 2 : this.ax + this.pad;
    r.text(font, String(t), x, base, { align: this.align });
  }
}

// Single-line text input [0x488090]. Focus by clicking; typing edits; Enter/Escape blur.
export class EditBox extends Widget {
  constructor(x, y, w, h, { text = '', font = 'FONT_MENU_NOVA14x23', maxLength = 12, onChange = null } = {}) {
    super(x, y, w, h);
    Object.assign(this, { text, font, maxLength, onChange, focused: false });
  }
  onEvent(ev) {
    if (ev.type === 'down') {
      this.focused = ev.x !== undefined && this.contains(ev.x, ev.y);
      return this.focused;
    }
    if (ev.type === 'key' && this.focused) {
      if (ev.key === 'Backspace') this.text = this.text.slice(0, -1);
      else if (ev.key === 'Enter' || ev.key === 'Escape') this.focused = false;
      else if (ev.key.length === 1 && this.text.length < this.maxLength && ev.key.charCodeAt(0) < 256) this.text += ev.key;
      else return true;
      this.onChange?.(this.text);
      return true;
    }
    return false;
  }
  onDraw(r) {
    const s = r.assets.sprite(this.font);
    // Capital height = baseline (hotY) minus the first inked row, so the letters sit centred in the box.
    const A = s?.meta.frames[65];
    const cap = A ? A.hotY - (A.firstRow ?? 0) : 12;
    const base = this.ay + Math.round((this.h + cap) / 2);
    const w = r.text(this.font, this.text, this.ax + 4, base);
    if (this.focused && Math.floor(performance.now() / 400) % 2 === 0) r.rect(this.ax + 5 + w, base - cap, 2, cap, '#9ab0ff');
  }
}

// Drop-down list [0x487f9e]: black list, dark-blue border, Menu_Bouton_Down_Arrow_ListBox at the right edge.
export class ComboBox extends Widget {
  constructor(x, y, w, { items = [], index = 0, rowHeight = 20, dropHeight = 150, font = 'Fonte_GreenBlue_13x16VAAR', onChange = null, enabled = true } = {}) {
    super(x, y, w, rowHeight);
    Object.assign(this, { items, index, rowHeight, dropHeight, font, onChange, open: false, hoverRow: -1, enabled });
  }
  get value() { return this.items[this.index]; }
  label(i) { const it = this.items[i]; return typeof it === 'object' ? it.label : it; }
  dropRect() {
    const h = Math.min(this.dropHeight, this.items.length * this.rowHeight);
    return { x: this.ax, y: this.ay + this.rowHeight, w: this.w, h };
  }
  // The open list draws over siblings, so the root forwards events to open combos first (see openCombos()).
  onEvent(ev) {
    if (!this.enabled || ev.x === undefined) return false;
    if (ev.type === 'down' && ev.button === 0) {
      if (this.open) {
        const d = this.dropRect();
        if (ev.x >= d.x && ev.x < d.x + d.w && ev.y >= d.y && ev.y < d.y + d.h) {
          this.index = Math.floor((ev.y - d.y) / this.rowHeight);
          this.onChange?.(this.value, this.index);
          this.game?.ui.clicked(this);
        }
        this.open = false;
        return true;
      }
      if (this.contains(ev.x, ev.y)) { this.open = true; return true; }
    }
    return this.open && ev.type === 'up';
  }
  onUpdate(dt, input) {
    const d = this.dropRect();
    this.hoverRow = this.open && input.x >= d.x && input.x < d.x + d.w && input.y >= d.y && input.y < d.y + d.h
      ? Math.floor((input.y - d.y) / this.rowHeight) : -1;
  }
  textAt(r, i, y) {
    const s = r.assets.sprite(this.font);
    const cap = s?.meta.frames[65]?.hotY ?? 10;
    r.text(this.font, this.label(i) ?? '', this.ax + 4, y + Math.round((this.rowHeight + cap) / 2));
  }
  onDraw(r) {
    r.rect(this.ax, this.ay, this.w, this.rowHeight, '#000');
    r.strokeRect(this.ax, this.ay, this.w, this.rowHeight, '#00007f');
    if (this.index >= 0) this.textAt(r, this.index, this.ay);
    if (this.enabled) r.sprite('Menu_Bouton_Down_Arrow_ListBox', 2, this.ax + this.w - 18, this.ay, { anchor: 'topleft' });
  }
  drawDrop(r) {
    if (!this.open) return;
    const d = this.dropRect();
    r.rect(d.x, d.y, d.w, d.h, '#000');
    r.strokeRect(d.x, d.y, d.w, d.h, '#00007f');
    this.items.forEach((_, i) => {
      const y = d.y + i * this.rowHeight;
      if (y + this.rowHeight > d.y + d.h) return;
      if (i === this.hoverRow) r.rect(d.x + 1, y, d.w - 2, this.rowHeight, '#1c2c7a');
      this.textAt(r, i, y);
    });
  }
}

// Checkbox using an 8-frame toggle sprite (Menu_CheckBox).
export class CheckBox extends Button {
  constructor(x, y, { checked = false, onChange = null, sprite = 'Menu_CheckBox' } = {}) {
    super(x, y, sprite, { w: 18, h: 18, toggle: true, checked, onClick: (b) => onChange?.(b.checked) });
  }
  frame() {
    if (!this.enabled) return this.checked ? 7 : 6;
    return super.frame();
  }
}

// Collects open combo boxes in a tree so their drop-downs can be drawn last and receive events first.
export function openCombos(w, out = []) {
  if (!w.visible) return out;
  if (w instanceof ComboBox && w.open) out.push(w);
  for (const c of w.children) openCombos(c, out);
  return out;
}
