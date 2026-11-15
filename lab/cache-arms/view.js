// The view worker: paints from ring slots at its requestAnimationFrame, the shown frame changing every `cineEvery`
// ticks over the warm frames it keeps; a frame it does not hold is asked of the store worker (a miss). Nothing written here.
import { ring as makeRing } from "./ring.js";

const now = () => performance.timeOrigin + performance.now();
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? null;
const quantile = (v, q) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(q * v.length))] ?? null;

let c = null;
let ring = null;
let store = null;
const kept = new Map();
const arrived = [];
const ticks = [];
let running = false;
let shown = 0;
let uploaded = null;
let note = null;
let missSlot = null;
let mutantCopy = null;

/** WebGL2 on the transferred canvas: the frame as an R16UI texture through one quad (lab/opfs-arms/view.js, c99ba492). */
const painter = {
  init(canvas) {
    const gl = (this.gl = canvas.getContext("webgl2"));
    const sh = (kind, text) => { const s = gl.createShader(kind); gl.shaderSource(s, text); gl.compileShader(s); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, `#version 300 es
      void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; precision highp usampler2D;
      uniform usampler2D s; uniform vec2 scale; out vec4 frag;
      void main() { float v = float(texelFetch(s, ivec2(gl_FragCoord.xy * scale), 0).r) / 65535.0; frag = vec4(vec3(v), 1.0); }`));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16UI, c.w, c.h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.uniform2f(gl.getUniformLocation(p, "scale"), c.w / canvas.width, c.h / canvas.height);
  },
  paint(slot) {
    const gl = this.gl;
    if (slot !== null) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, c.w, c.h, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array(ring.samples, slot * ring.slotBytes, c.w * c.h));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  },
};

/** A frame from a feeder: a warm one kept, any other let go at once, as the view leaves a written frame. */
function arrive({ i, slot, postedAt }) {
  arrived.push({ i, postedAt, arrivedAt: now() });
  // The view-copy mutant: the old store worker's copy out of shared memory on this thread (cache-io-thread, arm C).
  if (c.mutant === "view-copy") mutantCopy = ring.bytes(slot, c.frameBytes).slice();
  if (i < c.held && !kept.has(i)) kept.set(i, slot);
  else ring.release(slot);
}

function tick(ts) {
  const start = now();
  if (running && c.cineEvery && ticks.length % c.cineEvery === 0 && !note) shown = (shown + 1) % c.held;
  const slot = note?.slot ?? kept.get(shown) ?? null;
  painter.paint(slot !== uploaded ? slot : null);
  uploaded = slot;
  const end = now();
  if (running) ticks.push({ ts: performance.timeOrigin + ts, start, end });
  if (note?.slot != null && !note.paintedAt) (note.paintedAt = end), page.postMessage({ kind: "painted", ...note }), (note = null);
  requestAnimationFrame(tick);
}

/** A miss: the frame asked of the store worker, painted from the slot it answers in, held until the next miss. */
function show({ i, sentAt }) {
  ring.readAsked();
  note = { i, sentAt, slot: null };
  store.postMessage({ i });
}

function answered({ i, slot, hit, damaged, waitMs }) {
  if (missSlot !== null) ring.release(missSlot);
  missSlot = slot;
  if (!hit) return page.postMessage({ kind: "painted", i, sentAt: note?.sentAt, hit, damaged, waitMs, paintedAt: now() }), (note = null);
  Object.assign(note, { slot, hit, waitMs, answeredAt: now() });
}

function summary() {
  const gaps = ticks.slice(1).map((t, k) => t.start - ticks[k].start);
  const period = c.periodMs;
  const missed = gaps.reduce((s, g) => s + Math.max(0, Math.round(g / period) - 1), 0);
  const delays = ticks.map((t) => t.start - t.ts);
  const fill = arrived.filter((a) => a.i >= c.held).sort((x, y) => x.postedAt - y.postedAt);
  return { periodMs: period, ticks: ticks.length, missedTicks: missed, missedShare: missed / Math.max(1, ticks.length + missed),
    paintDelayP50: median(delays), paintDelayP99: quantile(delays, 0.99), paintMsP50: median(ticks.map((t) => t.end - t.start)),
    arrived: arrived.length, arrivalLagP99: quantile(arrived.map((a) => a.arrivedAt - a.postedAt), 0.99),
    fillPosts: fill.length, firstPost: fill[0]?.postedAt ?? null, lastPost: fill.at(-1)?.postedAt ?? null };
}

let page = null;
const nextTicks = (k) => new Promise((resolve) => { const n0 = ticks.length; const f = () => (ticks.length - n0 >= k ? resolve() : setTimeout(f, 5)); f(); });

onmessage = async ({ data: m }) => {
  if (m.kind === "init") {
    c = m.config;
    ring = makeRing(m.samples, m.table, c.frameBytes);
    ({ store, page } = m);
    painter.init(m.canvas);
    for (const f of m.feeders) f.onmessage = ({ data }) => arrive(data);
    store.onmessage = ({ data }) => answered(data);
    requestAnimationFrame(tick);
    return;
  }
  if (m.kind === "run") {
    running = true;
    await nextTicks(60);
    c.periodMs = median(ticks.slice(1).map((t, k) => t.start - ticks[k].start));
    ticks.length = 0;
    return page.postMessage({ kind: "running" });
  }
  if (m.kind === "show") return show(m);
  if (m.kind === "stop") return (running = false), page.postMessage({ kind: "summary", ...summary(), copied: mutantCopy?.length ?? 0 });
  if (m.kind === "kept") return page.postMessage({ kind: "kept", count: kept.size });
};
