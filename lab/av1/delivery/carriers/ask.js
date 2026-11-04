/**
 * Row CARRIERS in one page (docs/av1/profile-carriers.md §4): each arm on a fresh decoder, its clock, every frame
 * checked — exact frames against the fetch's checksum, lossy frames against native dav1d's (content.py).
 */
import { createDecoder } from "../../../../client/decode/wasm/dav1d/dav1d.mjs";
import * as htj2k from "../../../../client/decode/htj2k.js";
import { codecString, sequence } from "../../../../client/decode/av1-payload.js";
import { order } from "../../../order.mjs";

const OPENJPH = { glue: "/client/decode/wasm/vendor/openjph/openjphjs.js", wasm: "/client/decode/wasm/vendor/openjph/openjphjs.wasm", dir: "/client/decode/wasm/vendor/openjph" };
const ASKED = "three-full-m20";
const K1 = "three-full-m20-k1";
const SHIPPED_SHIFT = 2;
const GROUP = 8;

export const ASKS = ["svc", "svc1", "res", "htj2k", "htj2k-aa", "k2"];
export const VIEWS = ["base", "mid-m10", "mid-m20", "mid-m30", "mid1-m20", "sep-q8", "sep-q16", "sep-q32", "sep-q56", "wc-q16", "wc-q56"];

/** An IVF file's temporal units, the layers sharing a timestamp joined, in timestamp order. */
function ivf(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const byPts = new Map();
  for (let at = view.getUint16(6, true); at + 12 <= buf.length;) {
    const n = view.getUint32(at, true);
    const pts = Number(view.getBigUint64(at + 4, true));
    byPts.set(pts, [...(byPts.get(pts) ?? []), buf.subarray(at + 12, at + 12 + n)]);
    at += 12 + n;
  }
  return [...byPts.entries()].sort((a, b) => a[0] - b[0]).map(([, parts]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
    return out;
  });
}

async function sha256(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

export async function prepare(get, work, name) {
  const set = JSON.parse(new TextDecoder().decode(await get(`${work}/${name}.json`)));
  const layered = (shape, layer) => set.layered[shape].streams[layer];
  set.units = {};
  for (const shape of Object.keys(set.layered)) {
    for (const layer of ["base", "middle", "top"]) set.units[`${shape}/${layer}`] = ivf(await get(layered(shape, layer).path));
  }
  set.units.low = ivf(await get(set.low));
  set.units.k2 = ivf(await get(set.k2_top));
  for (const [q, c] of Object.entries(set.separate)) {
    set.units[`sep/${q}`] = await Promise.all(Array.from({ length: set.frames }, (_, i) => get(`${c.path}/${String(i).padStart(3, "0")}.obu`)));
  }
  const g = set.group;
  const asked = Array.from({ length: GROUP }, (_, j) => g + j);
  set.htj2kUnits = Object.fromEntries(await Promise.all(asked.map(async (k) => [k, await get(set.htj2k[k])])));
  set.residualUnits = Object.fromEntries(await Promise.all(asked.map(async (k) => [k, await get(set.separate.q16.residual_paths[k])])));
  set.asked = asked;
  return set;
}

/** dav1d-WASM at an operating point, opened off the clock. */
async function dav1d(env, op) {
  return createDecoder(async (o) => {
    const M = await env.dav1d(o);
    M._av1_open = (threads) => M._av1_open_op(threads, op, 0);
    return M;
  });
}

/** WebCodecs as the profiles decode protocol configures it; one unit in flight, the luma copied out. */
function webcodecs(first) {
  let wake = null;
  let got = null;
  let failed = null;
  let stamp = 0;
  const vd = new VideoDecoder({ output: (f) => ((got = f), wake?.()), error: (e) => ((failed = e), wake?.()) });
  vd.configure({ codec: codecString(sequence(first)), hardwareAcceleration: "prefer-software", optimizeForLatency: true });
  return {
    async decode(u) {
      const out = new Promise((r) => (wake = r));
      vd.decode(new EncodedVideoChunk({ type: sequence(u) ? "key" : "delta", timestamp: stamp++, data: u }));
      await out;
      if (failed) throw failed;
      const f = got;
      got = null;
      const { width: w, height: h } = f.visibleRect;
      const buf = new Uint8Array(f.allocationSize());
      const [luma] = await f.copyTo(buf);
      f.close();
      const row = w * 2;
      const px = new Uint8Array(row * h);
      for (let y = 0; y < h; y++) px.set(buf.subarray(luma.offset + y * luma.stride, luma.offset + y * luma.stride + row), y * row);
      return { width: w, height: h, planes: [new Uint16Array(px.buffer)] };
    },
    close: () => vd.state !== "closed" && vd.close(),
  };
}

/** The stored samples the fetch's checksum covers, cropped to the volume: (top << shift) | low. */
function merged(set, top, low, shift) {
  const { width: w, height: h } = set;
  const out = new Uint16Array(w * h);
  const t = top.planes[0];
  const l = low?.planes[0];
  for (let y = 0; y < h; y++) {
    const a = y * top.width;
    const o = y * w;
    if (!shift) {
      out.set(t.subarray(a, a + w), o);
      continue;
    }
    const b = y * low.width;
    for (let x = 0; x < w; x++) out[o + x] = (t[a + x] << shift) | l[b + x];
  }
  return out;
}

/** The exact samples from the lossy frame and its residual: (lossy << shift) + residual − offset. */
function added(set, lossy, r, shift, offset) {
  const { width: w, height: h } = set;
  const out = new Uint16Array(w * h);
  const p = lossy.planes[0];
  for (let y = 0; y < h; y++) {
    const a = y * lossy.width;
    const o = y * w;
    for (let x = 0; x < w; x++) out[o + x] = (p[a + x] << shift) + r[o + x] - offset;
  }
  return out;
}

async function checkExact(set, decoded, k, mutate) {
  const samples = decoded.buffer instanceof SharedArrayBuffer ? decoded.slice() : decoded;
  if (mutate === "sample") samples[0] ^= 1;
  const truth = mutate === "truth" ? set.truth[k].replace(/^./, (c) => (c === "0" ? "1" : "0")) : set.truth[k];
  return (await sha256(bytesOf(samples))) === truth;
}

async function checkLossy(plane, ref, mutate) {
  if (mutate === "sample") plane[0] ^= 1;
  const want = mutate === "truth" ? ref.replace(/^./, (c) => (c === "0" ? "1" : "0")) : ref;
  return (await sha256(bytesOf(plane))) === want;
}

/** One ask for frame k; [ms, exact, lossy checks passed or null]. */
async function ask(env, set, arm, k, mutate) {
  const low = set.units.low;
  if (arm === "svc" || arm === "svc1") {
    const shape = arm === "svc" ? ASKED : K1;
    const units = set.units[`${shape}/top`];
    const key = arm === "svc" ? GROUP : 1;
    const start = k - (k % key) + (mutate === "skip" && k % key ? 1 : 0);
    const lk = mutate === "low" ? k + 1 : k;
    const top = await dav1d(env, 0);
    const lowDec = set.shift ? await dav1d(env, 0) : null;
    const t0 = performance.now();
    let f;
    for (let i = start; i <= k; i++) f = top.decode(units[i]);
    const l = lowDec?.decode(low[lk]);
    const samples = merged(set, f, l, set.shift);
    const ms = performance.now() - t0;
    top.close();
    lowDec?.close();
    return [ms, await checkExact(set, samples, k, mutate), null];
  }
  if (arm === "k2") {
    const top = await dav1d(env, 0);
    const lowDec = await dav1d(env, 0);
    const lk = mutate === "low" ? k + 1 : k;
    const t0 = performance.now();
    const samples = merged(set, top.decode(set.units.k2[k]), lowDec.decode(low[lk]), SHIPPED_SHIFT);
    const ms = performance.now() - t0;
    top.close();
    lowDec.close();
    return [ms, await checkExact(set, samples, k, mutate), null];
  }
  if (arm === "res") {
    const c = set.separate.q16;
    const lossyDec = await dav1d(env, 0);
    let lossy;
    for (let i = k - (k % c.g); i <= k; i++) lossy = lossyDec.decode(set.units["sep/q16"][i]);
    lossyDec.close();
    const lossyOk = await checkLossy(lossy.planes[0].slice(), c.lossy_dav1d[k], "");
    const offset = c.residual_offset + (mutate === "offset" ? 1 : 0);
    const t0 = performance.now();
    const r = htj2k.decodeFrame(set.residualUnits[k]);
    const rv = r.info.bitsPerSample > 8 ? new Uint16Array(r.sab) : new Uint8Array(r.sab);
    const samples = added(set, lossy, rv, c.shift, offset);
    const ms = performance.now() - t0;
    return [ms, await checkExact(set, samples, k, mutate), lossyOk];
  }
  const t0 = performance.now();
  const f = htj2k.decodeFrame(set.htj2kUnits[k]);
  const samples = new Uint16Array(f.sab);
  const ms = performance.now() - t0;
  return [ms, await checkExact(set, samples, k, mutate), null];
}

/** A view: every frame of the volume in order on one fresh decoder; each frame's ms and its lossy check. */
async function view(env, set, arm, mutate) {
  const [kind, which] = arm.split("-");
  let units;
  let refs;
  let dec;
  if (kind === "sep" || kind === "wc") {
    units = set.units[`sep/${which}`];
    refs = set.separate[which].lossy_dav1d;
    dec = kind === "wc" ? webcodecs(units[0]) : await dav1d(env, 0);
  } else {
    const shape = kind === "mid1" ? K1 : kind === "base" ? ASKED : `three-full-${which}`;
    const layer = kind === "base" ? "base" : "middle";
    units = set.units[`${shape}/${layer}`];
    refs = set.layered[shape].lossy[layer];
    dec = await dav1d(env, set.layered[shape].streams[layer].op);
  }
  const ms = [];
  let ok = 0;
  for (const [i, u] of units.entries()) {
    const t0 = performance.now();
    const f = await dec.decode(u);
    ms.push(performance.now() - t0);
    ok += await checkLossy(f.planes[0], refs[i], mutate);
  }
  dec.close();
  return { ms, lossy: ok, frames: units.length };
}

/** Untimed: two units on each decoder kind and one HTJ2K frame, so no arm pays the first compile. */
async function warm(env, set) {
  await htj2k.init(OPENJPH);
  htj2k.decodeFrame(set.htj2kUnits[set.asked[0]]);
  const sep = set.units["sep/q16"];
  const d = await dav1d(env, 0);
  d.decode(sep[0]);
  d.decode(sep[1]);
  d.close();
  const w = webcodecs(sep[0]);
  await w.decode(sep[0]);
  await w.decode(sep[1]);
  w.close();
}

/** One round on one volume: every arm in a Williams order, each ask arm's positions in one too. */
export async function round(env, set, r, mutate = "", arms = [...ASKS, ...VIEWS]) {
  await warm(env, set);
  const rows = [];
  let prev = null;
  for (const arm of order(arms, r)) {
    if (ASKS.includes(arm)) {
      for (const k of order(set.asked, r)) {
        const [ms, exact, lossy] = await ask(env, set, arm, k, mutate);
        rows.push({ set: set.name, arm, round: r, prev, k, position: k % GROUP, ms, exact, lossy });
      }
    } else {
      rows.push({ set: set.name, arm, round: r, prev, ...(await view(env, set, arm, mutate)) });
    }
    prev = arm;
  }
  return rows;
}
