/**
 * The delivery rig's FIT arm in the viewer, behind the lab's levers: the fit worker where the metadata names a level,
 * then after the fill the window read-back and the zoom past the fit; and C1's ask → last byte.
 * docs/client/evidence/delivery-comparison.md A2.2, A2.4, A2.5, A2.8
 */
import { FIT } from "../../client/view/controller.js";
import { tableShape, windowTable } from "../../client/paint/voi.js";

/** The shipped OpenJPH package, which decodes a resolution level; the product's build decodes whole frames only. */
const PACKAGE = { glue: "/client/decode/wasm/vendor/openjph/openjphjs.js", wasm: "/client/decode/wasm/vendor/openjph/openjphjs.wasm", dir: "/client/decode/wasm/vendor/openjph" };

/** FIT's decoder worker and its config where the metadata names a fit level, else null: its levels by the package, its whole frames by the product's build. */
export async function fitDecoder(meta, mutate) {
  if (!meta.fit) return null;
  const { built } = await import("../../client/decode/wasm-glue.js");
  return { worker: new URL("./fit-decoder.js", import.meta.url).href, decoder: { ...(await built("openjph")), levelPackage: PACKAGE, fit: { ...meta.fit, mutate } } };
}

/** `?fit=1`: a series whose metadata names a fit level is decoded by FIT's worker. */
export async function fitLevers(lab, q) {
  const fit = await fitDecoder(await (await fetch(lab.metadata ?? "/series/metadata")).json(), q.get("mutate") ?? undefined);
  if (fit) Object.assign(lab.opts, { decoderWorker: fit.worker, decoder: fit.decoder });
  return lab;
}

const epochMs = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A2.2: the narrow window, the series' own default at an eighth of its width. */
const NARROW = 8;
/** A2.5: the zoom past the fit. */
const ZOOM = 2;

/**
 * A2.2: the frame on screen under a narrow window, its window pass read back at the frame's own size, against voi.js's
 * table looked up on the frame's samples; `canvas` (a mutant) reads the placed canvas instead. Why not equal, or null.
 */
export async function windowReadFailure(controller, record, { canvas = false } = {}) {
  const i = controller.current;
  const f = controller.store.get(i);
  const voi = controller.display(i, f.info).voi;
  await controller.setDisplay({ window: { ...voi, width: voi.width / NARROW } });
  const d = controller.display(i, f.info);
  const { pixels } = await controller.paint(f, d, canvas ? { read: true } : { picture: true });
  const frame = { bits: f.info.bits, signed: f.info.signed, components: f.info.components, cutShift: f.info.cutShift };
  const table = windowTable(frame, d);
  const { offset } = tableShape(frame);
  const View = f.info.bits > 8 ? Uint16Array : Uint8Array;
  const samples = new View(f.info.pixels, 0, f.info.width * f.info.height);
  let unequal = pixels.length === samples.length * 4 ? -1 : 0;
  for (let k = 0; unequal < 0 && k < samples.length; k++) {
    const code = table[samples[k] + offset];
    if (pixels[4 * k] !== code || pixels[4 * k + 1] !== code || pixels[4 * k + 2] !== code || pixels[4 * k + 3] !== 255) unequal = k;
  }
  record("windowRead", { i, width: f.info.width, height: f.info.height, window: d.voi, read: canvas ? "canvas" : "picture", bytes: pixels.length, unequal });
  await controller.setDisplay({ window: null });
  if (unequal < 0) return null;
  return `window read-back of frame ${i}: ${pixels.length === samples.length * 4 ? `sample ${unequal} unequal to voi.js's table` : `${pixels.length} bytes for ${samples.length} samples`}`;
}

/**
 * A2.5: `afterMs` past the fill, the frame on screen zoomed past the fit; where the fit is a level, its rest asked on
 * the fill's own session and the whole frame painted once its digest matched. The zoom's record, and why it failed.
 */
export async function zoomFailure(controller, meta, record, { afterMs, filledAt }) {
  await sleep(Math.max(0, filledAt + afterMs - epochMs()));
  const i = controller.current;
  const paints = [];
  const paint = controller.paint;
  controller.paint = async (f, d, o) => {
    const r = await paint(f, d, o);
    paints.push({ width: f.info.width, exact: f.info.exact, drawn: r?.drawn ?? epochMs() });
    return r;
  };
  let ask = null;
  if (meta.fit) {
    const client = controller.client;
    controller.exactSource = { requestFrame: (k) => client.requestFrame(meta.fit.frames + k).then((frame) => ((ask = frame.timing), frame)) };
  }
  const at = epochMs();
  await controller.setDisplay({ pose: { ...FIT, zoom: ZOOM } });
  if (meta.fit) await controller.showExact();
  controller.paint = paint;
  const whole = paints.find((p) => p.width === meta.width && p.exact === true);
  record("zoom", { i, level: meta.fit?.level ?? 0, ms: whole ? whole.drawn - at : null, askLastByte: ask && ask.lastChunkMs - ask.askMs, paints: paints.length });
  return whole ? null : `FIT zoom on frame ${i}: no whole frame painted with its digest matched (${paints.map((p) => `${p.width} ${p.exact}`).join(", ") || "no paint"})`;
}

/** A2.4: C1's exact frame, its ask to its last byte, from the frame the exact series delivers. */
export async function recordAskLastByte(controller, record) {
  while (!controller.exactSource) await sleep(20);
  const source = controller.exactSource;
  const ask = source.requestFrame.bind(source);
  source.requestFrame = (k) => ask(k).then((frame) => (record("askLastByte", { i: k, ms: frame.timing.lastChunkMs - frame.timing.askMs }), frame));
}

/** A FIT load after its fill: the window read-back on the picture the fill left, then the zoom. Why it failed, or null. */
export async function fitFailure(q, record, { controller }, meta, filledAt) {
  const mutate = q.get("mutate");
  return (await windowReadFailure(controller, record, { canvas: mutate === "canvas-readback" }))
    ?? zoomFailure(controller, meta, record, { afterMs: Number(q.get("zoomAfter") ?? 1000), filledAt });
}
