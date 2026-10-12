// Mouse and keyboard input mapped to the 800x600 logical canvas.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0;
    this.y = 0;
    this.inside = false;
    this.down = false;
    this.rightDown = false;
    this.wheel = 0;
    this.keys = new Set();
    this.events = []; // queued { type, x, y, button, key }

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      this.x = Math.floor(((e.clientX - r.left) / r.width) * canvas.width);
      this.y = Math.floor(((e.clientY - r.top) / r.height) * canvas.height);
    };
    canvas.addEventListener('mousemove', (e) => { pos(e); this.inside = true; });
    canvas.addEventListener('mouseleave', () => { this.inside = false; });
    canvas.addEventListener('mousedown', (e) => {
      pos(e);
      if (e.button === 0) this.down = true;
      if (e.button === 2) this.rightDown = true;
      this.events.push({ type: 'down', x: this.x, y: this.y, button: e.button });
    });
    window.addEventListener('mouseup', (e) => {
      if (e.target === canvas) pos(e);
      if (e.button === 0) this.down = false;
      if (e.button === 2) this.rightDown = false;
      this.events.push({ type: 'up', x: this.x, y: this.y, button: e.button });
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
      this.events.push({ type: 'wheel', x: this.x, y: this.y, delta: Math.sign(e.deltaY) });
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.key);
      this.events.push({ type: 'key', key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey });
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => { this.keys.clear(); this.down = false; });
  }

  drain() {
    const ev = this.events;
    this.events = [];
    this.wheel = 0;
    return ev;
  }

  over(x, y, w, h) {
    return this.inside && this.x >= x && this.y >= y && this.x < x + w && this.y < y + h;
  }
}
