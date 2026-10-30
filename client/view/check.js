/** The viewer check's half that runs beside the controller, on the page or in the view worker. client/viewer/check.mjs */
import { sha256Hex } from "../decode/wasm-glue.js";
import { paintReference } from "../paint/reference.js";
import { asPainted, samplesOf } from "./controller.js";

/** What goes to the downloader until `undo`: an ask as its index, anything else by its kind. */
function listen(controller, port) {
  const sent = [];
  if (port) {
    port.postMessage = (m, t) => (sent.push(m.kind === "ask" ? m.index : m.kind), MessagePort.prototype.postMessage.call(port, m, t));
    return { sent, undo: () => delete port.postMessage };
  }
  // On the page the port is the downloader's worker, inside the consumer: its asks and cancels are heard instead.
  const client = controller.client;
  const own = (k, label) => (client[k] = (...a) => (sent.push(label(...a)), Object.getPrototypeOf(client)[k].apply(client, a)));
  own("requestExactFrame", (i) => i);
  own("cancel", () => "cancel");
  own("fill", () => "fill");
  return { sent, undo: () => ["requestExactFrame", "cancel", "fill"].forEach((k) => delete client[k]) };
}

/** On demand, the controller's own steps: three quick ones keep the newest ask alone, and a frame stepped to twice is asked once. */
async function stepsOnDemand(n, controller, port) {
  if (n < 3) return { raced: `a series of ${n} frames, under the 3 this needs` };
  const { store } = controller;
  const [a, b] = [n >> 1, n - 1];
  await Promise.all([controller.show(a), controller.show(b), controller.show(a)]);
  const raced = store.has(a) && !store.has(b) ? "newest alone" : `held ${[...store.keys()].join(", ")}`;
  const heard = listen(controller, port);
  await Promise.all([controller.show(b), controller.show(b)]);
  heard.undo();
  return { raced, twice: heard.sent.filter((k) => k !== "ack").join(", "), asked: new Set([0, a, b]).size };
}

/** A held frame stepped to is painted, and nothing is sent to the downloader. */
async function heldStep(controller, port) {
  const held = [...controller.store.keys()].find((i) => i !== controller.current);
  if (held === undefined) return "no second frame held";
  // A step's own paint may still be in flight on the page.
  await controller.repaint();
  const paints = controller.paints;
  const heard = listen(controller, port);
  await controller.show(held);
  heard.undo();
  return `painted ${controller.paints - paints}, sent ${heard.sent.join(", ") || "nothing"}`;
}

/** A window change paints the current frame again from the texture it holds: no upload, nothing sent. */
async function windowStep(controller, port) {
  const f = controller.store.get(controller.current);
  if (!f) return "no frame held";
  const { voi } = controller.display(controller.current, f.info);
  const paints = controller.paints;
  const heard = listen(controller, port);
  await controller.setDisplay({ window: { ...voi, width: Math.max(1, voi.width / 2) } });
  heard.undo();
  const said = `painted ${controller.paints - paints}, uploaded ${controller.lastPaint?.uploaded}, sent ${heard.sent.join(", ") || "nothing"}`;
  await controller.setDisplay({ window: null });
  return said;
}

/** The protocol: the steps, an ask of a delivered frame, a fill cancelled at once, an ask after the cancel. */
export async function protocol({ controller, port, n, onDemand }) {
  await controller.repaint();
  const client = controller.client;
  const out = onDemand ? await stepsOnDemand(n, controller, port) : {};
  out.heldStep = await heldStep(controller, port);
  out.windowStep = await windowStep(controller, port);
  Object.assign(out, { received: controller.received, exact: controller.seen.exact, inexact: controller.seen.inexact,
    unchecked: controller.seen.unchecked, paths: controller.seen.paths, fillMs: controller.fillMs, firstShownMs: controller.firstShownMs });
  const step = async (name, fn) => {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: String(e?.message ?? e) };
    }
  };
  await step("askDelivered", async () => (await client.requestExactFrame(n >> 1)).info.exact);
  await step("cancelledFill", async () => {
    client.fill([...Array(n).keys()]);
    await client.cancel();
    return "cancelled";
  });
  await step("askAfterCancel", async () => (await client.requestExactFrame(n - 1)).info.exact);
  return out;
}

/** First, middle and last frame at zoom 1, read back and painted again on the CPU; the last once more under another window. */
export async function readbacks({ controller, n }) {
  await controller.setDisplay({ pose: { fit: false, zoom: 1, panX: 0, panY: 0, rotate: 0, flipH: false, flipV: false } });
  const { width, height, dpr } = controller.size;
  const [w, h] = [Math.round(width * dpr), Math.round(height * dpr)];
  const out = [];
  const read = async (i, d, more = {}) => {
    const f = controller.store.get(i);
    const { pixels, uploaded } = await controller.paint(f, d, { read: true });
    const ref = paintReference({ ...asPainted(f.info), samples: samplesOf(f.info) }, d, w, h, dpr);
    let worst = 0;
    for (let k = 0; k < ref.length; k++) worst = Math.max(worst, Math.abs(ref[k] - pixels[k]));
    out.push({ i, worst, size: `${w}x${h}`, sha256: await sha256Hex(pixels.slice()), ...more, ...(more.window && { uploaded }) });
  };
  for (const i of [...new Set([0, n >> 1, n - 1])]) {
    if (!controller.store.has(i)) out.push({ i, error: "never arrived" });
    else await read(i, controller.display(i, controller.store.get(i).info));
  }
  const last = controller.store.get(n - 1);
  if (last) {
    const d = controller.display(n - 1, last.info);
    await read(n - 1, { ...d, voi: { ...d.voi, center: d.voi.center + d.voi.width / 4, width: Math.max(1, d.voi.width / 2) } }, { window: true });
  }
  return { readbacks: out, stats: controller.client.stats().exact };
}
