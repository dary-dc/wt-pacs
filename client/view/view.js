/** The page's view: intents to the controller, here or in the view worker. docs/adr/frame-path.md §3, *Built* */
import { refuseUnstartable, startAndDial, watchPage } from "../transport/consumer.js";

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

const SCRIPT = new URL("./view-worker.js", import.meta.url);

/** The view worker's page half: the canvas and one port to the downloader go to it, events come back. */
export class ViewWorker {
  #worker;
  #downloader = null;
  #next = 0;
  #replies = new Map();
  #triggers = new AbortController();
  #emit;
  #watch;
  #started = false;
  /** Why the view worker ended: after its error or an unreadable message, nothing more is sent to it. */
  #dead = null;

  /** The worker, its script loading before the page has what `start` needs: lab setting `viewWorkerFirst`, docs/adr/frame-path.md §3. */
  static boot() {
    const worker = new Worker(SCRIPT, { type: "module" });
    worker.onerror = (e) => (worker.unloaded = e.message || "its script did not load");
    return worker;
  }

  /**
   * `emit(type, event)` hears renderer, progress, shown and failed `{scope: frame | series | cache | worker, reason}`;
   * `watch(data, from)`, when given, every message the page receives; `settlePaint`, the lab's flag that a paint waits for the GPU;
   * `watchWrites`, the viewer check's, that the view worker count the cache writes on its own thread; `booted`, a worker
   * from `boot`; `glAfterDial`, the lab's setting that the WebGL2 context waits for the dial.
   */
  constructor(canvas, { meta, fillMode, size, emit, watch, settlePaint = false, watchWrites = false, booted, glAfterDial = false }) {
    this.#worker = booted ?? new Worker(SCRIPT, { type: "module" });
    this.#worker.onerror = (e) => this.#end(this.#started ? `the view worker failed: ${e.message}` : `the view worker did not start: ${e.message || "its script did not load"}`);
    this.#worker.onmessageerror = () => this.#end("a message from the view worker could not be read");
    this.#worker.onmessage = ({ data }) => {
      this.#started = true;
      watch?.(data, "view");
      if (data.kind === "event") return void emit(data.type, data);
      const r = this.#replies.get(data.id);
      this.#replies.delete(data.id);
      if (data.error) r.reject(new Error(data.error));
      else r.resolve(data.value);
    };
    const offscreen = canvas.transferControlToOffscreen();
    this.#worker.postMessage({ kind: "start", canvas: offscreen, meta, fillMode, size, settlePaint, watchWrites, glAfterDial }, [offscreen]);
    this.#emit = emit;
    this.#watch = watch;
    if (booted?.unloaded) this.#end(`the view worker did not start: ${booted.unloaded}`);
  }

  /**
   * The downloader is the page's worker, linked to the view worker by one channel. Under the lab's `pageDials` the page
   * also starts it and dials, `firstWant` riding the start, and the view worker joins it; otherwise, and after this, the
   * page never talks to it.
   */
  connect(url, certHash, opts, issuedAt) {
    const { worker, firstWant, ...config } = opts;
    this.#downloader = new Worker(worker ?? new URL("../transport/downloader.js", import.meta.url), { type: "module" });
    const unstarted = Promise.withResolvers();
    this.#downloader.onerror = (e) => {
      const reason = `the downloader did not start: ${e.message || "its script did not load"}`;
      this.#emit("failed", { scope: "series", reason });
      unstarted.reject(new Error(reason));
    };
    if (this.#watch) this.#downloader.onmessage = ({ data }) => this.#watch(data, "downloader");
    const { port1, port2 } = new MessageChannel();
    this.#downloader.postMessage({ kind: "link", port: port1 }, [port1]);
    const dialled = Boolean(config.pageDials);
    if (dialled) {
      const { writer, holdEveryOther, ...own } = config;
      refuseUnstartable(own);
      startAndDial(this.#downloader, url, certHash, { ...own, fill: undefined, want: firstWant });
    }
    watchPage(() => this.#worker.postMessage({ kind: "trigger" }), this.#triggers.signal);
    // The view worker's consumer hears nothing from a downloader that never ran, so the page ends the wait.
    return Promise.race([this.#call("connect", { port: port2, url, certHash, opts: config, issuedAt, dialled, sent: firstWant ?? [] }, [port2]), unstarted.promise]);
  }

  /** Fatal: the view is gone, said once, and every call still waiting fails with it. */
  #end(reason) {
    if (this.#dead) return;
    this.#dead = reason;
    this.#worker.terminate();
    this.#downloader?.terminate();
    this.#emit("failed", { scope: "worker", reason });
    for (const r of this.#replies.values()) r.reject(new Error(reason));
    this.#replies.clear();
  }

  #call(kind, args = {}, transfer = []) {
    if (this.#dead) return Promise.reject(new Error(this.#dead));
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

  ledger(lab) {
    return this.#call("ledger", lab);
  }

  /** Cine on the view worker's own `source`, or on the page's `tick`s with `posted`, frame 0 due at `t0`: lab/frame-clock. */
  play(fps, t0, source) {
    this.#worker.postMessage({ kind: "play", fps, t0, source });
  }

  tick(t, vsync) {
    this.#worker.postMessage({ kind: "tick", t, vsync });
  }

  pause() {
    this.#worker.postMessage({ kind: "pause" });
  }

  /** Each paint of the cine since `play`: client/view/clock.js. */
  cine() {
    return this.#call("cine");
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
