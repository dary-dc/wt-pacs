/** The page check's in-page half: the protocol after the fill, and each readback against the CPU reference. client/viewer/check.mjs */
import { paintReference } from "/client/paint/reference.js";

const hex = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

export async function run({ q, n, frames, seen, errors, client, painter, display, asPainted, all, report, fillMs, firstShownMs, rendererName, setView, current, toggleCine }) {
  const out = { n, received: frames.size, exact: seen.exact, inexact: seen.inexact, unchecked: seen.unchecked, paths: seen.paths,
    errors: [...errors], fillMs, firstShownMs, renderer: rendererName };
  const step = async (name, fn) => {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: String(e?.message ?? e) };
    }
  };
  // The protocol: an ask of a delivered frame, a fill cancelled at once, an ask after the cancel.
  await step("askDelivered", async () => (await client.requestExactFrame(n >> 1)).info.exact);
  await step("cancelledFill", async () => {
    client.fill(all);
    await client.cancel();
    return "cancelled";
  });
  await step("askAfterCancel", async () => (await client.requestExactFrame(n - 1)).info.exact);

  if (q.get("cine")) {
    const shown = new Set();
    toggleCine();
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      shown.add(current());
      await new Promise((r) => setTimeout(r, 5));
    }
    toggleCine();
    out.cine = shown.size;
  }

  // First, middle and last frame at zoom 1, read back and painted again on the CPU.
  setView({ fit: false, zoom: 1, panX: 0, panY: 0, rotate: 0, flipH: false, flipV: false });
  out.readbacks = [];
  for (const i of [...new Set([0, n >> 1, n - 1])]) {
    const f = frames.get(i);
    if (!f) {
      out.readbacks.push({ i, error: "never arrived" });
      continue;
    }
    const d = display(i, f.info);
    const { pixels } = await painter.paint(asPainted(f.info), d, { read: true });
    const dpr = devicePixelRatio;
    const w = Math.round(document.getElementById("view").clientWidth * dpr);
    const h = Math.round(document.getElementById("view").clientHeight * dpr);
    const { bits, components, signed } = f.info;
    const View = components === 3 || bits <= 8 ? (signed ? Int8Array : Uint8Array) : signed ? Int16Array : Uint16Array;
    const ref = paintReference({ ...asPainted(f.info), samples: new View(f.info.pixels) }, d, w, h, dpr);
    let worst = 0;
    for (let k = 0; k < ref.length; k++) worst = Math.max(worst, Math.abs(ref[k] - pixels[k]));
    out.readbacks.push({ i, worst, size: `${w}x${h}`, sha256: await hex(pixels.slice()) });
  }
  out.stats = client.stats().exact;
  client.close();
  report(out);
}
