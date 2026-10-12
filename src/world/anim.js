// Animation timing [code 0x48c244]: a cycle lasts frameCount*1000/fps ms and is followed by an optional pause
// during which the last ("rest") frame stays on screen. Non-looping animations stop on their last frame.
//
// The clock advances loop by loop: each new loop starts where the previous cycle+pause ended, and picks its own
// random pause (characters: rand%2000 ms between loops [code 0x4665d7]). Changing the pause therefore never
// re-times frames that were already shown.

export class AnimClock {
  constructor({ start = 0, pauseMs = 0, fps = null, loop = null, randomPause = 0 } = {}) {
    Object.assign(this, { start, pauseMs, fps, loop, randomPause });
    this.loopStart = start;
    this.loopPause = randomPause ? Math.random() * randomPause : pauseMs;
  }

  restart(now) {
    this.start = now;
    this.loopStart = now;
    this.loopPause = this.randomPause ? Math.random() * this.randomPause : this.pauseMs;
  }

  // meta: sprite JSON (fps/startFrame/frameCount/loop). now: ms.
  frame(meta, now) {
    const total = meta.frames.length;
    const start = meta.startFrame ?? 0;
    const count = meta.frameCount > 0 ? Math.min(meta.frameCount, total - start) : total - start;
    if (count <= 1) return start;
    const fps = this.fps ?? meta.fps ?? 10;
    const cycle = (count * 1000) / fps;
    const loop = this.loop ?? meta.loop ?? true;
    if (now < this.loopStart) return start;
    if (!loop) {
      const t = now - this.start;
      return t >= cycle ? start + count - 1 : start + Math.floor((count * t) / cycle);
    }
    // Catch up whole loops (cheap: at most a few per frame unless the tab was hidden).
    let guard = 0;
    while (now - this.loopStart >= cycle + this.loopPause && guard++ < 1000) {
      this.loopStart += cycle + this.loopPause;
      this.loopPause = this.randomPause ? Math.random() * this.randomPause : this.pauseMs;
    }
    const tt = now - this.loopStart;
    if (tt >= cycle) return start + count - 1; // resting between loops
    const f = Math.floor((count * tt) / cycle);
    return start + (meta.reverse ? count - f - 1 : f);
  }
}
