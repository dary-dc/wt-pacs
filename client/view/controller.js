/** The view's controller: the current frame, what it wants and in what order, and its paint. docs/adr/frame-path.md §3, *Built* */
import { FrameStore } from "./store.js";

const at = () => performance.timeOrigin + performance.now();
export const FIT = { fit: true, zoom: 1, panX: 0, panY: 0, rotate: 0, flipH: false, flipV: false };

export const asPainted = (info) => ({ pixels: info.pixels, width: info.width, height: info.height, bits: info.bits, components: info.components, signed: info.signed });

export function samplesOf(info) {
  const { bits, components, signed } = info;
  const View = components === 3 || bits <= 8 ? (signed ? Int8Array : Uint8Array) : signed ? Int16Array : Uint16Array;
  return new View(info.pixels);
}

export class Controller {
  /** Set once connected: what the controller asks of the downloader through. */
  client = null;
  current = 0;
  received = 0;
  seen = { exact: 0, inexact: 0, unchecked: 0, paths: {} };
  issuedAt = 0;
  fillMs = null;
  firstShownMs = null;
  paints = 0;
  lastPaint = null;
  #meta;
  #n;
  #fillMode;
  #emit;
  #voi = null;
  #invert = false;
  #pose = FIT;
  #painting = null;
  #dirty = false;
  /** Each pending ask's frame and the step that made it; a cancel empties it. */
  #asks = new Map();
  #steps = 0;

  /** `paint(frame, display, { read })` draws a held frame; `emit(type, event)` tells the page; `size` is the canvas's CSS size and DPR. */
  constructor({ meta, fillMode, paint, emit, size, budget }) {
    this.store = new FrameStore({ arrived: (i, frame) => this.#arrived(i, frame), budget });
    this.store.painted = () => this.#painting;
    this.#meta = meta;
    this.#n = meta.frameCount;
    this.#fillMode = fillMode;
    this.paint = paint;
    this.#emit = emit;
    this.size = size;
  }

  /** `f.ack`, when the consumer leaves the ack to the store; `f.write`, when its decoder writes the cache. */
  take(f) {
    this.store.put(f.frameIndex, { info: f.info, arrived: at(), write: f.write }, f.ack);
  }

  #arrived(i, { info }) {
    this.received += 1;
    const e = info.exact;
    this.seen[e === true ? "exact" : e === false ? "inexact" : "unchecked"]++;
    if (info.path) this.seen.paths[info.path] = (this.seen.paths[info.path] ?? 0) + 1;
    if (this.#fillMode && this.fillMs === null && this.received === this.#n) this.fillMs = at() - this.issuedAt;
    if (i === this.current) this.repaint();
    this.#emit("progress", { have: this.received, total: this.#n, seen: this.seen, fillMs: this.fillMs, at: at() });
  }

  /** The frame's display: its own rescale and window where the metadata varies them, the user's window over both. */
  display(i, info) {
    const meta = this.#meta;
    const per = meta.perFrame ?? {};
    const rescale = per.rescale?.[i] ?? meta.rescale ?? { slope: 1, intercept: 0 };
    const w = per.window?.[i] ?? meta.window;
    let voi = this.#voi ?? (w && { center: w.center[0], width: w.width[0], function: w.function ?? "LINEAR" });
    if (!voi) {
      // No window in the metadata: the frame's decoded range, through its rescale.
      const lo = info.min * rescale.slope + rescale.intercept;
      const hi = info.max * rescale.slope + rescale.intercept;
      voi = { center: (lo + hi) / 2, width: Math.max(1, Math.abs(hi - lo) + 1), function: "LINEAR" };
    }
    const photometric = meta.photometric ?? (info.components === 3 ? "RGB" : "MONOCHROME2");
    return { photometric, rescale, voi, invert: this.#invert, view: this.#pose };
  }

  /** Paints the current frame, coalescing requests: at most one paint in flight and one waiting. */
  repaint() {
    this.#dirty = true;
    if (this.#painting) return this.#painting;
    this.#painting = (async () => {
      while (this.#dirty) {
        this.#dirty = false;
        const i = this.current;
        const f = this.store.get(i);
        if (!f) continue;
        try {
          const d = this.display(i, f.info);
          this.lastPaint = await this.paint(f, d);
          f.painted ??= at();
          this.paints += 1;
          if (this.firstShownMs === null && f.info.exact === true) this.firstShownMs = at() - this.issuedAt;
          this.#emit("shown", { i, exact: f.info.exact, reason: f.info.reason, window: d.voi, firstShownMs: this.firstShownMs });
        } catch (e) {
          this.#emit("failed", { scope: "worker", reason: `paint: ${e.message}` });
        }
      }
      this.#painting = null;
    })();
    return this.#painting;
  }

  /** A step: its frame painted from here, or asked — ahead of the fill, and in on-demand mode the newest ask alone. */
  async show(i) {
    const n = this.#n;
    this.current = (i + n) % n;
    this.store.near = this.current;
    if (this.store.downloader) {
      this.store.want(this.want());
      return this.store.has(this.current) ? this.repaint() : this.store.arrival(this.current);
    }
    if (this.store.has(this.current)) return this.repaint();
    // A frame not here is asked of the downloader; the OPFS store would be asked first: docs/adr/frame-path.md §3.
    const want = this.current;
    if (this.#asks.has(want)) return;
    const step = ++this.#steps;
    if (!this.#fillMode && this.#asks.size) {
      this.#asks.clear();
      await this.client.cancel();
      if (step !== this.#steps) return;
    }
    this.#asks.set(want, step);
    try {
      this.take(await this.client.requestExactFrame(want));
    } catch (e) {
      if (this.#asks.get(want) === step) this.#emit("failed", { scope: "frame", i: want, reason: e.message });
    } finally {
      if (this.#asks.get(want) === step) this.#asks.delete(want);
    }
  }

  /** What this view wants, the current frame first: when filling, the series nearest first; on demand, that frame alone. */
  want() {
    const [c, n] = [this.current, this.#n];
    if (!this.#fillMode) return [c];
    const order = [c];
    for (let d = 1; order.length < n; d++) for (const i of [c + d, c - d]) if (i >= 0 && i < n) order.push(i);
    return order;
  }

  /** A frame the downloader could not deliver; index -1 is the series. */
  refused(i, reason) {
    if (i < 0) return this.#emit("failed", { scope: "series", reason });
    this.store.failed(i);
    this.#emit("failed", { scope: "frame", i, reason });
  }

  /** Any of `window` (null: the metadata's), `invert`, `pose`; the current frame painted again. */
  setDisplay(d) {
    if ("window" in d) this.#voi = d.window;
    if ("invert" in d) this.#invert = d.invert;
    if ("pose" in d) this.#pose = d.pose;
    return this.repaint();
  }

  resize(size) {
    this.size = size;
    return this.repaint();
  }

  /** The current frame's sample under CSS pixel (x, y) of the canvas, stored and through its rescale; null off the image. */
  async valueAt(x, y) {
    const i = this.current;
    const f = this.store.get(i);
    if (!f) return null;
    const [{ toSource }, { rescale }] = await Promise.all([import("../paint/reference.js"), import("../paint/voi.js")]);
    const { width, height, dpr } = this.size;
    const p = toSource(f.info, this.#pose, Math.round(width * dpr), Math.round(height * dpr), dpr)(Math.floor(x * dpr), Math.floor(y * dpr));
    if (!p) return null;
    const { width: w, height: h, components } = f.info;
    const [col, row] = [Math.min(w - 1, Math.floor(p[0])), Math.min(h - 1, Math.floor(p[1]))];
    const stored = [...samplesOf(f.info).subarray((row * w + col) * components, (row * w + col + 1) * components)];
    const { slope, intercept } = rescale(this.display(i, f.info).rescale);
    return { i, x: col, y: row, stored, modality: stored.map((s) => s * slope + intercept) };
  }

  /** Each frame here, its digest taken where it is held, for a lab harness. lab/viewer/levers.js */
  async ledger() {
    const { sha256Hex } = await import("../decode/wasm-glue.js");
    const frames = [];
    for (const i of this.store.keys()) {
      const { info, arrived, painted, writeAsked, written } = this.store.get(i);
      const sha = await sha256Hex(new Uint8Array(info.pixels).slice());
      frames.push({ i, page: arrived, lastByte: info.stamps?.lastByte, exact: info.exact, path: info.path, painted, writeAsked, written, sha });
    }
    return { frames, firstShownMs: this.firstShownMs, stats: this.client.stats() };
  }
}
