/** The frames here, by index: has, get, put, and nothing decided. docs/adr/frame-path.md §3, *Built* */
export class FrameStore {
  #frames = new Map();
  #arrived;
  #budget;
  /** The index the memory window is centred on; past the budget, the frame farthest from it goes first. */
  near = 0;

  /** `arrived(i, frame)` hears of each frame new here; `budget` is in frames. */
  constructor({ arrived, budget = Infinity }) {
    this.#arrived = arrived;
    this.#budget = budget;
  }

  has(i) {
    return this.#frames.has(i);
  }

  get(i) {
    return this.#frames.get(i);
  }

  keys() {
    return this.#frames.keys();
  }

  put(i, frame) {
    if (this.#frames.has(i)) return;
    this.#frames.set(i, frame);
    while (this.#frames.size > this.#budget) this.#frames.delete(this.#farthest());
    this.#arrived(i, frame);
  }

  #farthest() {
    let far = null;
    for (const i of this.#frames.keys()) if (far === null || Math.abs(i - this.near) > Math.abs(far - this.near)) far = i;
    return far;
  }
}
