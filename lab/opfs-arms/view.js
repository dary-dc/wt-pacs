// The view worker of docs/adr/frame-path.md §The cache I/O in the view worker: it holds the frames, paints them at
// the display clock, and writes and reads the cache by one arm. The page sends it intents only.
import { hasher } from "../../client/decode/xxh3.js";

const now = () => performance.timeOrigin + performance.now();
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? null;
const quantile = (v, q) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(q * v.length))] ?? null;

let c = null;
let page = null;
let feeder = null;
let store = null;
let xxh3 = null;
let digests = [];
const memory = new Map();
const pending = [];
const written = new Map();
const blocks = [];
let inflight = 0;
let running = false;
const ticks = [];
const backlog = [];
let onTick = null;
let shown = 0;
let uploaded = -1;
let note = null;
let frameBytes = 0;

/** WebGL2 on the transferred canvas: the frame as an R16UI texture, drawn as grey through one quad. */
const painter = {
  gl: null,
  init(canvas) {
    const gl = (this.gl = canvas.getContext("webgl2"));
    const sh = (kind, text) => { const s = gl.createShader(kind); gl.shaderSource(s, text); gl.compileShader(s); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, `#version 300 es
      void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; precision highp usampler2D;
      uniform usampler2D s; uniform vec2 scale; out vec4 frag;
      void main() { frag = vec4(vec3(float(texelFetch(s, ivec2(gl_FragCoord.xy * scale), 0).r) / 65535.0), 1.0); }`));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16UI, c.w, c.h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.uniform2f(gl.getUniformLocation(p, "scale"), c.w / canvas.width, c.h / canvas.height);
  },
  paint(pixels) {
    const gl = this.gl;
    if (pixels) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, c.w, c.h, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array(pixels));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  },
};

const root = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("opfs-arms", { create: true });
let calls = 0;
const replies = new Map();
const ask = (kind, m, transfer) => new Promise((resolve) => (replies.set(++calls, resolve), store.postMessage({ kind, id: calls, ...m }, transfer)));
const dropped = () => c.mutant === "drop-writes";

/** The arms: `put` writes frame i (A also a byte range of it, synchronously); `get` reads it back. */
const arms = {
  none: { open: async () => {}, put: async () => {}, get: async () => { throw new Error("no cache"); } },
  A: {
    async open() {
      this.h = await (await (await root()).getFileHandle("frames", { create: true })).createSyncAccessHandle();
      this.h.truncate(c.n * frameBytes);
    },
    put(i, pixels, at = 0, end = frameBytes) {
      if (!dropped()) this.h.write(new Uint8Array(pixels, at, end - at), { at: i * frameBytes + at });
    },
    async get(i) {
      const pixels = new SharedArrayBuffer(frameBytes);
      this.h.read(new Uint8Array(pixels), { at: i * frameBytes });
      return pixels;
    },
  },
  B: {
    async open() { this.dir = await (await root()).getDirectoryHandle("frames", { create: true }); },
    /** The chunk type is BufferSource, not AllowShared: the frame is copied out of shared memory first. */
    async put(i, pixels, copy = new Uint8Array(pixels).slice()) {
      if (dropped()) return;
      const w = await (await this.dir.getFileHandle(String(i), { create: true })).createWritable();
      await w.write(copy);
      await w.close();
    },
    async get(i) { return (await (await this.dir.getFileHandle(String(i))).getFile()).slice(0, frameBytes).arrayBuffer(); },
  },
  C: {
    async open() { await ask("open", { key: "opfs-arms", digests }); },
    async put(i, pixels) {
      if (dropped()) return;
      const r = await ask("write", { index: i, info: { width: c.w, height: c.h, bits: 16, components: 1, signed: false, pixels, min: 0, max: 65535, exact: true } });
      if (!r.written) throw new Error(`store refused frame ${i}: ${r.error ?? "not written"}`);
    },
    async get(i) {
      const r = await ask("read", { index: i });
      if (!r.info) throw new Error(r.miss ?? r.error);
      return r.info.pixels;
    },
  },
};
const arm = () => arms[c.arm];

function done(i, f) {
  written.set(i, f);
  if (i >= c.held) memory.delete(i);
  feeder.postMessage({ kind: "credit" });
}

/** Writes a whole frame now, the order "arrival": A on this thread, B and C started and awaited off it. */
function writeNow(i, pixels, f, copy) {
  f.start ??= now();
  if (c.arm === "A") {
    arm().put(i, pixels);
    f.end = now();
    blocks.push(f.end - f.start);
    return done(i, f);
  }
  inflight++;
  const t = now();
  const p = arm().put(i, pixels, copy);
  blocks.push(now() - t);
  p.then(() => (inflight--, (f.end = now()), done(i, f)), (e) => (inflight--, (f.error = String(e)), done(i, f)));
}

/** The order "paint": after the paint, the queue drains for at most `budgetMs` more by byte ranges, A writing
 *  them and B copying them out of shared memory; B's write then starts, and the engine's own copy lands where it lands. */
function drain(tickStart, budgetMs) {
  while (pending.length && now() - tickStart < budgetMs) {
    const w = pending[0];
    const t = now();
    w.f.start ??= t;
    const end = Math.min(frameBytes, w.at + c.chunkBytes);
    if (c.arm === "A") arm().put(w.i, w.pixels, w.at, end);
    else (w.copy ??= new Uint8Array(frameBytes)).set(new Uint8Array(w.pixels, w.at, end - w.at), w.at);
    w.at = end;
    blocks.push(now() - t);
    if (w.at < frameBytes) continue;
    pending.shift();
    if (c.arm !== "A") writeNow(w.i, w.pixels, w.f, w.copy);
    else (w.f.end = now()), done(w.i, w.f);
  }
}

function arrive({ index, info, postedAt }) {
  const f = { postedAt, arrivedAt: now() };
  memory.set(index, info.pixels);
  if (c.arm === "none") return done(index, { ...f, start: f.arrivedAt, end: f.arrivedAt });
  if (c.order === "arrival") return writeNow(index, info.pixels, f);
  pending.push({ i: index, pixels: info.pixels, at: 0, f });
}

function tick(ts) {
  const start = now();
  const mutantFirst = c.mutant === "write-before-paint" && c.order === "paint";
  if (mutantFirst) drain(start, Infinity);
  if (running && c.cell !== "miss" && ticks.length % c.cineEvery === 0) shown = (shown + 1) % c.held;
  const pixels = memory.get(shown);
  painter.paint(uploaded !== shown && pixels ? pixels : null);
  if (pixels) uploaded = shown;
  const end = now();
  if (running) {
    ticks.push({ ts: performance.timeOrigin + ts, start, end });
    backlog.push(pending.length + inflight);
  }
  if (note && uploaded === note.index) page.postMessage({ kind: "painted", ...note, paintedAt: end }), (note = null);
  if (c.order === "paint" && !mutantFirst) drain(now(), c.budgetMs);
  onTick?.();
  requestAnimationFrame(tick);
}
const nextTicks = (k) => new Promise((resolve) => { let n = 0; onTick = () => { if (++n >= k) (onTick = null), resolve(); }; });
const until = async (cond, ms) => { for (const t0 = now(); !cond() && now() - t0 < ms; ) await nextTicks(1); };

async function show({ index, sentAt }) {
  const n = { index, sentAt, readStart: now() };
  if (!memory.has(index)) {
    const pixels = await arm().get(index);
    n.readEnd = now();
    if (c.arm !== "C") n.exact = xxh3.init().update(new Uint8Array(pixels)).digest("hex") === digests[index];
    n.checkEnd = now();
    memory.set(index, pixels);
  }
  shown = index;
  note = n;
}

/** Every frame recorded as written, read back by its arm and hashed: a write that did not land fails here. */
async function verify() {
  let ok = 0;
  const wrong = [];
  for (const i of written.keys()) {
    try {
      const pixels = await arm().get(i);
      if (xxh3.init().update(new Uint8Array(pixels)).digest("hex") === digests[i]) ok++;
      else wrong.push(i);
    } catch (e) {
      wrong.push(`${i}: ${e.name ?? e}`);
    }
  }
  return { ok, wrong: wrong.slice(0, 5), notOk: wrong.length };
}

function summary(period) {
  const gaps = ticks.slice(1).map((t, k) => t.start - ticks[k].start);
  const missed = gaps.reduce((s, g) => s + Math.max(0, Math.round(g / period) - 1), 0);
  const delays = ticks.map((t) => t.start - t.ts);
  const fills = [...written.entries()].filter(([i]) => i >= c.held).map(([, f]) => f);
  const first = Math.min(...fills.map((f) => f.arrivedAt));
  const last = Math.max(...fills.map((f) => f.end ?? f.start));
  const third = Math.floor(backlog.length / 3);
  return {
    periodMs: period, ticks: ticks.length, missedTicks: missed, missedShare: missed / Math.max(1, ticks.length + missed),
    paintDelayP50: median(delays), paintDelayP99: quantile(delays, 0.99), paintMsP50: median(ticks.map((t) => t.end - t.start)),
    lateAsPredicted: missed >= blocks.reduce((s, b) => s + Math.floor(b / period), 0), predictedMissedMin: blocks.reduce((s, b) => s + Math.floor(b / period), 0),
    blockMsP50: median(blocks), blockMsMax: blocks.length ? Math.max(...blocks) : null,
    frames: fills.length, errors: fills.filter((f) => f.error).length, writeMBps: (fills.length * frameBytes) / 1e3 / Math.max(1, last - first),
    backlogFirstThirdMax: Math.max(0, ...backlog.slice(0, third)), backlogLastThirdMax: Math.max(0, ...backlog.slice(-third)),
    arrivalLagP99: quantile(fills.map((f) => f.arrivedAt - f.postedAt), 0.99),
  };
}

async function cell() {
  await arm().open();
  feeder.postMessage({ kind: "send", from: 0, to: c.held });
  await until(() => memory.size === c.held, 60000);
  for (let i = 0; i < c.held; i++) {
    await arm().put(i, memory.get(i));
    written.set(i, { warm: true });
  }
  running = true;
  await nextTicks(60);
  const period = median(ticks.slice(1).map((t, k) => t.start - ticks[k].start));
  ticks.length = backlog.length = blocks.length = 0;
  const fill = c.cell === "late" ? { bytesPerMs: c.rateMBps * 1e3 } : { credits: 8 };
  feeder.postMessage({ kind: "go", from: c.held, to: c.n, ...fill });
  await until(() => written.size === c.n && !pending.length && !inflight, c.seconds * 4000);
  running = false;
  const result = { ...summary(period), complete: written.size === c.n };
  if (c.cell === "miss") {
    page.postMessage({ kind: "ready" });
    await new Promise((resolve) => (onIntentsDone = resolve));
  }
  result.verify = c.arm === "none" ? null : await verify();
  return result;
}
let onIntentsDone = null;

onmessage = async ({ data }) => {
  if (data.kind === "show") return show(data).catch((e) => page.postMessage({ kind: "painted", index: data.index, error: String(e) }));
  if (data.kind === "intents-done") return onIntentsDone();
  ({ config: c, page, feeder, store } = data);
  frameBytes = c.w * c.h * 2;
  xxh3 = await hasher();
  if (store) store.onmessage = ({ data: r }) => (replies.get(r.id)(r), replies.delete(r.id));
  painter.init(data.canvas);
  digests = await new Promise((resolve) => {
    feeder.onmessage = ({ data: m }) => (m.kind === "digests" ? resolve(m.digests) : arrive(m));
  });
  requestAnimationFrame(tick);
  try {
    page.postMessage({ kind: "result", ...(await cell()) });
  } catch (e) {
    page.postMessage({ kind: "result", error: `${e.name ?? ""}: ${e.message ?? e}` });
  }
};
