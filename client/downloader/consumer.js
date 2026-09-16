/**
 * The page side of the downloader. Holds one waiter per asked frame, so `stats` is answerable
 * without a round trip, and takes asked frames at once and fill frames at background priority.
 * docs/proposal-downloader.md §The consumer
 */
const FRAME_TIMEOUT_MS = 15_000;

export class DownloaderClient {
  #worker;
  #waiters = new Map();
  #closedReason = null;
  #onFrame;
  #ready;

  constructor(opts) {
    this.#onFrame = opts.onFrame ?? (() => {});
    this.#worker = new Worker(new URL("./downloader.js", import.meta.url), { type: "module" });
    this.#worker.onmessage = (e) => this.#fromDownloader(e.data);
    this.#ready = new Promise((resolve) => {
      this.#resolveReady = resolve;
    });
  }

  #resolveReady;

  static async connect(url, certHash, opts = {}) {
    if (!globalThis.crossOriginIsolated && opts.decode !== false) {
      throw new Error("the downloader writes pixels into a SharedArrayBuffer: serve the page cross-origin isolated");
    }
    const c = new DownloaderClient(opts);
    // Only what survives structured clone: `onFrame` is the consumer's, not the downloader's.
    const config = {
      decoders: opts.decoders,
      decode: opts.decode,
      perDecoder: opts.perDecoder,
      decoder: opts.decoder,
    };
    c.#worker.postMessage({ kind: "start", url, certHash, config });
    await c.#ready;
    return c;
  }

  #fromDownloader(m) {
    if (m.kind === "started") return void this.#resolveReady();
    if (m.kind === "pixel-port") {
      m.port.onmessage = (e) => this.#deliver(e.data);
      return;
    }
    if (m.kind === "frame") return void this.#deliver(m);
    if (m.kind === "failed") return void this.#failOne(m.index, m.reason);
    if (m.kind === "closed") return void this.#failAll(m.reason);
  }

  #deliver(m) {
    const w = this.#waiters.get(m.index);
    const bytes = m.pixels instanceof SharedArrayBuffer ? new Uint8Array(m.pixels) : m.pixels;
    const frame = {
      frameIndex: m.index,
      bytes,
      timing: { askMs: m.stamps?.ask ?? 0, lastChunkMs: m.stamps?.lastByte || m.stamps?.decodeEnd || 0 },
      info: m,
    };
    if (w) {
      clearTimeout(w.timer);
      this.#waiters.delete(m.index);
      w.resolve(frame);
      return;
    }
    // A fill frame nobody is waiting on: background priority, so a paint never waits behind it.
    this.#onFrame(frame);
  }

  #failOne(index, reason) {
    const w = this.#waiters.get(index);
    if (!w) return;
    clearTimeout(w.timer);
    this.#waiters.delete(index);
    w.reject(new Error(`frame ${index} unavailable: ${reason}`));
  }

  #failAll(reason) {
    this.#closedReason ??= reason;
    for (const [index, w] of this.#waiters) {
      clearTimeout(w.timer);
      w.reject(new Error(`frame ${index} unavailable: ${this.#closedReason}`));
    }
    this.#waiters.clear();
  }

  #arm(index) {
    if (this.#closedReason) {
      return Promise.reject(new Error(`frame ${index} unavailable: ${this.#closedReason}`));
    }
    if (this.#waiters.has(index)) return Promise.reject(new Error(`frame ${index} already requested`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(index);
        reject(new Error(`timeout waiting for frame ${index} after ${FRAME_TIMEOUT_MS} ms`));
      }, FRAME_TIMEOUT_MS);
      this.#waiters.set(index, { resolve, reject, timer });
    });
  }

  requestExactFrame(index) {
    const p = this.#arm(index);
    this.#worker.postMessage({ kind: "ask", index });
    return p;
  }

  fill(indices) {
    this.#worker.postMessage({ kind: "fill", indices });
  }

  cancel() {
    this.#worker.postMessage({ kind: "cancel" });
  }

  stats() {
    return { closed: this.#closedReason, inFlight: this.#waiters.size };
  }

  close() {
    this.#worker.postMessage({ kind: "close" });
  }
}
