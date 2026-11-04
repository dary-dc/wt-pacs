// The amended decode protocol (README.md §Profiles decode protocol, amended), one (series, rung) in a worker: every
// decoder alive beside the others, every byte in memory, the units run back to back in the order given.
import { dav1d, fetchBytes, hex, openjph, range, webcodecs } from "./decoders.js";
import { add, back } from "./shared.js";

const now = () => performance.now();

async function load(url, idx) {
  const m = new Map();
  await Promise.all(idx.map(async (i) => m.set(i, await fetchBytes(url(i)))));
  return m;
}

/** A decoder of `dec` opened off the clock and primed on the stream's first unit, as decode.js's av1() does. */
async function opened(dec, first) {
  const d = dec === "dav1d" ? await dav1d() : await webcodecs(first);
  await d.decode(first);
  await d.flush();
  await d.fresh();
  return d;
}

async function block(o) {
  const file = (dir, ext) => (i) => `${o.base}/${dir}/${String(i).padStart(3, "0")}.${ext}`;
  const mid = range(o.middle, o.middle + 16);
  const j2k = await openjph();
  const htj2k = await load(file("htj2k", "j2c"), mid);
  j2k(htj2k.get(o.middle), true);

  const streams = {};
  for (const [form, f] of Object.entries(o.forms)) {
    for (const [g, cell] of Object.entries(f.cells)) streams[`${form}/${g}`] = await load(file(cell, "obu"), range(0, o.middle + 16));
    f.residuals = await load(file(`${f.cells[16]}/r`, "j2c"), mid);
    // R's lossy frames, decoded once off the clock: R's clock is the residual's decode and the add only (§6).
    const units = streams[`${form}/16`];
    const d = await opened("dav1d", units.get(0));
    f.lossy = new Map();
    for (const i of range(o.middle - (o.middle % 16), o.middle + 16)) {
      const px = await d.decode(units.get(i));
      if (i >= o.middle) f.lossy.set(i, px);
    }
  }
  const precomputed = {};
  for (const [form, f] of Object.entries(o.forms)) {
    precomputed[form] = [];
    for (const [i, px] of f.lossy) precomputed[form].push([i, await hex(px)]);
  }
  const decoders = {};
  const decoder = async (dec, stream) => (decoders[`${dec}/${stream}`] ??= await opened(dec, streams[stream].get(0)));

  const out = [];
  for (const u of o.units) {
    const r = { name: u.name, frames: [] };
    const kept = [];
    const keep = (i, px) => kept.push([i, px]);
    try {
      if (u.arm === "H") {
        for (const i of mid) {
          const t = now();
          const px = j2k(htj2k.get(i), true);
          r.frames.push([i, t, now()]);
          keep(i, px);
        }
      } else if (u.arm === "R") {
        const f = o.forms[u.form];
        const wide = f.residualBits > 8;
        const offset = f.residualOffset + o.offset + (o.mutate === "offset" ? 1 : 0);
        for (const i of mid) {
          const t = now();
          const res = j2k(f.residuals.get(i), wide);
          const px = add(f.lossy.get(i), res, f.shift, offset);
          r.frames.push([i, t, now()]);
          keep(i, px);
          keep(-1 - i, res);
        }
      } else {
        const units = streams[`${u.form}/${u.g}`];
        const d = await decoder(u.dec, `${u.form}/${u.g}`);
        const shift = o.forms[u.form].shift;
        const timed = async (i) => {
          const t = now();
          const px = await d.decode(units.get(i));
          back(px, shift);
          r.frames.push([i, t, now()]);
          keep(i, px);
        };
        const start = (k) => k - (k % u.g);
        if (u.pattern === "order") {
          await d.fresh();
          for (const i of range(start(o.middle), o.middle)) await d.decode(units.get(i));
          for (const i of mid) await timed(i);
          await d.flush();
        } else if (u.pattern === "ask") {
          // §6's own ask, to check the jump against: a fresh decoder for each slice, its chain from the keyframe.
          r.asks = [];
          for (const k of u.asks) {
            await d.fresh();
            const t = now();
            for (const i of range(start(k), k + 1)) {
              const px = await d.decode(units.get(i));
              back(px, shift);
              keep(i, px);
            }
            r.asks.push([k, now() - t]);
            await d.flush();
          }
        } else {
          // Jump: a fresh decoder at each group the middle 16 touch, its keyframe up to the last asked slice in it.
          // The jump to k is written(k) − handed(start(k)): the one-in-flight chain up to k is a prefix of this one.
          for (const s of [...new Set(mid.map(start))]) {
            await d.fresh();
            let chain = range(s, Math.min(s + u.g, o.middle + 16));
            if (o.mutate === "drop" && u.g === 8 && chain.length > 1) chain = chain.filter((i) => i !== s + 1);
            for (const i of chain) await timed(i);
            await d.flush();
          }
        }
      }
    } catch (e) {
      r.error = String(e?.message ?? e);
    }
    // Hashed after the unit, off every clock; a residual is kept under −1 − its slice.
    r.hashes = [];
    for (const [i, px] of kept) r.hashes.push([i, await hex(px)]);
    out.push(r);
  }
  return { units: out, precomputed };
}

onmessage = async ({ data: o }) => {
  try {
    postMessage(await block(o));
  } catch (e) {
    postMessage({ error: String(e?.stack ?? e) });
  }
};
