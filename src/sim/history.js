// cHistory (C 0x454860): a windowed sum over the last `len` days with `look` future slots.
// add(v, k) adds v k days in the future; advance() moves one day on; sum is the windowed total.
export class History {
  constructor(len, look = 0) {
    this.len = len;
    this.look = look;
    this.slots = new Array(len + look + 1).fill(0);
    this.sum = 0;
  }

  add(v, k = 0) {
    this.slots[this.len + Math.min(k, this.look)] += v;
  }

  advance() {
    // The oldest slot leaves the window; the next pending slot is committed.
    this.sum -= this.slots[0];
    this.slots.shift();
    this.slots.push(0);
    this.sum += this.slots[this.len - 1];
    return this.sum;
  }

  toJSON() { return { len: this.len, look: this.look, slots: this.slots, sum: this.sum }; }
  static from(j) { const h = new History(j.len, j.look); h.slots = j.slots; h.sum = j.sum; return h; }
}
