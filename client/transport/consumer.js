/**
 * The page side of the downloader. Holds one waiter per asked frame, so `stats` is answerable
 * without a round trip, and takes asked frames at once and fill frames at background priority.
 * docs/ARCHITECTURE.md §The consumer
 */
/** How long a closed client waits for the downloader's answer before ending it anyway. */
const CLOSE_DEADLINE_MS = 1_000;
/** What `opts.decoder.codec` may name; absent is HTJ2K. docs/av1/adr-unit.md §1 */
const CODECS = ["htj2k", "av1"];

export class DownloaderClient {
  #worker;
  #waiters = new Map();
  #closedReason = null;
  #onFrame;
  #onPreview;
  #onError;
  #ready;
  #resolveReady;
  #rejectReady;
  #started = false;
  /** The page's copy of the downloader's generation: both step on `cancel`, and messages are ordered. */
  #gen = 0;
  #cancels = [];
  #resumedAt = [];
  #recycledAt = [];
  #triggers = new AbortController();
  #ending = null;
  /** Per decoder path, frames delivered `exact` true, false and unchecked. docs/adr/exactness-in-production.md */
  #exact = {};

  constructor(opts) {
    this.#onFrame = opts.onFrame ?? (() => {});
    // A scalable AV1 payload's lower layer, sent before its exact frame on the same port. docs/av1/adr-unit.md §6
    this.#onPreview = opts.onPreview ?? (() => {});
    this.#onError = opts.onError ?? (() => {});
    // The worker's script is a seam: a page may boot it from a bundle or a blob. lab/page-open/README.md
    this.#worker = new Worker(opts.worker ?? new URL("./downloader.js", import.meta.url), { type: "module" });
    this.#worker.onmessage = (e) => this.#fromDownloader(e.data);
    this.#watchPage();
    this.#ready = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
  }

  /** Every option but the page's own four goes to the downloader, so each must survive structured clone. */
  static async connect(url, certHash, opts = {}) {
    // A frame handed to the wrong decoder can decode to something: refused before anything starts.
    const codec = opts.decoder?.codec ?? "htj2k";
    if (!CODECS.includes(codec)) throw new Error(`unknown codec "${codec}"`);
    // A group is asked whole, so its last frame has to be known. docs/av1/adr-unit.md §3
    const g = opts.groupLength ?? 1;
    if (!Number.isInteger(g) || g < 1 || (g > 1 && !Number.isInteger(opts.frameCount))) {
      throw new Error(`groupLength ${g} needs a whole number ≥ 1, and above 1 the series' frameCount`);
    }
    if (!globalThis.crossOriginIsolated && opts.decode !== false) {
      throw new Error("the downloader writes pixels into a SharedArrayBuffer: serve the page cross-origin isolated");
    }
    const { onFrame, onPreview, onError, worker, ...config } = opts;
    const c = new DownloaderClient({ onFrame, onPreview, onError, worker });
    try {
      c.#worker.postMessage({ kind: "start", config });
      // Only the dial needs the URL, so the worker graph is booted before it: `url` and `certHash`
      // may be promises. docs/ARCHITECTURE.md
      c.#worker.postMessage({ kind: "dial", url: await url, certHash: await certHash });
      await c.#ready;
    } catch (e) {
      // No client comes back to close, so what it started ends here.
      c.#triggers.abort();
      c.#end(String(e?.message ?? e));
      throw e;
    }
    return c;
  }

  #fromDownloader(m) {
    if (m.kind === "started") {
      this.#started = true;
      return void this.#resolveReady();
    }
    if (m.kind === "pixel-port") {
      // `onmessage`, not `addEventListener`: only it starts the port and releases the frames queued on it.
      m.port.onmessage = (e) => this.#deliver(e.data);
      return;
    }
    if (m.kind === "frame") return void this.#deliver(m);
    if (m.kind === "cancelled") return void this.#cancels.shift()?.();
    if (m.kind === "resumed") return void this.#resumedAt.push(performance.timeOrigin + performance.now());
    if (m.kind === "recycled") return void this.#recycledAt.push(performance.timeOrigin + performance.now());
    if (m.kind === "failed") {
      // A failure before `started` is the start itself failing: connect must reject, not hang.
      if (!this.#started) return void this.#rejectReady(new Error(`the downloader failed to start: ${m.reason}`));
      if (m.gen !== this.#gen) return;
      return void this.#failOne(m.index, m.reason);
    }
    if (m.kind === "closed") return void this.#end(m.reason);
  }

  #deliver(m) {
    // A frame of a cancelled request under the index a new one is using: wrong pixels, right key.
    if (m.gen !== this.#gen) return;
    const w = this.#waiters.get(m.index);
    const bytes = m.pixels instanceof SharedArrayBuffer ? new Uint8Array(m.pixels) : m.pixels;
    const frame = {
      frameIndex: m.index,
      generation: m.gen,
      bytes,
      timing: { askMs: m.stamps?.ask ?? 0, lastChunkMs: m.stamps?.lastByte ?? 0 },
      info: m,
    };
    if (m.preview) return void this.#onPreview(frame);
    if (m.path) {
      const n = (this.#exact[m.path] ??= { true: 0, false: 0, unchecked: 0 });
      n[m.exact] += 1;
    }
    if (w) {
      this.#waiters.delete(m.index);
      w.resolve(frame);
      return;
    }
    // A fill frame nobody is waiting on: background priority, so a paint never waits behind it.
    this.#onFrame(frame);
  }

  #failOne(index, reason) {
    const w = this.#waiters.get(index);
    // Nobody is waiting on it, so it is a fill frame: the refusal reaches the consumer here or nowhere.
    if (!w) return void this.#onError({ frameIndex: index, reason, generation: this.#gen });
    this.#waiters.delete(index);
    w.reject(new Error(`frame ${index} unavailable: ${reason}`));
  }

  #failAll(reason) {
    this.#closedReason ??= reason;
    for (const [index, w] of this.#waiters) {
      w.reject(new Error(`frame ${index} unavailable: ${this.#closedReason}`));
    }
    this.#waiters.clear();
  }

  #waitFor(index) {
    if (this.#closedReason) {
      return Promise.reject(new Error(`frame ${index} unavailable: ${this.#closedReason}`));
    }
    if (this.#waiters.has(index)) return Promise.reject(new Error(`frame ${index} already requested`));
    // No timer here: the downloader settles every ask, and only it can see the bytes a deadline needs.
    return new Promise((resolve, reject) => this.#waiters.set(index, { resolve, reject }));
  }

  requestExactFrame(index) {
    const p = this.#waitFor(index);
    this.#worker.postMessage({ kind: "ask", index });
    return p;
  }

  fill(indices) {
    this.#worker.postMessage({ kind: "fill", indices });
  }

  /** Resolves once the downloader has ended the stream and dropped this request's work. */
  cancel() {
    this.#gen += 1;
    for (const [index, w] of this.#waiters) {
      w.reject(new Error(`frame ${index} unavailable: AbortError: the fill was cancelled`));
    }
    this.#waiters.clear();
    const done = new Promise((r) => this.#cancels.push(r));
    this.#worker.postMessage({ kind: "cancel" });
    return done;
  }

  stats() {
    return { closed: this.#closedReason, inFlight: this.#waiters.size, resumedAt: [...this.#resumedAt], recycledAt: [...this.#recycledAt], exact: structuredClone(this.#exact) };
  }

  close() {
    this.#closedReason ??= "closed by the consumer";
    this.#triggers.abort();
    this.#worker.postMessage({ kind: "close" });
    this.#ending ??= setTimeout(() => this.#end("closed by the consumer"), CLOSE_DEADLINE_MS);
  }

  /** Nested workers end with the worker that started them, so this ends the decoders too. */
  #end(reason) {
    clearTimeout(this.#ending);
    this.#worker.terminate();
    this.#failAll(reason);
    for (const done of this.#cancels.splice(0)) done();
  }

  /** The triggers a worker cannot see; the downloader decides whether any of them means anything. */
  #watchPage() {
    if (typeof document === "undefined") return;
    const signal = this.#triggers.signal;
    const check = () => this.#worker.postMessage({ kind: "check" });
    addEventListener("pageshow", check, { signal });
    for (const ev of ["freeze", "resume"]) document.addEventListener(ev, check, { signal });
    document.addEventListener(
      "visibilitychange",
      () => document.visibilityState === "visible" && check(),
      { signal },
    );
  }
}
