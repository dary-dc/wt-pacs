// The delivery comparison's model and its predictions file, from the host's own K1–K3 alone.
// docs/client/evidence/delivery-comparison.md §4
//   node lab/delivery/predict.mjs INPUTS.json OUT.json
import { readFileSync, writeFileSync } from "node:fs";
import { CELLS, ARMS } from "./plan.mjs";

/** bytes */
export const INITIAL_WINDOW = 12000;
/** ms: one paint at 60 Hz */
export const PAINT_MS = 17;

const sum = (v) => v.reduce((a, b) => a + b, 0);

/** ms from the dial to the last of `bytes`; `startMs` and `goodputMbit` are K3's line. */
export const wire = (bytes, { startMs, goodputMbit }) => startMs + (8 * bytes) / (goodputMbit * 1000);

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

/** §4.1's exact-frame latency of C1: the ask's round trip, slow start, one lone decode, one paint. */
export const exactLatency = (bytes, { rttMs, goodputMbit }, loneMs) => rttMs + slowStart(bytes, rttMs, goodputMbit) + loneMs + PAINT_MS;

/** §8's bands, an assumption: [low, high] of measured ÷ predicted. */
export function band(cell, kind) {
  const lossy = CELLS[cell].lossy;
  if (kind === "fill") return lossy ? [0.75, 1.33] : [0.85, 1.15];
  return lossy ? [0.6, 1.67] : [0.75, 1.33];
}

/** Every (cell, volume, arm)'s prediction from K1–K3: `inputs` = { volumes: { id: { view, exact, shown } }, forms: { cell: { startMs, goodputMbit, rttMs } }, exactDialed }. */
export function predictions(inputs) {
  const rows = [];
  for (const [cell, form] of Object.entries(CELLS)) {
    const link = inputs.forms[cell];
    if (!link) continue;
    for (const [volume, v] of Object.entries(inputs.volumes)) {
      const n = Math.min(form.prefix ?? Infinity, v.view.frames.length);
      const view = fill(v.view.frames.slice(0, n), { group: v.view.group, frameMs: v.view.frameMs }, link);
      const exact = fill(v.exact.frames.slice(0, n), { group: 1, frameMs: v.exact.frameMs }, link);
      const c2Link = inputs.exactDialed ? { ...link, startMs: link.startMs - 3 * link.rttMs } : link;
      const span = fill(v.exact.frames.slice(0, n), { group: 1, frameMs: v.exact.frameMs }, c2Link);
      const latency = exactLatency(v.exact.frames[v.shown ?? 0], link, v.exact.loneMs);
      const at = (arm, kind, p) => rows.push({ cell, volume, arm, kind, frames: n, ms: p.ms, regime: p.regime ?? null, band: band(cell, kind) });
      for (const arm of ARMS) {
        if (arm === "B") at(arm, "fill", exact);
        else at(arm, "fill", view);
        if (arm === "C1") at(arm, "latency", { ms: latency });
        if (arm === "C2") at(arm, "span", span);
      }
    }
  }
  return rows;
}

/** The predictions file's XXH3-64, by the product's hasher, which fetches its built wasm and manifest by path. */
export async function digestOf(text) {
  const fetch0 = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(readFileSync(String(url).replace(/^file:\/\//, "")));
  try {
    const { hasher } = await import("../../client/decode/xxh3.js");
    return (await hasher()).init().update(new TextEncoder().encode(text)).digest("hex");
  } finally {
    globalThis.fetch = fetch0;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [inputs, out] = process.argv.slice(2);
  const text = JSON.stringify({ inputs: JSON.parse(readFileSync(inputs, "utf8")), predictions: predictions(JSON.parse(readFileSync(inputs, "utf8"))) }, null, 1);
  writeFileSync(out, text);
  console.log(`${out}: xxh3 ${await digestOf(text)}`);
}
