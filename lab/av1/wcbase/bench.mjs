/**
 * A scalable payload's base through WebCodecs, by dropping the OBUs of spatial layers above 0, against
 * dav1d-WASM's base on row SVCDEC's path (the product's decode-av1.js, its `preview`). Every picture
 * goes to decoder.js's contract (av1-frame.js) and is hashed: a base against native dav1d's at
 * operating point 1, an exact frame against the encoder's input. lab/av1/wcbase/README.md
 */
import { order } from "../../order.mjs";
import { begin, end } from "../../../client/downloader/av1-frame.js";
import * as dav1d from "../../../client/downloader/decode-av1.js";

export const FRAMES = 18;
const WORK = "/lab/.av1-work/wcbase";
const BUILD = "/lab/.av1-build/out";

/** IVF frames grouped by timestamp: the encoder writes each spatial layer as its own IVF frame. */
function units(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const byPts = new Map();
  for (let at = view.getUint16(6, true); at + 12 <= buf.length; ) {
    const n = view.getUint32(at, true);
    const pts = Number(view.getBigUint64(at + 4, true));
    byPts.set(pts, [...(byPts.get(pts) ?? []), buf.subarray(at + 12, at + 12 + n)]);
    at += 12 + n;
  }
  return [...byPts.values()].map(concat);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
}

/** The unit without the OBUs of spatial layers above 0. `mutate`: "keep-top" keeps them, "drop-base" drops layer 0's too. */
export function baseOf(unit, mutate = "") {
  const kept = [];
  for (let at = 0; at < unit.length; ) {
    const head = unit[at];
    const ext = (head >> 2) & 1;
    if (!((head >> 1) & 1)) throw new Error("an OBU without a size field");
    let size = 0;
    let k = 0;
    for (let b = 0x80; b & 0x80; k++) {
      b = unit[at + 1 + ext + k];
      size += (b & 0x7f) * 2 ** (7 * k);
    }
    const next = at + 1 + ext + k + size;
    const spatial = ext ? (unit[at + 1] >> 3) & 3 : -1;
    const drop = mutate === "keep-top" ? false : mutate === "drop-base" ? spatial >= 0 : spatial > 0;
    if (!drop) kept.push(unit.subarray(at, next));
    at = next;
  }
  return concat(kept);
}

const FORMATS = { I420: [8, 1], I420P10: [10, 1], I444: [8, 3], I444P10: [10, 3] };

/** A VideoFrame as decode-av1-webcodecs.js reads it: grey 4:0:0 (neutral chroma) or GBR 4:4:4. */
async function read(frame) {
  const [bits, components] = FORMATS[frame.format] ?? [];
  if (!bits) throw new Error(`format ${frame.format}`);
  const buf = new ArrayBuffer(frame.allocationSize());
  const layout = await frame.copyTo(buf);
  const heap = bits > 8 ? new Uint16Array(buf) : new Uint8Array(buf);
  const shift = bits > 8 ? 1 : 0;
  const planes = layout.map(({ offset, stride }) => ({ heap, offset: offset >> shift, stride: stride >> shift }));
  const { width, height } = frame.visibleRect;
  if (components === 3 && frame.colorSpace.matrix) throw new Error(`4:4:4 with matrix ${frame.colorSpace.matrix}`);
  if (components === 1) {
    const grey = 1 << (bits - 1);
    for (const { offset, stride } of planes.slice(1)) {
      for (let y = 0; y < (height + 1) >> 1; y++) {
        for (let s = offset + y * stride, x = 0; x < (width + 1) >> 1; x++, s++) if (heap[s] !== grey) throw new Error("4:2:0 with chroma");
      }
    }
  }
  return { width, height, bits, planes: planes.slice(0, components) };
}

/**
 * One VideoDecoder. At G = 1 every unit is a key chunk and is flushed, so its picture is out before the
 * next is sent; a key chunk is required after a flush, so a longer group is sent with
 * `optimizeForLatency`, never flushed until its end, and each unit's picture awaited up to `waitMs`.
 */
function webcodecs(g1, waitMs = 250) {
  const got = new Map();
  let waiting = null;
  const vd = new VideoDecoder({
    output: (f) => { got.set(f.timestamp, f); waiting?.(); },
    error: () => {},
  });
  vd.configure({ codec: "av01.0.04M.10", hardwareAcceleration: "prefer-software", ...(g1 ? {} : { optimizeForLatency: true }) });
  const take = async (i) => {
    const f = got.get(i);
    got.delete(i);
    try {
      return end(begin(await read(f), {}));
    } finally {
      f.close();
    }
  };
  return {
    /** The unit's picture, or null if it is not out yet (only past G = 1). */
    async picture(unit, i) {
      vd.decode(new EncodedVideoChunk({ type: g1 || !i ? "key" : "delta", timestamp: i, data: unit }));
      if (g1) await vd.flush();
      else if (!got.has(i)) await new Promise((ok) => { waiting = () => got.has(i) && ok(); setTimeout(ok, waitMs); });
      if (g1 && got.size !== 1) throw new Error(`${got.size} frames out of unit ${i}`);
      return got.has(i) ? take(i) : null;
    },
    /** What was still held, in order, after the stream's last unit. */
    async rest() {
      await vd.flush();
      const out = [];
      for (const i of [...got.keys()].sort((a, b) => a - b)) out.push([i, await take(i)]);
      return out;
    },
    close: () => vd.state !== "closed" && vd.close(),
  };
}

/** A contract frame's samples in dav1d's plane order (Y = G, U = B, V = R), as make_streams.py hashed them. */
function planar(f) {
  const { width, height, componentCount: n, bitsPerSample } = f.info;
  const src = bitsPerSample > 8 ? new Uint16Array(f.sab) : new Uint8Array(f.sab);
  const out = new src.constructor(width * height * n);
  const from = n === 1 ? [0] : [1, 2, 0];
  from.forEach((c, p) => {
    for (let i = 0; i < width * height; i++) out[p * width * height + i] = src[i * n + c];
  });
  return new Uint8Array(out.buffer);
}

/** A frame's contract bytes cut to the source's size: the encoder takes even sizes, so an odd one is padded. */
function cropped(f, { width, height }) {
  const stride = f.byteCount / f.info.height;
  const row = (stride / f.info.width) * width;
  const all = new Uint8Array(f.sab);
  const out = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) out.set(all.subarray(y * stride, y * stride + row), y * row);
  return out;
}

async function sha256(bytes, mutate) {
  const copy = new Uint8Array(bytes);
  if (mutate === "sample") copy[0] ^= 1;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

let opened = null;

export async function prepare(names, codings, frames) {
  // Once a page: decode-av1.js keeps its input buffer across calls, in the module it opened.
  opened ??= dav1d.init({ glue: `${BUILD}/simd.js`, wasm: `${BUILD}/simd.wasm`, dir: BUILD });
  await opened;
  const sets = [];
  for (const name of names) {
    const m = await (await fetch(`${WORK}/${name}/manifest.json`)).json();
    for (const coding of codings) {
      const get = async (k) => units(new Uint8Array(await (await fetch(`${WORK}/${name}/${coding}.ivf_${k}.av1`)).arrayBuffer()));
      const n = Math.min(frames ?? m.frames, m.frames);
      sets.push({ m, coding, g1: coding.endsWith("g1"), whole: (await get(1)).slice(0, n), alone: (await get(0)).slice(0, n), ...m.codings[coding] });
    }
  }
  return sets;
}

/**
 * One arm over a set's units in order, fresh decoder, the first unit a keyframe. Returns the ms from each
 * unit sent to its picture in the contract, and the pictures' hashes. "wc-base" / "wc-all": WebCodecs fed
 * the filtered / whole units; "dav1d-base" / "dav1d-all": decode-av1.js fed whole units, to its preview /
 * to its exact frame.
 */
async function arm(name, s, mutate) {
  const ms = [];
  const base = [];
  const top = [];
  const errors = [];
  let late = 0;
  if (name.startsWith("wc")) {
    const wc = webcodecs(s.g1);
    const into = name === "wc-base" ? base : top;
    try {
      for (const [i, u] of s.whole.entries()) {
        const unit = name === "wc-base" ? baseOf(u, mutate) : u;
        const t0 = performance.now();
        const f = await wc.picture(unit, i);
        if (f) ms.push(performance.now() - t0);
        into[i] = f;
      }
      for (const [i, f] of await wc.rest()) (into[i] = f, late++);
    } catch (e) {
      errors.push(`${e.name}: ${e.message}`);
    }
    wc.close();
  } else {
    try {
      for (const [i, u] of s.whole.entries()) {
        let at = null;
        const t0 = performance.now();
        const f = dav1d.decodeFrame(u, { key: i === 0, gen: 0, index: i }, (p) => {
          at ??= performance.now();
          base.push(p);
        });
        ms.push((name === "dav1d-base" ? at : performance.now()) - t0);
        top.push(f);
      }
    } catch (e) {
      errors.push(`${e.name}: ${e.message}`);
    }
  }
  const exactBase = [];
  for (const [i, f] of base.entries()) {
    exactBase.push(f ? (await sha256(planar(f), mutate)) === s.base[i] && f.info.width === s.base_size[0] && f.info.height === s.base_size[1] : null);
  }
  const exactTop = [];
  for (const [i, f] of top.entries()) exactTop.push(f ? (await sha256(cropped(f, s.m), mutate)) === s.m.truth[i] : null);
  return { ms, base: exactBase, top: exactTop, late, errors };
}

const ARMS = ["wc-base", "wc-all", "dav1d-base", "dav1d-all"];

/** Rows, one per (set, coding, arm): the mean ms a frame and what was exact. `warm` runs each arm once untimed first. */
export async function round(sets, r, { mutate = "", warm = true, arms = ARMS } = {}) {
  const rows = [];
  for (const s of order(sets, r)) {
    const filtered = s.whole.map((u) => baseOf(u, mutate));
    const sameAsAlone = filtered.filter((u, i) => u.length === s.alone[i].length && u.every((b, k) => b === s.alone[i][k])).length;
    for (const a of order(arms, r)) {
      if (warm) await arm(a, s, mutate);
      const got = await arm(a, s, mutate);
      const mean = got.ms.length ? got.ms.reduce((x, y) => x + y, 0) / got.ms.length : null;
      rows.push({ set: s.m.name, coding: s.coding, arm: a, round: r, units: s.whole.length, ms: mean, sameAsAlone,
        late: got.late, bases: got.base.filter((x) => x !== null).length, baseExact: got.base.filter((x) => x === true).length,
        tops: got.top.filter((x) => x !== null).length, topExact: got.top.filter((x) => x === true).length, errors: got.errors });
    }
  }
  return rows;
}
