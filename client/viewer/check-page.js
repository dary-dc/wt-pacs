/** The page check's in-page half: the protocol after the fill, and each readback against the CPU reference. client/viewer/check.mjs */
import { sha256Hex } from "/client/decode/wasm-glue.js";
import { Painter } from "/client/paint/painter.js";
import { paintReference } from "/client/paint/reference.js";

/** On demand, the page's own steps: three quick ones keep the newest ask alone, and a frame stepped to twice is asked once. */
async function stepsOnDemand(n, frames, show, client) {
  if (n < 3) return { raced: `a series of ${n} frames, under the 3 this needs` };
  const [a, b] = [n >> 1, n - 1];
  await Promise.all([show(a), show(b), show(a)]);
  const raced = frames.has(a) && !frames.has(b) ? "newest alone" : `held ${[...frames.keys()].join(", ")}`;
  const sent = [];
  client.requestExactFrame = (i) => (sent.push(i), Object.getPrototypeOf(client).requestExactFrame.call(client, i));
  client.cancel = () => (sent.push("cancel"), Object.getPrototypeOf(client).cancel.call(client));
  await Promise.all([show(b), show(b)]);
  delete client.requestExactFrame;
  delete client.cancel;
  return { raced, twice: sent.join(", "), asked: new Set([0, a, b]).size };
}

export async function run({ q, n, frames, seen, errors, client, painter, display, asPainted, all, report, fillMs, firstShownMs, rendererName, setView, current, toggleCine, show }) {
  const onDemand = q.get("fill") === "0" ? await stepsOnDemand(n, frames, show, client) : {};
  const out = { n, ...onDemand, received: frames.size, exact: seen.exact, inexact: seen.inexact, unchecked: seen.unchecked, paths: seen.paths,
    errors: [...errors], fillMs, firstShownMs, renderer: rendererName, status: document.getElementById("status").textContent,
    preloaded: performance.getEntriesByType("resource").filter((e) => e.initiatorType === "link").map((e) => new URL(e.name).pathname) };
  const step = async (name, fn) => {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: String(e?.message ?? e) };
    }
  };
  const press = (...keys) => keys.forEach((key) => dispatchEvent(new KeyboardEvent("keydown", { key })));
  await step("keys", async () => {
    press("End", "ArrowRight");
    const last = current();
    press("Home", "ArrowLeft");
    const ends = `${current()} ${last}`;
    const looks = () => display(current(), frames.get(current()).info);
    press("r", "h", "v");
    const { rotate, flipH, flipV } = looks().view;
    press("I");
    const inverted = looks().invert;
    press("i");
    const { modality } = await globalThis.viewerMetadata;
    return { ends, modality, turned: `${rotate} ${flipH} ${flipV}`, cased: `${inverted} ${looks().invert}` };
  });
  // The protocol: an ask of a delivered frame, a fill cancelled at once, an ask after the cancel.
  await step("askDelivered", async () => (await client.requestExactFrame(n >> 1)).info.exact);
  await step("cancelledFill", async () => {
    client.fill(all);
    await client.cancel();
    return "cancelled";
  });
  await step("askAfterCancel", async () => (await client.requestExactFrame(n - 1)).info.exact);

  if (q.get("cine")) {
    // The frame each completed paint drew, read off the painter: a slice the cine stepped past unpainted is missing here.
    const which = (pixels) => [...frames].find(([, f]) => f.info.pixels === pixels)[0];
    const painted = [];
    painter.paint = (frame, ...rest) => Painter.prototype.paint.call(painter, frame, ...rest)
      .then((r) => (painted.push({ i: which(frame.pixels), at: performance.now() }), r));
    await show(n - 1);
    painted.length = 0;
    // On demand each ask is held back three page frames, so the cine meets slices not yet here.
    if (q.get("fill") === "0") client.requestExactFrame = (i) => new Promise((r) => setTimeout(r, 50))
      .then(() => Object.getPrototypeOf(client).requestExactFrame.call(client, i));
    // The page's frames: of the paints that complete between two, the screen shows the last.
    const vsync = [];
    const tick = (t) => watching && (vsync.push(t), requestAnimationFrame(tick));
    let watching = true;
    requestAnimationFrame(tick);
    toggleCine();
    const t0 = performance.now();
    const swept = () => painted.findIndex((p) => p.i === n - 1);
    while (swept() < 0 && performance.now() - t0 < 30_000) await new Promise((r) => setTimeout(r, 5));
    toggleCine();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    watching = false;
    delete painter.paint;
    delete client.requestExactFrame;
    const sweep = painted.slice(0, swept() + 1);
    const shown = sweep.filter((p, k) => !(sweep[k + 1] && vsync.find((f) => f > p.at) > sweep[k + 1].at)).map((p) => p.i);
    const { frameTimeMs, cineRate } = await globalThis.viewerMetadata;
    out.cine = { painted: sweep.map((p) => p.i).join(" "), order: shown.join(" "), skipped: n - new Set(shown).size,
      inOrder: shown.every((i, k) => i === k), stepMs: (sweep.at(-1).at - sweep[0].at) / Math.max(1, sweep.length - 1),
      statedMs: frameTimeMs ?? (cineRate ? 1000 / cineRate : 100), frameMs: (vsync.at(-1) - vsync[0]) / (vsync.length - 1) };
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
    out.readbacks.push({ i, worst, size: `${w}x${h}`, sha256: await sha256Hex(pixels.slice()) });
  }
  out.stats = client.stats().exact;
  client.close();
  report(out);
}
