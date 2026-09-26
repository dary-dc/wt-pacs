/**
 * The page side of the downloader. Holds one waiter per asked frame, so `stats` is answerable
 * without a round trip, and takes asked frames at once and fill frames at background priority.
 * docs/ARCHITECTURE.md §The consumer
 */
/** How long a closed client waits for the downloader's answer before ending it anyway. */
const CLOSE_DEADLINE_MS = 1_000;

export class DownloaderClient {
  #worker;
  #waiters = new Map();
  #closedReason = null;
  #onFrame;
  #onError;
  #ready;
  /** The page's copy of the downloader's generation: both step on `cancel`, and messages are ordered. */
  #gen = 0;
  #cancels = [];
  #resumedAt = [];
  #triggers = new AbortController();
  #ending = null;

  constructor(opts) {
    this.#onFrame = opts.onFrame ?? (() => {});
    this.#onError = opts.onError ?? (() => {});
    this.#worker = new Worker(new URL("./downloader.js", import.meta.url), { type: "module" });
    this.#worker.onmessage = (e) => this.#fromDownloader(e.data);
    this.#watchPage();
    this.#ready = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
  }

  #resolveReady;
  #rejectReady;
  #started = false;

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
      transport: opts.transport,
      decoderWorker: opts.decoderWorker,
      // A codestream of the series' shape, decoded in each decoder before the first bytes arrive.
      warmup: opts.warmup,
      // `false` turns resumption off; an object overrides its deadlines. docs/ARCHITECTURE.md
      survival: opts.survival,
      // `opts.fill` rides with `start`: a page inside a long task cannot post one. docs/ARCHITECTURE.md §The downloader
      fill: opts.fill,
      openAsk: opts.openAsk,
      wireBuffers: opts.wireBuffers,
    };
    // Only the dial needs the URL, so the worker graph is booted before it: `url` and `certHash`
    // may be promises. docs/ARCHITECTURE.md
    c.#worker.postMessage({ kind: "start", config });
    try {
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
      timing: { askMs: m.stamps?.ask ?? 0, lastChunkMs: m.stamps?.lastByte || m.stamps?.decodeEnd || 0 },
      info: m,
    };
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

  #arm(index) {
    if (this.#closedReason) {
      return Promise.reject(new Error(`frame ${index} unavailable: ${this.#closedReason}`));
    }
    if (this.#waiters.has(index)) return Promise.reject(new Error(`frame ${index} already requested`));
    // No timer here: the downloader settles every ask, and only it can see the bytes a deadline needs.
    return new Promise((resolve, reject) => this.#waiters.set(index, { resolve, reject }));
  }

  requestExactFrame(index) {
    const p = this.#arm(index);
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
    return { closed: this.#closedReason, inFlight: this.#waiters.size, resumedAt: [...this.#resumedAt] };
  }

  close() {
    this.#triggers.abort();
    this.#worker.postMessage({ kind: "close" });
    this.#ending ??= setTimeout(() => this.#end("closed by the consumer"), CLOSE_DEADLINE_MS);
  }

  /** Nested workers end with the worker that started them, so this ends the decoders too. */
  #end(reason) {
    clearTimeout(this.#ending);
    this.#worker.terminate();
    this.#failAll(reason);
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
