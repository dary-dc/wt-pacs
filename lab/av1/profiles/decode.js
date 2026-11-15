// PROFILEDECODE, one cell in a worker of its own: an arm (H, L, S, R, W) on a decoder, its clocks and its link, every
// frame's samples kept for the checks. Arms, clocks and links: lab/av1/profiles/README.md §6.
import { codecString, parsePayload, sequence, units as splitUnits } from "../../../client/decode/av1-payload.js";
import { built, instantiate } from "../../../client/decode/wasm-glue.js";
import { add, back, merge } from "./shared.js";

const fetchBytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());
const sleepUntil = (t) => new Promise((r) => setTimeout(r, Math.max(0, t - performance.now())));
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

async function hex(a) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(a.buffer, a.byteOffset, a.byteLength)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** dav1d-WASM, one thread, max_frame_delay 1 (dav1d_wrap.c); `fresh()` closes the decoder and opens a new one. */
async function dav1d() {
  const M = await instantiate(await built("dav1d"), "Dav1dModule");
  if (M._av1_open(1) < 0) throw new Error("dav1d_open");
  let ptr = 0;
  let cap = 0;
  return {
    async decode(u) {
      if (u.length > cap) {
        if (ptr) M._free(ptr);
        ptr = M._malloc((cap = u.length));
      }
      M.HEAPU8.set(u, ptr);
      const r = M._av1_decode(ptr, u.length);
      if (r < 0) throw new Error(`dav1d ${r}`);
      const [w, h, wide] = [M._av1_width(), M._av1_height(), M._av1_bits() > 8];
      const row = w * (wide ? 2 : 1);
      const src = M._av1_plane(0);
      const stride = Number(M._av1_stride(0));
      const out = new Uint8Array(row * h);
      for (let y = 0; y < h; y++) out.set(M.HEAPU8.subarray(src + y * stride, src + y * stride + row), y * row);
      return wide ? new Uint16Array(out.buffer) : out;
    },
    async flush() {},
    async fresh() {
      M._av1_close();
      if (M._av1_open(1) < 0) throw new Error("dav1d_open");
    },
  };
}

/** A unit with no frame by then is reported, not waited on. */
const STALL_MS = 20000;

/** WebCodecs as §6 configures it, one unit in flight, its luma copied out. */
async function webcodecs(first) {
  const config = { codec: codecString(sequence(first)), hardwareAcceleration: "prefer-software", optimizeForLatency: true };
  let vd;
  let wake = null;
  let got = null;
  let failed = null;
  let stamp = 0;
  const open = () => {
    vd = new VideoDecoder({ output: (f) => ((got = f), wake?.()), error: (e) => ((failed = e), wake?.()) });
    vd.configure(config);
  };
  open();
  return {
    async decode(u) {
      const out = new Promise((r) => (wake = r));
      vd.decode(new EncodedVideoChunk({ type: sequence(u) ? "key" : "delta", timestamp: stamp++, data: u }));
      let stall;
      await Promise.race([out, new Promise((_, no) => (stall = setTimeout(() => no(new Error(`no frame in ${STALL_MS} ms (${vd.state}, queue ${vd.decodeQueueSize})`)), STALL_MS)))]);
      clearTimeout(stall);
      wake = null;
      if (failed) throw failed;
      const f = got;
      got = null;
      const { width: w, height: h } = f.visibleRect;
      const wide = f.format.endsWith("P10");
      const buf = new Uint8Array(f.allocationSize());
      const [luma] = await f.copyTo(buf);
      f.close();
      const row = w * (wide ? 2 : 1);
      const px = new Uint8Array(row * h);
      for (let y = 0; y < h; y++) px.set(buf.subarray(luma.offset + y * luma.stride, luma.offset + y * luma.stride + row), y * row);
      return wide ? new Uint16Array(px.buffer) : px;
    },
    async flush() {
      await vd.flush();
      if (failed) throw failed;
    },
    async fresh() {
      if (vd.state !== "closed") vd.close();
      failed = null;
      open();
    },
  };
}

/** OpenJPH-WASM, one thread: a codestream in, its samples copied out. */
async function openjph() {
  const M = await instantiate(await built("openjph"), "OpenJPHModule");
  const d = new M.HTJ2KDecoder();
  return (u, wide) => {
    d.getEncodedBuffer(u.length).set(u);
    d.readHeader();
    d.decode();
    const b = d.getDecodedBuffer();
    return wide ? new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : b.slice();
  };
}

async function av1(o, first) {
  const d = o.decoder === "dav1d" ? await dav1d() : await webcodecs(first);
  await d.decode(first);
  await d.flush();
  await d.fresh();
  return d;
}

/**
 * Frames `idx` through the link: frame j's bytes are released bytes ÷ rate after frame j − 1's, and handed in, one
 * in flight, at the latest of that, the previous frame written and `before(i)` done (off the clock).
 * Each frame's [handed in, written].
 */
async function paced(idx, bytes, rate, on, before) {
  const times = [];
  let release = performance.now();
  let written = 0;
  for (const i of idx) {
    if (before) await before(i);
    if (rate) {
      release += (bytes(i).length * 8 * 1000) / rate;
      await sleepUntil(release);
    }
    const handed = Math.max(performance.now(), written);
    await on(i);
    written = performance.now();
    times.push([handed, written]);
  }
  return times;
}

const span = (t) => t.at(-1)[1] - t[0][0];
const each = (t) => t.map(([a, b]) => b - a);

async function cell(o) {
  const file = (dir, ext) => (i) => `${o.base}/${dir}/${String(i).padStart(3, "0")}.${ext}`;
  const load = async (url, idx) => {
    const m = new Map();
    await Promise.all(idx.map(async (i) => m.set(i, await fetchBytes(url(i)))));
    return m;
  };
  const series = o.clocks.includes("series");
  const mid = range(o.middle, o.middle + 16);
  const all = range(0, o.frames);
  const start = (k) => k - (k % o.g);
  const out = { clocks: {}, exact: [], lossy: [], ask: [], residuals: [] };

  if (o.arm === "H" || o.arm === "W") {
    const j2k = await openjph();
    const frames = await load(file("htj2k", "j2c"), series ? all : mid);
    j2k(frames.get(o.middle), true);
    let before = null;
    if (o.arm === "W") {
      // W: the asked slice's lossy frame decoded off the clock, its AV1 decoder alive beside OpenJPH.
      const units = await load(file(o.cell, "obu"), range(start(o.middle), o.middle + 16));
      const dec = await av1(o, units.get(start(o.middle)));
      for (const i of range(start(o.middle), o.middle)) await dec.decode(units.get(i));
      before = async (i) => out.lossy.push(await dec.decode(units.get(i)));
    }
    const on = (i) => out.exact.push(j2k(frames.get(i), true));
    out.clocks.frame = each(await paced(mid, (i) => frames.get(i), o.rate, on, before));
    if (series) out.clocks.series = span(await paced(all, (i) => frames.get(i), o.rate, on));
    return out;
  }

  if (o.arm === "L") {
    const payloads = await load(file("lossless", "av1"), series ? all : mid);
    const frames = new Map([...payloads].map(([i, p]) => [i, parsePayload(p)]));
    const { split, offset } = frames.get(o.middle);
    const pair = (i) => splitUnits(frames.get(i).frames[0], split);
    const top = await av1(o, pair(o.middle)[0]);
    const low = split ? await av1(o, pair(o.middle)[1]) : null;
    const on = async (i) => {
      const [t, l] = pair(i);
      out.exact.push(merge(await top.decode(t), low ? await low.decode(l) : null, split, offset));
    };
    out.clocks.frame = each(await paced(mid, (i) => payloads.get(i), o.rate, on));
    await top.flush();
    await low?.flush();
    if (series) {
      out.clocks.series = span(await paced(all, (i) => payloads.get(i), o.rate, on));
      await top.flush();
      await low?.flush();
    }
    return out;
  }

  const units = await load(file(o.cell, "obu"), all);
  const dec = await av1(o, units.get(0));
  for (const i of range(start(o.middle), o.middle)) await dec.decode(units.get(i));

  if (o.arm === "S") {
    let into = out.lossy;
    const on = async (i) => {
      const px = await dec.decode(units.get(i));
      into.push(px);
      back(px, o.shift);
    };
    out.clocks.frame = each(await paced(mid, (i) => units.get(i), o.rate, on));
    await dec.flush();
    out.clocks.ask = {};
    for (const k of o.asks) {
      await dec.fresh();
      into = [];
      try {
        const idx = range(start(k), k + 1);
        if (o.mutate === "drop" && o.g === 8 && idx.length > 1) idx.splice(1, 1);
        out.clocks.ask[k] = span(await paced(idx, (i) => units.get(i), o.rate, on));
        await dec.flush();
        out.ask.push([k, into.at(-1)]);
      } catch (e) {
        out.clocks.ask[k] = null;
        out.ask.push([k, null, String(e?.message ?? e)]);
      }
    }
    if (series) {
      await dec.fresh();
      into = out.series = [];
      out.clocks.series = span(await paced(all, (i) => units.get(i), o.rate, on));
      await dec.flush();
    }
    return out;
  }

  // R: the asked slice's lossy frame decoded off the clock, then its residual decoded and added on it.
  const j2k = await openjph();
  const res = await load(file(`${o.cell}/r`, "j2c"), series ? all : mid);
  const wide = o.residualBits > 8;
  const offset = o.residualOffset + o.offset + (o.mutate === "offset" ? 1 : 0);
  const lossy = new Map();
  const before = async (i) => {
    lossy.set(i, await dec.decode(units.get(i)));
    out.lossy.push(lossy.get(i));
  };
  const on = (i) => {
    const r = j2k(res.get(i), wide);
    out.residuals.push(r);
    out.exact.push(add(lossy.get(i), r, o.shift, offset));
    lossy.delete(i);
  };
  j2k(res.get(o.middle), wide);
  out.clocks.frame = each(await paced(mid, (i) => res.get(i), o.rate, on, before));
  await dec.flush();
  if (series) {
    await dec.fresh();
    for (const i of all) await before(i);
    out.clocks.series = span(await paced(all, (i) => res.get(i), o.rate, on));
  }
  return out;
}

onmessage = async ({ data: o }) => {
  try {
    const got = await cell(o);
    const hashes = async (list) => { const h = []; for (const v of list ?? []) h.push(await hex(v)); return h; };
    postMessage({
      clocks: got.clocks,
      exact: await hashes(got.exact),
      lossy: await hashes(got.lossy),
      ask: await Promise.all(got.ask.map(async ([k, v, error]) => [k, v ? await hex(v) : null, error])),
      series: await hashes(got.series),
      residuals: await hashes(got.residuals),
    });
  } catch (e) {
    postMessage({ error: String(e?.stack ?? e) });
  }
};
