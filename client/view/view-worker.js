/**
 * The view worker: the controller, the frame store and the paint module on one thread. The page sends intents and
 * hears events; decoded frames arrive here from the decoders and never reach it. docs/adr/frame-path.md §3, *Built*
 */
import { DownloaderClient } from "../transport/consumer.js";
import * as painter from "../paint/paint-worker.js";
import { asPainted, Controller } from "./controller.js";

/** ms: progress reaches the page at most this often, and at once when the last frame arrives. */
const PROGRESS_MS = 100;

let controller = null;
let downloader = null;
let lastPainted = null;
let progress = null;
let latest = null;
/** The lab's flag: a paint waits for the GPU before it reports, which here would block the store. */
let settle = false;

function emit(type, event) {
  if (type !== "progress") return void postMessage({ kind: "event", type, ...event });
  latest = event;
  if (event.have < event.total) return void (progress ??= setTimeout(flush, PROGRESS_MS));
  clearTimeout(progress);
  flush();
}

function flush() {
  progress = null;
  postMessage({ kind: "event", type: "progress", ...latest });
}

/** The store's frame objects are stable, so a frame painted again is the same object. */
function paint(frame, display, { read = false } = {}) {
  const same = frame === lastPainted;
  lastPainted = frame;
  const { width, height, dpr } = controller.size;
  return painter.paint({ frame: asPainted(frame.info), same, display, width: Math.round(width * dpr), height: Math.round(height * dpr), dpr, read, settle });
}

function start({ canvas, meta, fillMode, size, settlePaint }) {
  controller = new Controller({ meta, fillMode, paint, emit, size });
  settle = settlePaint;
  try {
    emit("renderer", { renderer: painter.start(canvas, (why) => emit("failed", { scope: "worker", reason: `painter: ${why}` })) });
  } catch (e) {
    emit("renderer", { error: e.message });
    emit("failed", { scope: "worker", reason: `painter: ${e.message}` });
  }
}

/** The store's intake is the consumer, which acks each frame; the store holds it, and the first want rides the start in place of the fill. */
async function connect({ port, url, certHash, opts, issuedAt }) {
  downloader = port;
  controller.issuedAt = issuedAt;
  controller.ascending = Boolean(opts.waitAhead);
  const want = controller.store.want(controller.want());
  controller.client = await DownloaderClient.connect(url, certHash, {
    ...opts,
    fill: undefined,
    want,
    port,
    onFrame: (f) => controller.take(f),
    onError: ({ frameIndex, reason }) => controller.refused(frameIndex, reason),
  });
  controller.store.downloader = controller.client;
}

const INTENTS = {
  start,
  show: ({ i }) => controller.show(i),
  display: ({ display }) => controller.setDisplay(display),
  size: ({ size }) => controller.resize(size),
  trigger: () => controller.client?.check(),
};

const CALLS = {
  connect,
  repaint: () => controller.repaint(),
  valueAt: ({ x, y }) => controller.valueAt(x, y),
  ledger: () => controller.ledger(),
  check: async ({ phase, args }) => (await import("./check.js"))[phase]({ controller, port: downloader, ...args }),
  close: () => controller.client.close(),
};

// Set after the paint module's own handler, which its import installed.
onmessage = async ({ data: m }) => {
  if (m.id === undefined) {
    return void (async () => INTENTS[m.kind](m))().catch((e) => emit("failed", { scope: "worker", reason: `${m.kind}: ${e?.message ?? e}` }));
  }
  try {
    postMessage({ kind: "reply", id: m.id, value: await CALLS[m.kind](m) });
  } catch (e) {
    postMessage({ kind: "reply", id: m.id, error: String(e?.message ?? e) });
  }
};
