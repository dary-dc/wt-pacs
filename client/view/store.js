/** The frames here, by index: memory, then the cache, then the downloader for the misses. docs/adr/frame-path.md §3, *Built* */
const at = () => performance.timeOrigin + performance.now();
const same = (a, b) => a.length === b.length && a.every((i, k) => i === b[k]);

export class FrameStore {
  #frames = new Map();
  #arrived;
  #budget;
  #waiting = new Map();
  #order = [];
  /** The frames on disk already read under the current want; one evicted since is read again only by the next want. */
  #read = new Set();
  #reading = false;
  /** The misses last sent, in their order, less those that have arrived since: only these are owed. */
  asked = [];
  /** The index the memory window is centred on; past the budget, the frame farthest from it goes first. */
  near = 0;
  /** Under the worker view, the downloader's client the misses go to; under the page view, none, and the controller asks. */
  downloader = null;
  /** Under the worker view, the OPFS cache (client/view/cache.js), or null. */
  cache = null;
  /** Resolves once the paint in flight has drawn, so a write waits behind it. */
  painted = () => null;
  /** Frames read back from the cache that failed their check, each asked again. */
  reasked = 0;

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

  /** `ack` once the frame is held within the budget, or else once its write has settled. */
  put(i, frame, ack = () => {}) {
    if (this.#frames.has(i)) return void ack();
    this.#frames.set(i, frame);
    this.asked = this.asked.filter((k) => k !== i);
    while (this.#frames.size > this.#budget) this.#frames.delete(this.#farthest());
    this.#settle(i);
    this.#arrived(i, frame);
    const written = this.#write(i, frame);
    if (this.#frames.has(i)) ack();
    else written.then(ack);
  }

  /** The controller's want, in its order: its misses replace the last ones sent, unless they are the same. Returns them. */
  want(order) {
    this.#order = order;
    this.#read.clear();
    this.#readCache();
    const misses = order.filter((i) => !this.#frames.has(i) && !this.cache?.present.has(i));
    if (same(misses, this.asked)) return misses;
    this.asked = misses;
    this.downloader?.want(misses);
    return misses;
  }

  /** The downloader from now on; `sent`, the want that rode its start, followed by any miss found since. */
  link(downloader, sent) {
    this.downloader = downloader;
    if (!same(this.asked, sent)) downloader.want(this.asked);
  }

  /** Resolves once frame `i` is here or has failed. */
  arrival(i) {
    if (this.#frames.has(i)) return Promise.resolve();
    if (!this.#waiting.has(i)) this.#waiting.set(i, Promise.withResolvers());
    return this.#waiting.get(i).promise;
  }

  /** A frame the downloader could not deliver: no longer owed, so a later want sends it again. */
  failed(i) {
    this.asked = this.asked.filter((k) => k !== i);
    this.#settle(i);
  }

  /** The want's frames on disk, one at a time in its order; one that fails its check is asked again at its place. */
  async #readCache() {
    if (this.#reading || !this.cache) return;
    this.#reading = true;
    const next = () => this.#order.find((k) => this.cache.present.has(k) && !this.#frames.has(k) && !this.#read.has(k));
    for (let i = next(); i !== undefined; i = next()) {
      this.#read.add(i);
      const info = await this.cache.read(i);
      if (info) this.put(i, { info, arrived: at() });
      else {
        this.reasked += 1;
        this.cache.present.delete(i);
        this.want(this.#order);
      }
    }
    this.#reading = false;
  }

  /** Paint first: a frame checked exact is written once the paint in flight has drawn. */
  async #write(i, frame) {
    if (!this.cache || this.cache.present.has(i) || frame.info.exact !== true) return;
    await this.painted();
    frame.writeAsked = at();
    if (await this.cache.write(i, frame)) {
      frame.written = at();
      this.cache.present.add(i);
    }
  }

  #settle(i) {
    this.#waiting.get(i)?.resolve();
    this.#waiting.delete(i);
  }

  /** The frame the want ranks last: the farthest, and at equal distance the earlier. */
  #farthest() {
    const rank = (i) => 2 * Math.abs(i - this.near) + (i < this.near);
    let far = null;
    for (const i of this.#frames.keys()) if (far === null || rank(i) > rank(far)) far = i;
    return far;
  }
}
