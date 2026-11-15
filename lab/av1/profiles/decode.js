// PROFILEDECODE, one cell in a worker of its own: an arm (H, L, S, R, W) on a decoder, its clocks and its link, every
// frame's samples kept for the checks. Arms, clocks and links: lab/av1/profiles/README.md §6.
import { parsePayload, units as splitUnits } from "../../../client/decode/av1-payload.js";
import { dav1d, fetchBytes, hex, openjph, range, sleepUntil, webcodecs } from "./decoders.js";
import { add, back, merge } from "./shared.js";

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
