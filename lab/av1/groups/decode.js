// One timed stream in a worker of its own (docs/av1/groups.md §6.5): a fresh decoder opened off the clock, then the
// stream's units in order, one in flight; per unit, ms from handed in to its shown frame copied out, hashed after.
import { dav1d, fetchBytes, hex, webcodecs } from "../profiles/decoders.js";

onmessage = async ({ data: o }) => {
  try {
    const blob = await fetchBytes(o.file);
    const units = [];
    let at = 0;
    for (const n of o.sizes) units.push(blob.subarray(at, (at += n)));
    const d = o.decoder === "dav1d" ? await dav1d() : await webcodecs(units[0]);
    await d.decode(units[0]);
    await d.flush();
    await d.fresh();
    const ms = [];
    const hashes = [];
    for (const u of units) {
      const t0 = performance.now();
      const px = await d.decode(u);
      ms.push(performance.now() - t0);
      hashes.push(await hex(px));
    }
    postMessage({ ms, hashes });
  } catch (e) {
    postMessage({ error: String(e?.message ?? e) });
  }
};
