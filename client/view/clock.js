/** Cine's clock in the view worker: each tick paints the frame due at its time, once. docs/adr/frame-path.md §A frame clock in the view worker */

/** ms since the epoch, comparable between the page and its workers. */
export const now = () => performance.timeOrigin + performance.now();

/** Each tick paints the frame due at that time, so a late tick skips frames rather than falling behind. */
export class Cine {
  /** One entry a paint: the frame's unwrapped index, the tick's time, its vsync time when the clock has one, the paint's start and end. */
  log = [];
  stopped = false;
  #show;
  #last = -1;

  /** `source`: one of SOURCES, or `posted` for ticks the page sends; `t0` is when frame 0 is due, on `now()`'s clock. */
  constructor({ fps, t0, show, source }) {
    this.period = 1000 / fps;
    this.t0 = t0;
    this.#show = show;
    if (source !== "posted") SOURCES[source](this);
  }

  /** When the next frame not yet painted is due. */
  get due() {
    return this.t0 + (this.#last + 1) * this.period;
  }

  async tick(t, vsync = null) {
    const i = Math.floor((t - this.t0) / this.period);
    if (i <= this.#last || this.stopped) return;
    this.#last = i;
    const start = now();
    await this.#show(i);
    this.log.push({ i, tick: t, vsync, start, end: now() });
  }

  stop() {
    this.stopped = true;
  }
}

/** The tick sources the worker runs on its own: docs/adr/frame-path.md §A frame clock in the view worker, (a) and (d). */
export const SOURCES = {
  raf(c) {
    const frame = (t) => {
      if (c.stopped) return;
      c.tick(performance.timeOrigin + t, performance.timeOrigin + t);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  },

  timeout(c) {
    const next = () => {
      if (c.stopped) return;
      c.tick(now());
      setTimeout(next, Math.max(0, c.due - now()));
    };
    setTimeout(next, Math.max(0, c.due - now()));
  },

  channel(c) {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      if (c.stopped) return void port1.close();
      if (now() >= c.due) c.tick(now());
      port2.postMessage(0);
    };
    port2.postMessage(0);
  },

  /** Blocks in slices of at most one period, and yields between them so the page's messages run. */
  wait(c) {
    const cell = new Int32Array(new SharedArrayBuffer(4));
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = async () => {
      if (c.stopped) return void port1.close();
      const ms = c.due - now();
      if (ms > 0) Atomics.wait(cell, 0, 0, Math.min(ms, c.period));
      if (now() >= c.due) await c.tick(now());
      port2.postMessage(0);
    };
    port2.postMessage(0);
  },
};
