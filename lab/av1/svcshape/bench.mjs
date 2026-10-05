/**
 * One round of SVCSHAPE's decode arms in a page: each arm decodes a set's first FRAMES temporal units
 * in order on a fresh dav1d-WASM decoder, after an untimed pass on another, and reports the mean ms a
 * frame. Every full operating point is merged with the set's low bits when it is split and hashed
 * against the truth.
 */
import { createDecoder } from "../dav1d-wasm/dav1d.mjs";
import { order } from "../../order.mjs";

export const FRAMES = 8;
export const SETS = ["ct_lidc", "xa_dynact16", "mr_ispy1", "rf_fluoro", "us_liver", "dbt12_ea1141",
  "dbt10_ea1141", "dbtproj_ge", "dbtproj_holo"];
const WORK = "lab/.av1-work/svcshape";

/** IVF frames grouped by timestamp: the example writes each spatial layer as its own IVF frame. */
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

// (arm, stream, operating point: libaom numbers op i = spatial·T + temporal from the top down,
// so a base of S spatial layers is op S − 1 and temporal layer 0 of T is op T − 1; checked = exact expected)
const ARMS = [
  ["single", "single.ivf_0", 0, true],
  ["half-base", "half-q40.ivf_0", 1, false],
  ["half-all", "half-q40.ivf_1", 0, true],
  ["quarter-base", "quarter-q40.ivf_0", 1, false],
  ["quarter-all", "quarter-q40.ivf_1", 0, true],
  ["quality-base", "quality-q40.ivf_0", 1, false],
  ["quality-all", "quality-q40.ivf_1", 0, true],
  ["three-base", "three-q40.ivf_0", 2, false],
  ["three-all", "three-q40.ivf_2", 0, true],
  ["L1T3-base", "L1T3.ivf_0", 2, false],
  ["L1T3-all", "L1T3.ivf_2", 0, true],
];

export async function prepare(get, names) {
  const sets = [];
  for (const name of names) {
    const meta = JSON.parse(new TextDecoder().decode(await get(`lab/av1/data/${name}/metadata.json`)));
    const truth = [];
    for (let i = 0; i < FRAMES && i < meta.frameCount; i++) {
      truth.push(new TextDecoder().decode(await get(`lab/av1/data/${name}/${String(i).padStart(3, "0")}.sha256`)).trim());
    }
    const arms = [];
    for (const [arm, stream, op, checked] of ARMS) arms.push({ arm, op, checked, units: units(await get(`${WORK}/${name}/${stream}.av1`)) });
    const low = await get(`${WORK}/${name}/low.ivf_0.av1`).catch(() => null);
    if (low) arms.push({ arm: "low", op: 0, checked: false, units: units(low) });
    sets.push({ name, meta, truth, arms });
  }
  return sets;
}

/** Decoded planes back in the stored sample order the truth hashes: top << 2 | low when split. */
function stored(meta, f, low) {
  const { width: w, height: h, channels: ch, bitsStored, signed, min } = meta;
  const offset = min < 0 ? -min : 0;
  const out = bitsStored <= 8 ? new Uint8Array(w * h * ch) : signed ? new Int16Array(w * h * ch) : new Uint16Array(w * h * ch);
  const src = ch === 3 ? [f.planes[2], f.planes[0], f.planes[1]] : [f.planes[0]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < ch; c++) {
        const v = low ? (src[c][y * f.width + x] << 2) | low.planes[0][y * low.width + x] : src[c][y * f.width + x];
        out[(y * w + x) * ch + c] = v - offset;
      }
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

/** env: { dav1d: the module factory }. Rows: one per (set, arm). mutate "sample" flips a bit of each frame. */
export async function round(env, sets, r, mutate = "") {
  const rows = [];
  for (const s of order(sets, r)) {
    const runs = new Map();
    for (const a of order(s.arms, r)) runs.set(a.arm, { a, ...(await dav1dRun(env.dav1d, a.op, a.units)) });
    const low = runs.get("low")?.frames;
    for (const { a, ms, frames } of runs.values()) {
      let exact = null;
      if (a.checked) {
        exact = 0;
        for (const [i, f] of frames.entries()) {
          if (mutate === "sample") f.planes[0][0] ^= 1;
          exact += (await sha256(stored(s.meta, f, low?.[i]))) === s.truth[f.pts];
        }
      }
      rows.push({ set: s.name, arm: a.arm, round: r, ms, frames: frames.length, exact, size: `${frames[0]?.width}x${frames[0]?.height}` });
    }
  }
  return rows;
}
