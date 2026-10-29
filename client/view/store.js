/** The frames here, by index: has, get and put read and write memory alone; `want` sends the downloader the misses. docs/adr/frame-path.md §3, *Built* */
export class FrameStore {
  #frames = new Map();
  #arrived;
  #budget;
  /** The misses last sent, in their order. */
  #asked = [];
  #waiting = new Map();
  /** The index the memory window is centred on; past the budget, the frame farthest from it goes first. */
  near = 0;
  /** Under the worker view, the downloader's client the misses go to; under the page view, none, and the controller asks. */
  downloader = null;

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
    this.#settle(i);
    this.#arrived(i, frame);
  }

  /** The controller's want, in its order: its misses replace the last ones sent, unless they are the same. Returns them. */
  want(order) {
    const misses = order.filter((i) => !this.#frames.has(i));
    const owed = this.#asked.filter((i) => !this.#frames.has(i));
    if (misses.length === owed.length && misses.every((i, k) => i === owed[k])) return misses;
    this.#asked = misses;
    this.downloader?.want(misses);
    return misses;
  }

  /** Resolves once frame `i` is here or has failed. */
  arrival(i) {
    if (this.#frames.has(i)) return Promise.resolve();
    if (!this.#waiting.has(i)) this.#waiting.set(i, Promise.withResolvers());
    return this.#waiting.get(i).promise;
  }

  /** A frame the downloader could not deliver: no longer owed, so a later want sends it again. */
  failed(i) {
    this.#asked = this.#asked.filter((k) => k !== i);
    this.#settle(i);
  }

  #settle(i) {
    this.#waiting.get(i)?.resolve();
    this.#waiting.delete(i);
  }

  #farthest() {
    let far = null;
    for (const i of this.#frames.keys()) if (far === null || Math.abs(i - this.near) > Math.abs(far - this.near)) far = i;
    return far;
  }
}
