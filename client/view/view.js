/** The page's view: intents to the controller, here or in the view worker. docs/adr/frame-path.md §3, *Built* */
import { watchPage } from "../transport/consumer.js";

/** ms: the consumer's own close deadline, after which the page ends the downloader it started. */
const CLOSE_DEADLINE_MS = 1_000;

/** One paint at a time is the controller's; the page keeps only the index it last asked for and the cine's clock. */
export class View {
  current = 0;
  #n;
  #to;
  #cine = null;

  /** `to`: the controller on the page, or a `ViewWorker`. */
  constructor(n, to) {
    this.#n = n;
    this.#to = to;
  }

  show(i) {
    this.current = (i + this.#n) % this.#n;
    return this.#to.show(this.current);
  }

  setDisplay(d) {
    return this.#to.setDisplay(d);
  }

  resize(size) {
    return this.#to.resize(size);
  }

  repaint() {
    return this.#to.repaint();
  }

  valueAt(x, y) {
    return this.#to.valueAt(x, y);
  }

  /** Paced from the page for now; the clock moves into the view worker in a later row. */
  play(fps) {
    this.pause();
    this.#cine = setInterval(() => this.show(this.current + 1), 1000 / fps);
  }

  pause() {
    clearInterval(this.#cine);
    this.#cine = null;
  }

  get playing() {
    return this.#cine !== null;
  }
}

/** The view worker's page half: the canvas and one port to the downloader go to it, events come back. */
export class ViewWorker {
  #worker;
  #downloader = null;
  #next = 0;
  #replies = new Map();
  #triggers = new AbortController();
  #emit;
  #watch;

  /** `emit(type, event)` hears renderer, progress, shown and failed; `watch(data, from)`, when given, every message the page receives. */
  constructor(canvas, { meta, fillMode, size, emit, watch }) {
    this.#worker = new Worker(new URL("./view-worker.js", import.meta.url), { type: "module" });
    this.#worker.onerror = (e) => emit("failed", { i: null, reason: `the view worker did not start: ${e.message || "its script did not load"}` });
    this.#worker.onmessage = ({ data }) => {
      watch?.(data, "view");
      if (data.kind === "event") return void emit(data.type, data);
      const r = this.#replies.get(data.id);
      this.#replies.delete(data.id);
      if (data.error) r.reject(new Error(data.error));
      else r.resolve(data.value);
    };
    const offscreen = canvas.transferControlToOffscreen();
    this.#worker.postMessage({ kind: "start", canvas: offscreen, meta, fillMode, size }, [offscreen]);
    this.#emit = emit;
    this.#watch = watch;
  }

  /** The downloader is the page's worker, linked to the view worker by one channel; after this the page never talks to it. */
  connect(url, certHash, opts, issuedAt) {
    const { worker, ...config } = opts;
    this.#downloader = new Worker(worker ?? new URL("../transport/downloader.js", import.meta.url), { type: "module" });
    const unstarted = Promise.withResolvers();
    this.#downloader.onerror = (e) => {
      const reason = `the downloader did not start: ${e.message || "its script did not load"}`;
      this.#emit("failed", { i: null, reason });
      unstarted.reject(new Error(reason));
    };
    if (this.#watch) this.#downloader.onmessage = ({ data }) => this.#watch(data, "downloader");
    const { port1, port2 } = new MessageChannel();
    this.#downloader.postMessage({ kind: "link", port: port1 }, [port1]);
    watchPage(() => this.#worker.postMessage({ kind: "trigger" }), this.#triggers.signal);
    // The view worker's consumer hears nothing from a downloader that never ran, so the page ends the wait.
    return Promise.race([this.#call("connect", { port: port2, url, certHash, opts: config, issuedAt }, [port2]), unstarted.promise]);
  }

  #call(kind, args = {}, transfer = []) {
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      this.#replies.set(id, { resolve, reject });
      this.#worker.postMessage({ kind, id, ...args }, transfer);
    });
  }

  show(i) {
    this.#worker.postMessage({ kind: "show", i });
  }

  setDisplay(display) {
    this.#worker.postMessage({ kind: "display", display });
  }

  resize(size) {
    this.#worker.postMessage({ kind: "size", size });
  }

  repaint() {
    return this.#call("repaint");
  }

  valueAt(x, y) {
    return this.#call("valueAt", { x, y });
  }

  ledger() {
    return this.#call("ledger");
  }

  /** The viewer check's in-worker half, phase by phase: client/view/check.js. */
  check(phase, args) {
    return this.#call("check", { phase, args });
  }

  close() {
    this.#triggers.abort();
    this.#call("close").finally(() => setTimeout(() => this.#downloader?.terminate(), CLOSE_DEADLINE_MS));
  }
}
