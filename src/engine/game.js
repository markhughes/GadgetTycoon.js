// Main loop and scene stack.
//
// A scene is an object with optional methods:
//   enter(game, params), exit(), update(dt), draw(r), event(ev) -> true if handled, cursor() -> frame
// Only the top scene receives input; scenes flagged `overlay = true` draw the scene beneath them first.

import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Assets } from './assets.js';

export const CURSOR = {
  ARROW: 0, WAIT: 1, TEXT: 2, LEFT: 3, UP_LEFT: 4, UP: 5, UP_RIGHT: 6, RIGHT: 7, DOWN_RIGHT: 8, DOWN: 9, DOWN_LEFT: 10,
  BACK: 11, EMPLOYEE: 12, FURNITURE: 13, REPAIR: 14,
};

export class Game {
  constructor(canvas) {
    this.assets = new Assets();
    this.r = new Renderer(canvas, this.assets);
    this.input = new Input(canvas);
    this.audio = new Audio();
    this.stack = [];
    this.time = 0;
    this.cursorFrame = 0;
    this.services = {};
    canvas.addEventListener('mousedown', () => this.audio.unlock());
    window.addEventListener('keydown', () => this.audio.unlock());
  }

  get scene() {
    return this.stack[this.stack.length - 1];
  }

  // Replace the whole stack with one scene.
  async go(scene, params) {
    while (this.stack.length) this.stack.pop().exit?.();
    this.r.resize(scene.width ?? 800, scene.height ?? 600);
    this.stack.push(scene);
    await scene.enter?.(this, params);
  }

  async push(scene, params) {
    this.stack.push(scene);
    await scene.enter?.(this, params);
  }

  pop() {
    const s = this.stack.pop();
    s?.exit?.();
    return s;
  }

  start() {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.time += dt;
      this.tick(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  tick(dt) {
    if (this.paused) { this.input.drain(); return; } // a video owns the canvas
    for (const ev of this.input.drain()) {
      for (let i = this.stack.length - 1; i >= 0; i--) {
        if (this.stack[i].event?.(ev)) break;
        if (!this.stack[i].overlay || this.stack[i].modal) break;
      }
    }
    for (const s of [...this.stack]) s.update?.(dt);
    this.r.clear();
    let base = this.stack.length - 1;
    while (base > 0 && this.stack[base].overlay) base--;
    for (let i = base; i < this.stack.length; i++) {
      this.r.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.stack[i].draw?.(this.r);
    }
    this.r.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawCursor();
  }

  // MOUSE_MAIN_SPRITES holds 15 cursor shapes as (with shadow, without shadow) frame pairs; each frame's
  // hotspot is the pointer tip [code 0x483cd0]. Scenes return a CURSOR value.
  drawCursor() {
    if (!this.input.inside) return;
    const shape = this.scene?.cursor?.() ?? CURSOR.ARROW;
    const frame = shape * 2 + (this.settings?.mouseShadow ? 0 : 1);
    this.r.sprite('MOUSE_MAIN_SPRITES', frame, this.input.x, this.input.y);
  }
}
