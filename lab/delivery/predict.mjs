// The delivery comparison's model and its predictions file, from the host's own K1–K3′ alone. delivery-comparison.md §4, §Amendment 2
//   node lab/delivery/predict.mjs INPUTS.json OUT.json
import { readFileSync, writeFileSync } from "node:fs";
import { ARMS, CELLS, DECODERS } from "./plan.mjs";

/** bytes */
export const INITIAL_WINDOW = 12000;
/** ms: one paint at 60 Hz */
export const PAINT_MS = 17;

const sum = (v) => v.reduce((a, b) => a + b, 0);

/** ms from the dial to a lossy form's first byte, the origin of K3′'s curve (A2.4). */
export const curveStart = (rttMs) => 3 * rttMs + 20;

/** ms from the dial to the last of `bytes`: K3's line (`startMs`, `goodputMbit`), or K3′'s piecewise-linear `curve` of [bytes, ms] points. */
export function wire(bytes, { startMs, goodputMbit, curve, rttMs }) {
  if (!curve) return startMs + (8 * bytes) / (goodputMbit * 1000);
  const pts = [[0, curveStart(rttMs)], ...curve];
  const past = pts.findIndex(([b]) => bytes <= b);
  const k = past < 0 ? pts.length - 1 : Math.max(1, past);
  const [[b0, t0], [b1, t1]] = [pts[k - 1], pts[k]];
  return t0 + ((bytes - b0) * (t1 - t0)) / (b1 - b0);
}

/** The makespan of `units` (each a frame count) handed in order to the first free of `decoders`, a frame taking `frameMs`. */
export function decodeFloor(units, frameMs, decoders) {
  const free = Array(decoders).fill(0);
  for (const frames of units) {
    const k = free.indexOf(Math.min(...free));
    free[k] += frames * frameMs;
  }
  return Math.max(...free);
}

/** One fill's units: groups of `group` frames for the view, single frames for HTJ2K. */
export const unitsOf = (n, group) => Array.from({ length: Math.ceil(n / group) }, (_, k) => Math.min(group, n - k * group));

export function regime(wireMs, floorMs) {
  if (wireMs > 1.1 * floorMs) return "wire";
  if (floorMs > 1.1 * wireMs) return "decode";
  return "near";
}

/** §4.1's fill of one series' first frames: `frames` their bytes, `group` 1 for HTJ2K. */
export function fill(frames, { group, frameMs, decoders = 2 }, link) {
  const units = unitsOf(frames.length, group);
  const w = wire(sum(frames), link);
  const floor = decodeFloor(units, frameMs, decoders);
  const ms = Math.max(w + frameMs, wire(sum(frames.slice(0, units[0])), link) + floor);
  return { ms, wireMs: w, floorMs: floor, regime: regime(w, floor) };
}

/** ms to send `bytes` on a session that never grew its window: doubling each round trip from the initial window until the bandwidth-delay product, then at goodput. */
export function slowStart(bytes, rttMs, goodputMbit) {
  const bdp = (goodputMbit * 1000 * rttMs) / 8;
  let [left, window, ms] = [bytes, INITIAL_WINDOW, 0];
  while (left > window && window < bdp) {
    left -= window;
    window *= 2;
    ms += rttMs;
  }
  return ms + (8 * left) / (goodputMbit * 1000);
}

/** A2.4: C1's ask → last byte; slow start on a line, the curve's first frame less its dial on a lossy form. */
export const askLastByte = (bytes, link) => (link.curve ? wire(bytes, link) - curveStart(link.rttMs) + link.rttMs : link.rttMs + slowStart(bytes, link.rttMs, link.goodputMbit));

/** §4.1's exact-frame latency of C1: the ask to its last byte, one lone decode, one paint. */
export const exactLatency = (bytes, link, loneMs) => askLastByte(bytes, link) + loneMs + PAINT_MS;

/** A2.7: FIT's zoom asks a frame's rest on the window the fill left (an assumption): no slow start on a line. */
export const zoomLatency = (restBytes, link, loneMs) => (link.curve ? askLastByte(restBytes, link) : link.rttMs + (8 * restBytes) / (link.goodputMbit * 1000)) + loneMs + PAINT_MS;

/** A2.3: SPLIT's fill (route-policy.md §4.6's balance, A's makespan factor k), A's where A is wire-bound or G is outside (G_A, G_B); `x` its exact groups' share. */
export function split(v, link, n, aFill) {
  const mean = (f) => (8 * sum(f.slice(0, n))) / n;
  const [bV, bE, dV, dE] = [mean(v.view.frames), mean(v.exact.frames), v.view.frameMs / DECODERS, v.exact.frameMs / DECODERS];
  const G = link.curve ? 0 : link.goodputMbit * 1000;
  if (aFill.regime === "wire" || !(G > bV / dV && G < bE / dE)) return { ms: aFill.ms, x: 0, regime: aFill.regime };
  const t = (bE * dV - bV * dE) / (G * (dV - dE) + (bE - bV));
  const k = decodeFloor(unitsOf(n, v.view.group), v.view.frameMs, DECODERS) / (n * dV);
  return { ms: wire(sum(v.view.frames.slice(0, v.view.group)), link) + k * n * t, x: (dV - t) / (dV - dE), regime: null };
}

/** §8's bands, an assumption: [low, high] of measured ÷ predicted. */
export function band(cell, kind) {
  const lossy = CELLS[cell].lossy;
  if (kind === "fill") return lossy ? [0.75, 1.33] : [0.85, 1.15];
  return lossy ? [0.6, 1.67] : [0.75, 1.33];
}

/** Every (cell, volume, arm)'s prediction from K1–K3′: `inputs` = { volumes: { id: { view, exact, shown, fit? } }, forms: { cell: { startMs, goodputMbit, rttMs, curves? } } }. */
export function predictions(inputs) {
  const rows = [];
  for (const [cell, form] of Object.entries(CELLS)) {
    if (!inputs.forms[cell]) continue;
    for (const [volume, v] of Object.entries(inputs.volumes)) {
      const link = { ...inputs.forms[cell], curve: inputs.forms[cell].curves?.[volume] };
      const n = Math.min(form.prefix ?? Infinity, v.view.frames.length);
      const view = fill(v.view.frames.slice(0, n), { group: v.view.group, frameMs: v.view.frameMs }, link);
      const exact = fill(v.exact.frames.slice(0, n), { group: 1, frameMs: v.exact.frameMs }, link);
      const shown = v.shown ?? 0;
      const latency = exactLatency(v.exact.frames[shown], link, v.exact.loneMs);
      const at = (arm, kind, p) => rows.push({ cell, volume, arm, kind, frames: n, ms: p.ms, regime: p.regime ?? null, band: band(cell, kind), ...(p.judged === false && { judged: false }), ...(p.x != null && { x: p.x }) });
      for (const arm of ARMS) {
        if (arm === "B") at(arm, "fill", exact);
        else if (arm === "FIT") at(arm, "fill", v.fit ? fill(v.fit.prefixes.slice(0, n), { group: 1, frameMs: v.fit.frameMs }, link) : exact);
        else if (arm === "SPLIT") at(arm, "fill", split(v, link, n, view));
        else at(arm, "fill", view);
        if (arm === "C1") at(arm, "latency", { ms: latency }), at(arm, "askLastByte", { ms: askLastByte(v.exact.frames[shown], link) });
        if (arm === "FIT") at(arm, "zoom", v.fit ? { ms: zoomLatency(v.fit.rests[shown], link, v.exact.loneMs) } : { ms: PAINT_MS, judged: false });
      }
    }
  }
  return rows;
}

/** The product's XXH3-64 hasher, which fetches its built wasm and manifest by path. */
export async function xxh3() {
  const fetch0 = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(readFileSync(String(url).replace(/^file:\/\//, "")));
  try {
    const { hasher } = await import("../../client/decode/xxh3.js");
    const h = await hasher();
    return (bytes) => h.init().update(bytes).digest("hex");
  } finally {
    globalThis.fetch = fetch0;
  }
}

export const digestOf = async (text) => (await xxh3())(new TextEncoder().encode(text));

if (import.meta.url === `file://${process.argv[1]}`) {
  const [inputs, out] = process.argv.slice(2);
  const text = JSON.stringify({ inputs: JSON.parse(readFileSync(inputs, "utf8")), predictions: predictions(JSON.parse(readFileSync(inputs, "utf8"))) }, null, 1);
  writeFileSync(out, text);
  console.log(`${out}: xxh3 ${await digestOf(text)}`);
}
