/** The view's controller: the current frame, what it wants and in what order, and its paint. docs/adr/frame-path.md §3, *Built* */
import { now } from "./clock.js";
import { FrameStore } from "./store.js";
import { CUT_DEPTH, cutShift } from "../decode/depth-cut.js";

/** Decoded frames a tab holds by default, in bytes. docs/client/evidence/what-a-view-asks-for.md, *M, the budget* */
const VIEW_MEMORY = 256 * 2 ** 20;
export const FIT = { fit: true, zoom: 1, panX: 0, panY: 0, rotate: 0, flipH: false, flipV: false };

export const asPainted = (info) => ({ pixels: info.pixels, width: info.width, height: info.height, bits: info.bits, components: info.components, signed: info.signed, cutShift: info.cutShift });

/** What the developer overlay shows of a painted frame: its decode route and why WebCodecs refused it, the bytes that crossed the link, its decode time. */
const about = ({ route, refusal, wireBytes, stamps }) => ({ route, refusal, wireBytes, decodeMs: stamps?.decodeEnd && stamps.decodeEnd - stamps.decodeStart });

export function samplesOf(info) {
  const { bits, components, signed } = info;
  const View = components === 3 || bits <= 8 ? (signed ? Int8Array : Uint8Array) : signed ? Int16Array : Uint16Array;
  return new View(info.pixels);
}

/** What frame `c` of `n` wants, `c` first, at most `w`; in groups of `g`, whole groups, the last want's `wanted` groups kept a frame longer, the reader `toward` -1, 0 or +1: docs/client/evidence/what-a-view-asks-for.md, *M, the budget* */
export function wantFrom(c, n, fillMode, ascending, w = n, g = 1, wanted = new Set(), toward = 0) {
  if (!fillMode) return [c];
  if (g > 1 && w < n) {
    const kept = new Set(nearestGroups(c, n, w, g, wanted, toward).flatMap((j) => Array.from({ length: g }, (_, k) => j * g + k)));
    return wantFrom(c, n, true, ascending).filter((i) => kept.has(i));
  }
  if (ascending && w >= n) return Array.from({ length: n }, (_, d) => (c + d) % n);
  const order = [c];
  for (let d = 1; order.length < Math.min(n, w); d++) for (const i of [c + d, c - d]) if (i >= 0 && i < n && order.length < w) order.push(i);
  return ascending ? [...order.filter((i) => i >= c).sort((a, b) => a - b), ...order.filter((i) => i < c)] : order;
}

/** The groups of `g` frames nearest frame `c`, as many as `w` frames hold and at least two; a `wanted` group ranks one frame nearer, so no one-frame step back and forth changes the set, and the neighbour the reader moves `toward` a group nearer; at equal rank the later. */
function nearestGroups(c, n, w, g, wanted, toward) {
  const ahead = Math.floor(c / g) + toward;
  const rank = (j) => Math.max(j * g - c, c - (j * g + g - 1), 0) - wanted.has(j) - g * (toward !== 0 && j === ahead);
  return [...Array(Math.ceil(n / g)).keys()].sort((a, b) => rank(a) - rank(b) || b - a).slice(0, Math.max(2, Math.floor(w / g)));
}

/** The memory window a view holds by default, in frames: the series' whole decoded frames that fit in 256 MiB; a sample is one byte at 8 bits or in colour, else two. */
export function memoryWindow({ width, height, channels = 1, bitsStored }) {
  const sample = channels === 3 || bitsStored <= 8 ? 1 : 2;
  const w = Math.floor(VIEW_MEMORY / (width * height * channels * sample));
  // Metadata without the frame's size bounds nothing.
  return Number.isNaN(w) ? Infinity : w;
}

export class Controller {
  /** Set once connected: what the controller asks of the downloader through. */
  client = null;
  /** Lab setting `waitAhead`: the want ascends from the current frame and wraps, as the cine does. docs/adr/frame-path.md §3, *Experiment 2* */
  ascending = false;
  current = 0;
  received = 0;
  seen = { exact: 0, inexact: 0, unchecked: 0, routes: {} };
  issuedAt = 0;
  fillMs = null;
  firstShownMs = null;
  paints = 0;
  lastPaint = null;
  #meta;
  #n;
  /** The frames the store keeps; with no cache, the fill asks no more. */
  #window;
  /** Frames per group: a series in groups is held and let go a whole group at a time. */
  #group;
  /** The groups the last want named: wantFrom's `wanted`. */
  #wantedGroups = new Set();
  /** The last step's sign, and wantFrom's `toward`: that sign once two steps in a row agree, else 0, so a rock sets no direction. */
  #lastStep = 0;
  #toward = 0;
  #fillMode;
  #emit;
  #voi = null;
  #invert = false;
  #pose = FIT;
  #painting = null;
  /** Set before the paint loop starts, cleared as it ends: the loop can end before its promise is stored. */
  #looping = false;
  #dirty = false;
  /** Each pending ask's frame and the step that made it; a cancel empties it. */
  #asks = new Map();
  #steps = 0;
  /** Under an optimal-quality series, the client of its exact series; `#exact`, the one frame asked exact, `{ i, frame?, failed? }`. */
  exactClient = null;
  #exact = null;
  #exactAsks = new Map();
  #cutShift;
  /** Nothing is painted, so nothing labelled, before it settles: under an optimal-quality series, the pair's check. */
  #paintAfter;

  /** `paint(frame, display, { read })` draws a held frame; `emit(type, event)` tells the page; `size` is the canvas's CSS size and DPR; `budget` in frames. */
  constructor({ meta, fillMode, paint, emit, size, budget = memoryWindow(meta), paintAfter = null }) {
    this.#paintAfter = paintAfter;
    this.#window = budget;
    this.#group = meta.lossy?.g > 1 ? meta.lossy.g : 1;
    this.store = new FrameStore({ arrived: (i, frame) => this.#arrived(i, frame), budget: this.#group > 1 ? Math.max(budget, 2 * this.#group) : budget });
    this.store.painted = () => this.#painting;
    this.#meta = meta;
    this.#n = meta.frameCount;
    this.#cutShift = cutShift(meta);
    this.#fillMode = fillMode;
    this.paint = paint;
    this.#emit = emit;
    this.size = size;
  }

  /** `f.ack`, when the consumer leaves the ack to the store; `f.write`, when its decoder writes the cache. */
  take(f) {
    if (this.#cutShift && f.info.bits !== CUT_DEPTH) {
      f.ack?.();
      return this.refused(f.frameIndex, `a depth cut's frame decoded at ${f.info.bits} bits, not ${CUT_DEPTH}`);
    }
    const info = this.#cutShift ? { ...f.info, cutShift: this.#cutShift } : f.info;
    this.store.put(f.frameIndex, { info, arrived: now(), write: f.write }, f.ack);
  }

  #arrived(i, { info }) {
    this.received += 1;
    const e = info.exact;
    this.seen[e === true ? "exact" : e === false ? "inexact" : "unchecked"]++;
    if (info.route) this.seen.routes[info.route] = (this.seen.routes[info.route] ?? 0) + 1;
    const have = this.#have();
    if (this.#fillMode && this.fillMs === null && have === this.#fillSize()) this.fillMs = now() - this.issuedAt;
    if (i === this.current) this.repaint();
    this.#emit("progress", { have, total: this.#fillSize(), seen: this.seen, fillMs: this.fillMs, at: now() });
  }

  /** The frame's display: its own rescale and window where the metadata varies them, the user's window over both. */
  display(i, info) {
    const meta = this.#meta;
    const per = meta.perFrame ?? {};
    const rescale = per.rescale?.[i] ?? meta.rescale ?? { slope: 1, intercept: 0 };
    const w = per.window?.[i] ?? meta.window;
    let voi = this.#voi ?? (w && { center: w.center[0], width: w.width[0], function: w.function ?? "LINEAR" });
    if (!voi) {
      // No window in the metadata: the frame's decoded range, at full depth, through its rescale.
      const full = 2 ** (info.cutShift ?? 0);
      const lo = info.min * full * rescale.slope + rescale.intercept;
      const hi = info.max * full * rescale.slope + rescale.intercept;
      voi = { center: (lo + hi) / 2, width: Math.max(1, Math.abs(hi - lo) + 1), function: "LINEAR" };
    }
    const photometric = meta.photometric ?? (info.components === 3 ? "RGB" : "MONOCHROME2");
    return { photometric, rescale, voi, invert: this.#invert, view: this.#pose };
  }

  /** Paints the current frame, coalescing requests: at most one paint in flight and one waiting. */
  repaint() {
    this.#dirty = true;
    if (this.#looping) return this.#painting;
    this.#looping = true;
    this.#painting = (async () => {
      if (this.#paintAfter) await this.#paintAfter;
      this.#paintAfter = null;
      while (this.#dirty) {
        this.#dirty = false;
        const i = this.current;
        const f = this.#shownFrame(i);
        if (!f) continue;
        try {
          const d = this.display(i, f.info);
          this.lastPaint = await this.paint(f, d);
          const drawn = this.lastPaint?.drawn ?? now();
          f.painted ??= drawn;
          this.paints += 1;
          if (this.firstShownMs === null && f.info.exact === true) this.firstShownMs = drawn - this.issuedAt;
          this.#emit("shown", { i, exact: f.info.exact, reason: f.info.reason, window: d.voi, firstShownMs: this.firstShownMs, quality: this.quality(i, f), about: about(f.info) });
        } catch (e) {
          this.#emit("failed", { scope: "worker", reason: `paint: ${e.message}` });
        }
      }
      this.#looping = false;
    })();
    return this.#painting;
  }

  /** A step: its frame painted from here, or asked — ahead of the fill, and in on-demand mode the newest ask alone. */
  async show(i) {
    const n = this.#n;
    const sign = Math.sign((i + n) % n - this.current);
    if (sign) [this.#toward, this.#lastStep] = [sign === this.#lastStep ? sign : 0, sign];
    this.current = (i + n) % n;
    if (this.#exact?.i !== this.current) this.#exact = null;
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
      this.take(await this.client.requestFrame(want));
    } catch (e) {
      if (this.#asks.get(want) === step) this.#emit("failed", { scope: "frame", i: want, reason: e.message });
    } finally {
      if (this.#asks.get(want) === step) this.#asks.delete(want);
    }
  }

  /** A frame let go with no cache would be asked again, so the want stops at the window; with one, the whole series fills. */
  want() {
    const want = wantFrom(this.current, this.#n, this.#fillMode, this.ascending, this.store.cache ? this.#n : this.#window, this.#group, this.#wantedGroups, this.#toward);
    this.#wantedGroups = new Set(want.map((i) => Math.floor(i / this.#group)));
    return want;
  }

  /** The page view's downloader; past the window with no cache, each step's misses go through the store, as under the worker view. */
  link(client, sent) {
    this.client = client;
    if (!this.#fillMode || this.#fillSize() === this.#n) return;
    this.store.want(sent);
    this.store.link(client, sent);
  }

  /** The fill's frames here: with no cache the window's held, else every arrival. */
  #have() {
    return this.#fillMode && !this.store.cache ? this.want().filter((i) => this.store.has(i)).length : this.received;
  }

  #fillSize() {
    return this.store.cache ? this.#n : wantFrom(this.current, this.#n, true, this.ascending, this.#window, this.#group, this.#wantedGroups, this.#toward).length;
  }

  /** The frame painted at `i`: its exact frame once that is here and checked, else the store's. */
  #shownFrame(i) {
    return (this.#exact?.i === i && this.#exact.frame) || this.store.get(i);
  }

  /**
   * The label of frame `f` painted at `i`, null for a series that is not optimal quality. Clinical invariant: `lossless` only for
   * the exact series' frame whose digest matched. client/README.md §Optimal quality, exact on request
   */
  quality(i, f) {
    if (!this.#meta.lossy) return null;
    const e = this.#exact?.i === i ? this.#exact : null;
    if (e?.frame === f && f.info.exact === true) return "lossless";
    if (e?.failed) return "failed";
    return e ? "asking" : "optimal";
  }

  /** The current frame from the exact series, painted in its place once checked; it stays until the reader leaves it. */
  async showExact() {
    const i = this.current;
    if (!this.exactClient || (this.#exact?.i === i && !this.#exact.failed)) return;
    const e = (this.#exact = { i });
    this.repaint();
    if (!this.#exactAsks.has(i)) this.#exactAsks.set(i, this.exactClient.requestFrame(i).finally(() => this.#exactAsks.delete(i)));
    try {
      const { info } = await this.#exactAsks.get(i);
      if (info.exact === true) e.frame = { info, arrived: now() };
      else e.failed = info.exact === false ? `not exact: ${info.reason}` : "the exact series has no digest for this frame";
    } catch (err) {
      e.failed = err.message;
    }
    if (this.#exact !== e) return;
    if (e.failed) this.#emit("failed", { scope: "frame", i, reason: `lossless: ${e.failed}` });
    return this.repaint();
  }

  /** Back to the optimal-quality frame. */
  showOptimal() {
    if (!this.#exact) return;
    this.#exact = null;
    return this.repaint();
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
    const f = this.#shownFrame(i);
    if (!f) return null;
    const [{ toSource }, { rescale }] = await Promise.all([import("../paint/reference.js"), import("../paint/voi.js")]);
    const { width, height, dpr } = this.size;
    const p = toSource(f.info, this.#pose, Math.round(width * dpr), Math.round(height * dpr), dpr)(Math.floor(x * dpr), Math.floor(y * dpr));
    if (!p) return null;
    const { width: w, height: h, components } = f.info;
    const [col, row] = [Math.min(w - 1, Math.floor(p[0])), Math.min(h - 1, Math.floor(p[1]))];
    const full = 2 ** (f.info.cutShift ?? 0);
    const stored = [...samplesOf(f.info).subarray((row * w + col) * components, (row * w + col + 1) * components)].map((s) => s * full);
    const { slope, intercept } = rescale(this.display(i, f.info).rescale);
    return { i, x: col, y: row, stored, modality: stored.map((s) => s * slope + intercept) };
  }

  /** Each frame here, its digest taken where it is held, for a lab harness; `flip`, one sample bit flipped first. lab/viewer/levers.js */
  async ledger({ flip = false } = {}) {
    const { sha256Hex } = await import("../decode/wasm-glue.js");
    const frames = [];
    let boot;
    for (const i of this.store.keys()) {
      const { info, arrived, painted, writeAsked, written } = this.store.get(i);
      boot ??= info.stamps?.boot;
      const samples = new Uint8Array(info.pixels).slice();
      if (flip) samples[samples.length >> 1] ^= 1;
      frames.push({ i, page: arrived, lastByte: info.stamps?.lastByte, decoded: info.stamps?.decodeEnd, mediaReads: info.stamps?.mediaReads, exact: info.exact, route: info.route, painted, writeAsked, written, sha: await sha256Hex(samples) });
    }
    return { frames, firstShownMs: this.firstShownMs, fillMs: this.fillMs, stats: this.client.stats(), boot };
  }
}
