/**
 * Row CARRIERS, amended (docs/av1/profile-carriers.md §Profile carriers protocol, amended): one block in one page —
 * the layered stream at keyframe interval k, the separate streams at G = k (and 32 at k = 16), and the HTJ2K
 * control twice, in a Williams order; every frame checked as ask.js checks it.
 */
import * as htj2k from "../../../../client/decode/htj2k.js";
import { order } from "../../../order.mjs";
import { added, checkExact, checkLossy, dav1d, ivf, merged } from "./ask.js";

const OPENJPH = { glue: "/client/decode/wasm/vendor/openjph/openjphjs.js", wasm: "/client/decode/wasm/vendor/openjph/openjphjs.wasm", dir: "/client/decode/wasm/vendor/openjph" };
export const POINTS = [1, 4, 8, 16];
export const DRAWS = 8;

export const armsOf = (p) => [`lay-k${p}`, `sep-g${p}`, ...(p === 16 ? ["sep-g32"] : []), "ctrl", "ctrl-aa"];

/** The frames a round asks on a volume: DRAWS uniform draws of i in 0 … frames − 2 (i + 1 is asked too). */
export function draws(round, set, frames) {
  let a = (round * 7919 + [...set].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0)) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: DRAWS }, () => Math.floor(next() * (frames - 1)));
}

export async function prepare(get, work, name, point, round, mutate) {
  const set = JSON.parse(new TextDecoder().decode(await get(`${work}/${name}.json`)));
  set.asked = draws(round, name, set.frames).map((i) => (mutate === "dwell" ? Math.min(i, set.frames - 3) : i));
  const wanted = [...new Set([0, 1, ...set.asked.flatMap((i) => [i, i + 1, i + 2])])].filter((i) => i < set.frames);
  set.units = {};
  const c = set.layered[point];
  for (const layer of ["base", "middle", "top"]) set.units[`lay/${layer}`] = ivf(await get(c.streams[layer].path));
  set.units.low = set.shift ? ivf(await get(set.low)) : null;
  set.residual = {};
  for (const g of point === 16 ? [16, 32] : [point]) {
    for (const role of ["high", "cheap"]) {
      const s = set.separate[g][role];
      set.units[`sep${g}/${role}`] = await Promise.all(Array.from({ length: set.frames }, (_, i) => get(`${s.path}/${String(i).padStart(3, "0")}.obu`)));
    }
    set.residual[g] = Object.fromEntries(await Promise.all(wanted.map(async (i) => [i, await get(set.separate[g].high.residual_paths[i])])));
  }
  set.htj2kUnits = await Promise.all(set.htj2k.map((p) => get(p)));
  set.point = point;
  return set;
}

const keyOf = (i, key, mutate) => i - (i % key) + (mutate === "skip" && i % key ? 1 : 0);
const nextOf = (i, mutate) => (mutate === "dwell" ? i + 2 : i + 1);

/** Every unit in order on one fresh decoder: each frame's ms and how many match native dav1d's. */
async function cine(env, units, op, refs, mutate) {
  const dec = await dav1d(env, op);
  const ms = [];
  let ok = 0;
  for (const [i, u] of units.entries()) {
    const t0 = performance.now();
    const f = dec.decode(u);
    ms.push(performance.now() - t0);
    ok += await checkLossy(f.planes[0], refs[i], mutate);
  }
  dec.close();
  return { ms, lossy: ok, frames: units.length };
}

/** A jump to frame i of a lossy stream: a fresh decoder, the units from i's keyframe to i. */
async function jump(env, units, op, key, i, ref, mutate) {
  const dec = await dav1d(env, op);
  const t0 = performance.now();
  let f;
  for (let j = keyOf(i, key, mutate); j <= i; j++) f = dec.decode(units[j]);
  const ms = performance.now() - t0;
  return { dec, f, ms, lossy: await checkLossy(f.planes[0].slice(), ref, mutate) };
}

/** The layered exact frame i from its keyframe (cold), then i + 1 on the same decoders (the dweller's next). */
async function layeredExact(env, set, i, mutate) {
  const key = set.layered[set.point].k;
  const top = set.units["lay/top"];
  const low = set.units.low;
  const lk = (n) => (mutate === "low" ? n + 1 : n);
  const dec = await dav1d(env, 0);
  const lowDec = set.shift ? await dav1d(env, 0) : null;
  let t0 = performance.now();
  let f;
  for (let j = keyOf(i, key, mutate); j <= i; j++) f = dec.decode(top[j]);
  let samples = merged(set, f, lowDec?.decode(low[lk(i)]), set.shift);
  const cold = performance.now() - t0;
  const exact = await checkExact(set, samples, i, mutate);
  const n = nextOf(i, mutate);
  t0 = performance.now();
  if (n === i + 2) dec.decode(top[i + 1]);
  f = dec.decode(top[n]);
  samples = merged(set, f, lowDec?.decode(low[lk(n)]), set.shift);
  const next = performance.now() - t0;
  const exactNext = await checkExact(set, samples, i + 1, mutate);
  dec.close();
  lowDec?.close();
  return [{ op: "exact", i, ms: cold, exact }, { op: "next", i: i + 1, ms: next, exact: exactNext }];
}

/** The residual of frame i decoded, then added to the lossy frame: [samples, decode ms, add ms]. */
function residualAdd(set, g, lossy, i, mutate) {
  const c = set.separate[g].high;
  const t0 = performance.now();
  const r = htj2k.decodeFrame(set.residual[g][i]);
  const rv = r.info.bitsPerSample > 8 ? new Uint16Array(r.sab) : new Uint8Array(r.sab);
  const t1 = performance.now();
  const samples = added(set, lossy, rv, c.shift, c.residual_offset + (mutate === "offset" ? 1 : 0));
  return [samples, t1 - t0, performance.now() - t1];
}

/** The separate exact frame i after a jump: the lossy chain, then the residual and the add (timed apart); then i + 1. */
async function separateExact(env, set, g, i, mutate) {
  const units = set.units[`sep${g}/high`];
  const c = set.separate[g].high;
  const j = await jump(env, units, 0, c.g, i, c.lossy_dav1d[i], mutate);
  let [samples, decode, add] = residualAdd(set, g, j.f, i, mutate);
  const exact = await checkExact(set, samples, i, mutate);
  const n = nextOf(i, mutate);
  const t0 = performance.now();
  if (n === i + 2) j.dec.decode(units[i + 1]);
  const f = j.dec.decode(units[n]);
  [samples] = residualAdd(set, g, f, n, mutate);
  const next = performance.now() - t0;
  const exactNext = await checkExact(set, samples, i + 1, mutate);
  j.dec.close();
  return [
    { op: "jump", i, ms: j.ms, lossy: j.lossy },
    { op: "residual", i, ms: decode + add, decode, add, exact },
    { op: "next", i: i + 1, ms: next, exact: exactNext },
  ];
}

async function arm(env, set, name, mutate) {
  const rows = [];
  if (name.startsWith("ctrl")) {
    const ms = [];
    let ok = 0;
    for (const [i, u] of set.htj2kUnits.entries()) {
      const t0 = performance.now();
      const f = htj2k.decodeFrame(u);
      ms.push(performance.now() - t0);
      ok += await checkExact(set, new Uint16Array(f.sab), i, mutate);
    }
    return [{ op: "cine-exact", ms, exact: ok, frames: ms.length }];
  }
  if (name.startsWith("lay")) {
    const c = set.layered[set.point];
    rows.push({ op: "cine-high", ...(await cine(env, set.units["lay/middle"], c.streams.middle.op, c.lossy.middle, mutate)) });
    rows.push({ op: "cine-cheap", ...(await cine(env, set.units["lay/base"], c.streams.base.op, c.lossy.base, mutate)) });
    for (const i of set.asked) {
      const j = await jump(env, set.units["lay/middle"], c.streams.middle.op, c.k, i, c.lossy.middle[i], mutate);
      j.dec.close();
      rows.push({ op: "jump", i, ms: j.ms, lossy: j.lossy });
      rows.push(...(await layeredExact(env, set, i, mutate)));
    }
    return rows;
  }
  const g = Number(name.slice("sep-g".length));
  const s = set.separate[g];
  rows.push({ op: "cine-high", ...(await cine(env, set.units[`sep${g}/high`], 0, s.high.lossy_dav1d, mutate)) });
  rows.push({ op: "cine-cheap", ...(await cine(env, set.units[`sep${g}/cheap`], 0, s.cheap.lossy_dav1d, mutate)) });
  for (const i of set.asked) rows.push(...(await separateExact(env, set, g, i, mutate)));
  return rows;
}

/** Untimed before each arm: a collection, and two units (or one HTJ2K frame) on a throwaway decoder of its kind. */
async function washout(env, set, name) {
  globalThis.gc?.();
  if (name.startsWith("ctrl")) return void htj2k.decodeFrame(set.htj2kUnits[0]);
  const units = name.startsWith("lay") ? set.units["lay/top"] : set.units[`sep${name.slice(5)}/high`];
  const d = await dav1d(env, 0);
  d.decode(units[0]);
  d.decode(units[1]);
  d.close();
}

/** Untimed, once a block: every path its arms run (merge, residual, add) on frame 0, so none pays a first call. */
async function sacrificial(env, set) {
  await htj2k.init(OPENJPH);
  htj2k.decodeFrame(set.htj2kUnits[0]);
  await layeredExact(env, set, 0, "");
  for (const g of Object.keys(set.residual)) await separateExact(env, set, Number(g), 0, "");
}

/** One block on one volume, one round: its arms in a Williams order. */
export async function block(env, set, r, mutate = "", only) {
  await sacrificial(env, set);
  const out = [];
  let prev = null;
  for (const name of order(armsOf(set.point), r)) {
    if (only && !only.includes(name)) continue;
    await washout(env, set, name);
    let rows;
    try {
      rows = await arm(env, set, name, mutate);
    } catch (e) {
      rows = [{ op: "failed", error: String(e) }];
    }
    out.push(...rows.map((x) => ({ set: set.name, block: set.point, arm: name, round: r, prev, ...x })));
    console.log(`${set.name} k${set.point} ${name} done`);
    prev = name;
  }
  return out;
}
