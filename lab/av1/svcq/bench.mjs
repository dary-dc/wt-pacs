/**
 * One round of SVCQ's decode arms, in Node or a page: each arm decodes a set's first FRAMES temporal
 * units in order on a fresh decoder, after an untimed warm-up pass on another, and reports the mean
 * ms a frame over the whole run (WebCodecs needs a key chunk after every flush, so a group cannot be
 * timed frame by frame on it). The top and the single-layer arms are hashed against the truth.
 */
import { createDecoder } from "../dav1d-wasm/dav1d.mjs";
import { order } from "../../order.mjs";

export const FRAMES = 18;
export const SETS = { us_liver: 8, rf_fluoro: 12, mr_ispy1: 12 }; // the depth each is coded at
const WORK = "lab/.av1-work/svcq";

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
  return [...byPts.values()].slice(0, FRAMES).map((parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
    return out;
  });
}

// (arm, stream, dav1d operating point; null = WebCodecs, which cannot choose one, checked = exact expected)
const ARMS = [
  ["single", "single.ivf_0", 0, true],
  ["half-base", "half-q40.ivf_0", 1, false],
  ["half-all", "half-q40.ivf_1", 0, true],
  ["full-base", "full-q40.ivf_0", 1, false],
  ["full-all", "full-q40.ivf_1", 0, true],
  ["wc-single", "single.ivf_0", null, true],
  ["wc-half-base", "half-q40.ivf_0", null, false],
  ["wc-half-all", "half-q40.ivf_1", null, true],
];

export async function prepare(get, names, webcodecs) {
  const sets = [];
  for (const name of names) {
    const meta = JSON.parse(new TextDecoder().decode(await get(`lab/av1/data/${name}/metadata.json`)));
    const truth = [];
    for (let i = 0; i < FRAMES; i++) {
      truth.push(new TextDecoder().decode(await get(`lab/av1/data/${name}/${String(i).padStart(3, "0")}.sha256`)).trim());
    }
    const arms = [];
    for (const [arm, stream, op, checked] of ARMS) {
      if (op === null && !(webcodecs && SETS[name] <= 10)) continue; // WebCodecs refuses 12-bit
      arms.push({ arm, op, checked, units: units(await get(`${WORK}/${name}/${stream}.av1`)) });
    }
    sets.push({ name, meta, bits: SETS[name], truth, arms });
  }
  return sets;
}

/** Decoded planes back in the stored sample order the truth hashes: interleaved R, G, B, cropped. */
function stored(meta, width, planes) {
  const { width: w, height: h, channels: ch } = meta;
  const wide = planes[0] instanceof Uint16Array;
  const out = wide ? new Uint16Array(w * h * ch) : new Uint8Array(w * h * ch);
  const src = ch === 3 ? [planes[2], planes[0], planes[1]] : [planes[0]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) out[(y * w + x) * ch + c] = src[c][y * width + x];
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
  for (const u of list) warm.decode(u);
  warm.close();
  const dec = await createDecoder(opened);
  const out = [];
  const t0 = performance.now();
  for (const u of list) out.push(dec.decode(u));
  const ms = (performance.now() - t0) / list.length;
  dec.close();
  return { ms, frames: out.map((f) => ({ width: f.width, height: f.height, planes: f.planes })) };
}

async function webcodecsRun(list) {
  const pass = async () => {
    const frames = [];
    const dec = new VideoDecoder({ output: (f) => frames.push(f), error: (e) => { throw e; } });
    dec.configure({ codec: "av01.1.00M.08", hardwareAcceleration: "prefer-software" });
    const t0 = performance.now();
    list.forEach((u, i) => dec.decode(new EncodedVideoChunk({ type: i ? "delta" : "key", timestamp: i, data: u })));
    await dec.flush();
    const ms = (performance.now() - t0) / list.length;
    dec.close();
    return { ms, frames };
  };
  (await pass()).frames.forEach((f) => f.close());
  const { ms, frames } = await pass();
  const out = [];
  for (const f of frames) {
    const { codedWidth: width, codedHeight: height } = f;
    const planar = new Uint8Array(f.allocationSize());
    const layout = await f.copyTo(planar);
    out.push({ width, height, format: f.format,
      planes: layout.map(({ offset, stride }) => {
        const p = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) p.set(planar.subarray(offset + y * stride, offset + y * stride + width), y * width);
        return p;
      }) });
    f.close();
  }
  return { ms, frames: out };
}

/** env: { dav1d: the module factory }. Rows: one per (set, arm). mutate "sample" flips a bit of each frame. */
export async function round(env, sets, r, mutate = "") {
  const rows = [];
  for (const s of order(sets, r)) {
    for (const a of order(s.arms, r)) {
      const { ms, frames } = a.op === null ? await webcodecsRun(a.units) : await dav1dRun(env.dav1d, a.op, a.units);
      let exact = null;
      if (a.checked) {
        exact = 0;
        for (const [i, f] of frames.entries()) {
          if (f.width < s.meta.width || f.height < s.meta.height) continue;
          if (mutate === "sample") f.planes[0][0] ^= 1;
          exact += (await sha256(stored(s.meta, f.width, f.planes))) === s.truth[i];
        }
      }
      rows.push({ set: s.name, arm: a.arm, round: r, ms, frames: frames.length, exact,
        size: `${frames[0]?.width}x${frames[0]?.height}` });
    }
  }
  return rows;
}
