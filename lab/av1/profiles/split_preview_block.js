// Row SPLITPREVIEWB's decode (split-preview-b.md §Stage 3), one (series, anchor) in a worker: both forms' streams in
// memory, one WebCodecs decoder per stream, the units run back to back in the order given.
import { hex, range, webcodecs } from "./decoders.js";
import { back } from "./shared.js";

const now = () => performance.now();

async function block(o) {
  const mid = range(o.middle, o.middle + 16);
  const streams = {};
  for (const [key, dir] of Object.entries(o.streams)) {
    const m = new Map();
    await Promise.all(range(0, o.middle + 16).map(async (i) =>
      m.set(i, new Uint8Array(await (await fetch(`${o.base}/${dir}/${String(i).padStart(3, "0")}.obu`)).arrayBuffer()))));
    streams[key] = m;
  }
  const decoders = {};
  const decoder = async (key) => {
    if (!decoders[key]) {
      const d = await webcodecs(streams[key].get(0));
      await d.decode(streams[key].get(0));
      await d.flush();
      decoders[key] = d;
    }
    return decoders[key];
  };

  const out = [];
  for (const u of o.units) {
    const r = { name: u.name, frames: [] };
    const kept = [];
    try {
      const units = streams[u.stream];
      const d = await decoder(u.stream);
      const start = (k) => k - (k % u.g);
      await d.fresh();
      for (const i of range(start(o.middle), o.middle)) await d.decode(units.get(i));
      for (const i of mid) {
        const t = now();
        const px = back(await d.decode(units.get(i)), u.shift);
        r.frames.push([i, t, now()]);
        kept.push([i, px]);
      }
      await d.flush();
    } catch (e) {
      r.error = String(e?.message ?? e);
    }
    r.hashes = [];
    for (const [i, px] of kept) r.hashes.push([i, await hex(px)]);
    out.push(r);
  }
  return { units: out };
}

onmessage = async ({ data: o }) => {
  try {
    postMessage(await block(o));
  } catch (e) {
    postMessage({ error: String(e?.stack ?? e) });
  }
};
