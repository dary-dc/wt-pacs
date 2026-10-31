/**
 * Stage 1's decode time, shape.py's method: each variant decodes a volume's first FRAMES temporal units in order on a
 * fresh dav1d-WASM decoder after an untimed pass on another, the mean ms a frame; every full operating point (and
 * the shipped payload) merged with its low bits when split and hashed against the truth. README.md here.
 */
import { createDecoder } from "../../../../../client/decode/wasm/dav1d/dav1d.mjs";
import { order } from "../../../../order.mjs";

export const FRAMES = 8;
export const SETS = ["dbts_a1", "dbts_b1", "dbts_c1"];
const WORK = "lab/.av1-work/preview-tool";
/** Base quantizer 40, as shape.py's decode: (shape, spatial layers). */
const SHAPES = [["two-quarter-q40", 2], ["two-half-q40", 2], ["three-q40", 3], ["two-quarter-q40-one-key", 2]];

function units(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const byPts = new Map();
  for (let at = view.getUint16(6, true); at + 12 <= buf.length;) {
    const n = view.getUint32(at, true);
    const pts = Number(view.getBigUint64(at + 4, true));
    byPts.set(pts, [...(byPts.get(pts) ?? []), buf.subarray(at + 12, at + 12 + n)]);
    at += 12 + n;
  }
  return [...byPts.entries()].slice(0, FRAMES).map(([pts, parts]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
    return { pts, bytes: out };
  });
}

/** (variant, stream, operating point, low bits merged: null for a base, which is lossy and not checked). */
function variants(bits) {
  const out = [["shipped", "shipped-top.ivf", 0, 2], ["low", "low.ivf", 0, null]];
  for (const coding of bits === 12 ? ["whole", "split"] : ["whole"]) {
    for (const [name, sl] of SHAPES) {
      out.push([`${coding}-${name}-base`, `${coding}-${name}.ivf_0.av1`, sl - 1, null],
        [`${coding}-${name}-all`, `${coding}-${name}.ivf_${sl - 1}.av1`, 0, coding === "split" ? 2 : 0]);
    }
  }
  return out;
}

export async function prepare(get, names) {
  const sets = [];
  for (const name of names) {
    const meta = JSON.parse(new TextDecoder().decode(await get(`lab/av1/data/${name}/metadata.json`)));
    const truth = [];
    for (let i = 0; i < FRAMES; i++) truth.push(new TextDecoder().decode(await get(`lab/av1/data/${name}/${String(i).padStart(3, "0")}.sha256`)).trim());
    const list = [];
    for (const [variant, stream, op, shift] of variants(meta.bitsStored)) list.push({ variant, op, shift, units: units(await get(`${WORK}/${name}/${stream}`)) });
    sets.push({ name, meta, truth, variants: list });
  }
  return sets;
}

/** Decoded planes in the stored sample order the truth hashes: top << shift | low. */
function stored(meta, f, low, shift) {
  const { width: w, height: h } = meta;
  const out = meta.bitsStored <= 8 ? new Uint8Array(w * h) : new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = f.planes[0][y * f.width + x];
      out[y * w + x] = shift ? (v << shift) | low.planes[0][y * low.width + x] : v;
    }
  }
  return new Uint8Array(out.buffer);
}

async function sha256(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function dav1dRun(factory, op, list) {
  const opened = async (o) => {
    const M = await factory(o);
    M._av1_open = (threads) => M._av1_open_op(threads, op, 0);
    return M;
  };
  const warm = await createDecoder(opened);
  for (const u of list) warm.decode(u.bytes);
  warm.close();
  const dec = await createDecoder(opened);
  const out = [];
  const t0 = performance.now();
  for (const u of list) out.push(dec.decode(u.bytes));
  const ms = (performance.now() - t0) / list.length;
  dec.close();
  return { ms, frames: out.map((f, i) => ({ pts: list[i].pts, width: f.width, height: f.height, planes: f.planes })) };
}

/** env: { dav1d: the module factory }. One row per (set, variant); mutate "sample" flips a sample of every checked frame. */
export async function round(env, sets, r, mutate = "") {
  const rows = [];
  for (const s of order(sets, r)) {
    const runs = new Map();
    for (const a of order(s.variants, r)) runs.set(a.variant, { a, ...(await dav1dRun(env.dav1d, a.op, a.units)) });
    const low = runs.get("low").frames;
    for (const { a, ms, frames } of runs.values()) {
      let exact = null;
      if (a.shift !== null) {
        exact = 0;
        for (const [i, f] of frames.entries()) {
          if (mutate === "sample") f.planes[0][0] ^= 1;
          exact += (await sha256(stored(s.meta, f, low[i], a.shift))) === s.truth[f.pts];
        }
      }
      rows.push({ set: s.name, variant: a.variant, round: r, ms, frames: frames.length, exact, size: `${frames[0]?.width}x${frames[0]?.height}` });
    }
  }
  return rows;
}
