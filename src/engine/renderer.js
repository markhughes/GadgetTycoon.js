// Canvas 2D renderer for the game's sprites, images and bitmap fonts.
// The game renders at a fixed logical resolution (800x600 like the original) and is scaled to fit.

export const WIDTH = 800;
export const HEIGHT = 600;

export class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.resize(WIDTH, HEIGHT);
  }

  // The original runs its menus at 640x480 and the game at 800x600; scenes pick their resolution.
  resize(w, h) {
    if (this.width === w && this.height === h) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
  }

  clear(color = '#000') {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = color;
    c.fillRect(0, 0, this.width, this.height);
  }

  image(name, x = 0, y = 0) {
    const img = this.assets.image(name);
    if (img) this.ctx.drawImage(img, x, y);
    return img;
  }

  // Draws one frame of a sprite set. By default the frame's hotspot (hotX, hotY) is placed at (x, y);
  // pass { anchor: 'topleft' } to place the frame's top-left corner instead.
  sprite(name, frame, x, y, opts = {}) {
    const s = this.assets.sprite(name);
    if (!s) return null;
    const f = s.meta.frames[frame];
    if (!f || f.w <= 1 && f.h <= 1) return f ?? null;
    const dx = opts.anchor === 'topleft' ? x : x - f.hotX;
    const dy = opts.anchor === 'topleft' ? y : y - f.hotY;
    const c = this.ctx;
    const image = opts.selected ? this.assets.tinted(s) : s.image;
    if (opts.alpha !== undefined) c.globalAlpha = opts.alpha;
    if (opts.flip) {
      c.save();
      c.translate(dx + f.w, dy);
      c.scale(-1, 1);
      c.drawImage(image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      c.restore();
    } else {
      c.drawImage(image, f.x, f.y, f.w, f.h, dx, dy, f.w, f.h);
    }
    if (opts.alpha !== undefined) c.globalAlpha = 1;
    return f;
  }

  frameInfo(name, frame) {
    return this.assets.sprite(name)?.meta.frames[frame] ?? null;
  }

  frameCount(name) {
    return this.assets.sprite(name)?.meta.frames.length ?? this.assets.manifest.sprites?.[name]?.frames ?? 0;
  }

  // Bitmap text using a 256-glyph sprite font (frame index = Latin-1 code). y is the baseline.
  text(font, str, x, y, opts = {}) {
    const s = this.assets.sprite(font);
    if (!s) return 0;
    const width = this.measure(font, str, opts);
    let pen = opts.align === 'center' ? x - width / 2 : opts.align === 'right' ? x - width : x;
    const start = pen;
    for (const ch of String(str)) {
      const code = ch.charCodeAt(0) & 0xff;
      const f = s.meta.frames[code];
      if (!f) continue;
      if (f.w > 1 || f.h > 1) {
        this.ctx.drawImage(s.image, f.x, f.y, f.w, f.h, Math.round(pen - f.hotX), Math.round(y - f.hotY), f.w, f.h);
      }
      pen += glyphAdvance(f, opts);
    }
    return pen - start;
  }

  measure(font, str, opts = {}) {
    const s = this.assets.sprite(font);
    if (!s) return 0;
    let w = 0;
    for (const ch of String(str)) {
      const f = s.meta.frames[ch.charCodeAt(0) & 0xff];
      if (f) w += glyphAdvance(f, opts);
    }
    return w;
  }

  // Word-wraps text into lines that fit maxWidth.
  wrap(font, str, maxWidth) {
    const lines = [];
    for (const para of String(str).split(/\n|\\n/)) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const t = line ? `${line} ${word}` : word;
        if (line && this.measure(font, t) > maxWidth) {
          lines.push(line);
          line = word;
        } else line = t;
      }
      lines.push(line);
    }
    return lines;
  }

  textBox(font, str, x, y, maxWidth, lineHeight, opts = {}) {
    const lines = this.wrap(font, str, maxWidth);
    lines.forEach((l, i) => this.text(font, l, opts.align === 'center' ? x + maxWidth / 2 : x, y + i * lineHeight, opts));
    return lines.length * lineHeight;
  }

  rect(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  strokeRect(x, y, w, h, color, width = 1) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}

// Glyph advance is the frame width, no kerning [code 0x47a232]. Frame 0 of a font is a metrics frame:
// its height is the line height and its hotY the ascent [code 0x47a1ad].
function glyphAdvance(f, opts) {
  return (f.w <= 1 && f.h <= 1 ? 0 : f.w) + (opts.spacing ?? 0);
}

export function fontMetrics(sprite) {
  const f0 = sprite?.meta.frames[0];
  return { lineHeight: f0?.h ?? 14, ascent: f0?.hotY ?? 10 };
}
