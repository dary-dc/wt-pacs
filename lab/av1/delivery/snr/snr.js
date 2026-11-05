/**
 * Row SNRPREVIEW (docs/av1/snr-preview.md §5): one block in one page — the quality-layer stream, the two aomenc
 * streams, the quarter-base SVC stream (VL rung 8 only) and the HTJ2K control twice, in a Williams order, at one
 * (volume, G, VL rung). Every lossy frame is checked against native dav1d's hash, every exact frame against the fetch's.
 */
import * as htj2k from "../../../../client/decode/htj2k.js";
import { order } from "../../../order.mjs";
import { added, checkExact, checkLossy, dav1d, ivf, merged } from "../carriers/ask.js";
import { draws } from "../carriers/amended.js";

const OPENJPH = { glue: "/client/decode/wasm/vendor/openjph/openjphjs.js", wasm: "/client/decode/wasm/vendor/openjph/openjphjs.wasm", dir: "/client/decode/wasm/vendor/openjph" };
export const GS = [1, 8, 16];
export const VLS = [4, 8];
export const JUMPS = 4;

export const armsOf = (v) => ["snr", "two", ...(v === 8 ? ["svc"] : []), "ctrl", "ctrl-aa"];

const obus = (get, path, n) => Promise.all(Array.from({ length: n }, (_, i) => get(`${path}/${String(i).padStart(3, "0")}.obu`)));

export async function prepare(get, work, name, g, v, round, mutate) {
  const set = JSON.parse(new TextDecoder().decode(await get(`${work}/${name}.json`)));
  const c = set.g[g];
  set.asked = draws(round, name, set.frames).slice(0, JUMPS);
  set.c = { preview: c.preview, vl: c.vl[v], snr: c.snr[v], svc: c.svc };
  set.units = {
    "two/preview": await obus(get, c.preview.path, set.frames),
    "two/vl": await obus(get, c.vl[v].path, set.frames),
    "snr/preview": ivf(await get(c.snr[v].layers.preview.path)),
    "snr/vl": ivf(await get(c.snr[v].layers.vl.path)),
    "svc/base": ivf(await get(c.svc.base.path)),
    "svc/full": ivf(await get(c.svc.full.path)),
    low: set.shift ? ivf(await get(set.low)) : null,
  };
  set.residual = {
    two: await Promise.all(c.vl[v].residual_paths.map((p) => get(p))),
    snr: await Promise.all(c.snr[v].residual_paths.map((p) => get(p))),
  };
  set.htj2kUnits = await Promise.all(set.htj2k.map((p) => get(p)));
  set.g0 = Number(g);
  set.v = Number(v);
  if (mutate === "unit") set.units["snr/vl"][1] = set.units["snr/vl"][0];
  return set;
}

const keyOf = (i, g, mutate) => i - (i % g) + (mutate === "skip" && i % g ? 1 : 0);

/** Every unit in order on one fresh decoder at op: each frame's ms, and how many match native dav1d. */
async function pass(env, units, op, refs, mutate, each) {
  const dec = await dav1d(env, op);
  const ms = [];
  const res = [];
  let ok = 0;
  let exact = 0;
  for (const [i, u] of units.entries()) {
    const t0 = performance.now();
    const f = dec.decode(u);
    ms.push(performance.now() - t0);
    if (each) {
      const r = await each(f, i);
      res.push(r.ms);
      exact += r.exact;
    }
    ok += await checkLossy(f.planes[0], refs[i], mutate);
  }
  dec.close();
  return { ms, lossy: ok, frames: units.length, ...(each ? { res, exact } : {}) };
}

/** A fresh decoder at op, the units from i's keyframe to i: [decoder, last picture, ms, lossy check]. */
async function chain(env, units, op, g, i, ref, mutate) {
  const dec = await dav1d(env, op);
  const t0 = performance.now();
  let f;
  for (let j = keyOf(i, g, mutate); j <= i; j++) f = dec.decode(units[j]);
  const ms = performance.now() - t0;
  const lossy = ref === null ? null : await checkLossy(f.planes[0].slice(), ref, mutate);
  return { dec, f, ms, lossy };
}

/** Frame i's residual decoded and added to the visually lossless picture; ms of both, and the exact check. */
async function residual(set, arm, f, i, mutate) {
  const c = set.c[arm === "two" ? "vl" : "snr"];
  const t0 = performance.now();
  const r = htj2k.decodeFrame(set.residual[arm][i]);
  const rv = r.info.bitsPerSample > 8 ? new Uint16Array(r.sab) : new Uint8Array(r.sab);
  const t1 = performance.now();
  const samples = added(set, f, rv, c.shift, c.residual_offset + (mutate === "offset" ? 1 : 0));
  const t2 = performance.now();
  return { ms: t2 - t0, decode: t1 - t0, add: t2 - t1, exact: await checkExact(set, samples, i, mutate) };
}

/** The two-layer carriers: the preview in order, the visually lossless in order with every residual, then jumps. */
async function twoLayer(env, set, arm, mutate) {
  const one = arm === "snr";
  const pre = one ? set.c.snr.layers.preview : set.c.preview;
  const vl = one ? set.c.snr.layers.vl : set.c.vl;
  const ops = one ? [pre.op, vl.op] : [0, 0];
  const lossy = (c) => c.lossy ?? c.lossy_dav1d;
  const units = [set.units[`${arm}/preview`], set.units[`${arm}/vl`]];
  const rows = [{ op: "preview", ...(await pass(env, units[0], ops[0], lossy(pre), mutate)) }];
  rows.push({ op: "vl", ...(await pass(env, units[1], ops[1], lossy(vl), mutate, (f, i) => residual(set, arm, f, i, mutate))) });
  for (const i of set.asked) {
    const p = await chain(env, units[0], ops[0], set.g0, i, lossy(pre)[i], mutate);
    p.dec.close();
    rows.push({ op: "preview-jump", i, ms: p.ms, lossy: p.lossy });
    const q = await chain(env, units[1], ops[1], set.g0, i, lossy(vl)[i], mutate);
    rows.push({ op: "vl-jump", i, ms: q.ms, lossy: q.lossy });
    rows.push({ op: "residual", i, ...(await residual(set, arm, q.f, i, mutate)) });
    q.dec.close();
  }
  return rows;
}

/** The quarter base and its lossless top over it, merged with the low bits on 12. */
async function svc(env, set, mutate) {
  const c = set.c.svc;
  const low = set.units.low;
  const lowAt = (n) => (mutate === "low" ? n + 1 : n);
  const rows = [{ op: "preview", ...(await pass(env, set.units["svc/base"], c.base.op, c.base.lossy, mutate)) }];
  const lowDec = set.shift ? await dav1d(env, 0) : null;
  const dec = await dav1d(env, c.full.op);
  const ms = [];
  let exact = 0;
  for (const [i, u] of set.units["svc/full"].entries()) {
    const t0 = performance.now();
    const samples = merged(set, dec.decode(u), lowDec?.decode(low[lowAt(i)]), set.shift);
    ms.push(performance.now() - t0);
    exact += await checkExact(set, samples, i, mutate);
  }
  dec.close();
  rows.push({ op: "exact", ms, exact, frames: ms.length });
  for (const i of set.asked) {
    const p = await chain(env, set.units["svc/base"], c.base.op, set.g0, i, c.base.lossy[i], mutate);
    p.dec.close();
    rows.push({ op: "preview-jump", i, ms: p.ms, lossy: p.lossy });
    const q = await chain(env, set.units["svc/full"], c.full.op, set.g0, i, null, mutate);
    const jumpLow = set.shift ? await dav1d(env, 0) : null;
    const t0 = performance.now();
    const samples = merged(set, q.f, jumpLow?.decode(low[lowAt(i)]), set.shift);
    rows.push({ op: "exact-jump", i, ms: q.ms + performance.now() - t0, exact: await checkExact(set, samples, i, mutate) });
    q.dec.close();
    jumpLow?.close();
  }
  lowDec?.close();
  return rows;
}

async function arm(env, set, name, mutate) {
  if (name === "svc") return svc(env, set, mutate);
  if (name === "snr" || name === "two") return twoLayer(env, set, name, mutate);
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

/** Untimed before each arm: a collection, and two units (or one HTJ2K frame) on a throwaway decoder of its kind. */
async function washout(env, set, name) {
  globalThis.gc?.();
  if (name.startsWith("ctrl")) return void htj2k.decodeFrame(set.htj2kUnits[0]);
  const units = set.units[name === "svc" ? "svc/full" : `${name}/vl`];
  const d = await dav1d(env, 0);
  d.decode(units[0]);
  if (units.length > 1 && set.g0 > 1) d.decode(units[1]);
  d.close();
}

/** Untimed, once a block: every path its arms run (both layers, residual, add, merge) on frame 0. */
async function sacrificial(env, set) {
  await htj2k.init(OPENJPH);
  htj2k.decodeFrame(set.htj2kUnits[0]);
  const keep = set.asked;
  set.asked = [0];
  for (const name of armsOf(set.v).filter((a) => !a.startsWith("ctrl"))) {
    const units = set.units;
    set.units = Object.fromEntries(Object.entries(units).map(([k, u]) => [k, u && u.slice(0, 1)]));
    await arm(env, set, name, "").catch(() => {});
    set.units = units;
  }
  set.asked = keep;
}

/** One block on one volume, one round: its arms in a Williams order. */
export async function block(env, set, r, mutate = "", only) {
  await sacrificial(env, set);
  const out = [];
  let prev = null;
  for (const name of order(armsOf(set.v), r)) {
    if (only && !only.includes(name)) continue;
    await washout(env, set, name);
    let rows;
    try {
      rows = await arm(env, set, name, mutate);
    } catch (e) {
      rows = [{ op: "failed", error: String(e) }];
    }
    out.push(...rows.map((x) => ({ set: set.name, g: set.g0, v: set.v, arm: name, round: r, prev, ...x })));
    console.log(`${set.name} g${set.g0} v${set.v} ${name} done`);
    prev = name;
  }
  return out;
}
