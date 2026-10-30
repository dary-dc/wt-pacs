/** The product's page: metadata → fill → exactness → paint, with step, cine and a status line. client/README.md §The viewer */
import { DownloaderClient } from "/client/transport/consumer.js";
import { built } from "/client/decode/wasm-glue.js";
import { Painter } from "/client/paint/painter.js";
import { asPainted, Controller, FIT } from "/client/view/controller.js";
import { View, ViewWorker } from "/client/view/view.js";

const q = new URLSearchParams(location.search);
const canvas = document.getElementById("view");
const statusEl = document.getElementById("status");
const markEl = document.getElementById("mark");
const at = () => performance.timeOrigin + performance.now();

const lab = await Promise.all([globalThis.viewerLab, globalThis.viewerTransport])
  .then(([levers, transport]) => ({ ...levers, pinned: Boolean(levers.transport), transport }), (e) => ({ refused: e.message }));
// Where the frames are held and painted: on the page, or in the view worker. docs/adr/frame-path.md §3, *Built*
const where = q.get("view") ?? "page";
if (!lab.refused && !["page", "worker"].includes(where)) lab.refused = `refused: view ${JSON.stringify(where)} — page or worker`;
// Who writes the OPFS cache under `worker`, a lab lever; none by default, as main: docs/adr/frame-path.md §The core, assembled
const writer = lab.writer;
if (!lab.refused && writer !== undefined && !["store", "decoders", "view"].includes(writer)) lab.refused = `refused: writer ${JSON.stringify(writer)} — store, decoders or view`;
if (!lab.refused && writer === "decoders" && lab.opts?.pixels === "transfer") lab.refused = "refused: writer decoders with pixels transfer — the decoder would write a frame it has transferred";
if (lab.refused) {
  statusEl.textContent = `error: ${lab.refused}`;
  report({ error: lab.refused });
  throw new Error(lab.refused);
}
const meta = await globalThis.viewerMetadata;
const n = meta.frameCount;
const fillMode = q.get("fill") !== "0";
const transport = lab.transport;
// Absolute: the downloader's worker would resolve a relative URL against its own script.
const transportFile = new URL("/wt/dev-transport.json", location).href;

if (q.get("check")) {
  // A page that stops short still says why, and when.
  const stop = (why) => globalThis.__viewerResult || report({ error: why, received: progress.have, errors });
  addEventListener("error", (e) => stop(`uncaught: ${e.message}`));
  addEventListener("unhandledrejection", (e) => stop(`unhandled: ${e.reason?.message ?? e.reason}`));
  setTimeout(() => stop(`no result in ${q.get("deadline") ?? 120} s`), (q.get("deadline") ?? 120) * 1000);
}
let progress = { have: 0, total: n, seen: { exact: 0, inexact: 0, unchecked: 0, paths: {} }, fillMs: null };
let shown = null;
const errors = [];
let issuedAt = 0;
let rendererName = "starting";
let userVoi = null;
let pose = FIT;
let invert = false;
let view = null;

function fail(why) {
  errors.push(why);
  status();
}

/** What the controller tells the page, from here or from the view worker: never a frame. */
const on = {
  renderer: ({ renderer, error }) => ((rendererName = renderer ?? error), status()),
  progress: (p) => ((progress = p), status()),
  shown: (s) => {
    shown = s;
    markEl.className = s.exact === true ? "" : s.exact === false ? "inexact" : "unchecked";
    markEl.textContent = s.exact === false ? `NOT EXACT — ${s.reason ?? ""}` : s.exact === true ? "" : "unchecked";
    status();
  },
  failed: ({ scope, i, reason }) => fail(scope === "frame" ? `frame ${i}: ${reason}` : `${scope}: ${reason}`),
};
const emit = (type, event) => on[type](event);
const size = () => ({ width: canvas.clientWidth, height: canvas.clientHeight, dpr: self.devicePixelRatio || 1 });

/** The worker variant's check counts what reaches the page, and any pixel or port among it. */
const seen = q.get("check") && where === "worker" ? { messages: 0, pixels: 0, fromDownloader: 0 } : null;
const carriesPixels = (v) => v instanceof SharedArrayBuffer || v instanceof ArrayBuffer || ArrayBuffer.isView(v) || v instanceof MessagePort ||
  (typeof v === "object" && v !== null && Object.values(v).some(carriesPixels));
const watch = seen && ((data, from) => {
  seen.messages += 1;
  if (carriesPixels(data)) seen.pixels += 1;
  if (from === "downloader") seen.fromDownloader += 1;
});

let controller = null;
let worker = null;
if (where === "page") {
  const painter = new Painter(canvas, { onLost: (why) => fail(`painter: ${why}`) });
  painter.renderer.then((r) => emit("renderer", { renderer: r }), (e) => emit("renderer", { error: e.message }));
  controller = new Controller({ meta, fillMode, emit, size: size(), paint: (f, d, o) => painter.paint(asPainted(f.info), d, o) });
} else {
  worker = new ViewWorker(canvas, { meta, fillMode, size: size(), emit, watch, settlePaint: Boolean(lab.settlePaint), watchWrites: Boolean(q.get("check")) });
}

function status() {
  const soft = /swiftshader|llvmpipe|software|basic render/i.test(rendererName) ? " (software)" : "";
  const paths = Object.entries(progress.seen.paths).map(([p, k]) => `${p} ${k}`).join(", ") || "none yet";
  statusEl.textContent = [
    `frame ${(view?.current ?? 0) + 1} of ${n}`,
    `client ${transport.client}`,
    `view ${where}`,
    `received ${progress.have}, exact ${progress.seen.exact}, not exact ${progress.seen.inexact}, unchecked ${progress.seen.unchecked}`,
    `decoders: ${paths}`,
    `codec ${meta.codec ?? "htj2k"}`,
    `renderer ${rendererName}${soft}`,
    progress.fillMs !== null ? `fill ${Math.round(progress.fillMs)} ms` : fillMode ? "filling" : "on demand",
    ...errors.slice(-1).map((e) => `error: ${e}`),
  ].join(" · ");
}

const options = lab.opts;
const decoder = options.decoder ?? (meta.codec === "av1" ? { codec: "av1", ...(await built("dav1d")) } : await built("openjph"));
const digests = meta.digests?.algorithm === "xxh3-64" ? meta.digests.frames : undefined;
const all = [...Array(n).keys()];
// A lab harness slows the CPU from here: lab/viewer/levers.js.
await lab.started?.();
issuedAt = at();
const connectOpts = {
  transport: transport.module,
  ...(fillMode && { fill: all }),
  // The file follows a restarted server; a pair the lab named stays pinned.
  transportFile: lab.pinned ? undefined : transportFile,
  digests,
  ...options,
  decoder,
};
try {
  if (worker) await worker.connect(transport.wt_url, transport.cert_sha256, { ...connectOpts, writer }, issuedAt);
  else {
    controller.issuedAt = issuedAt;
    controller.client = await DownloaderClient.connect(transport.wt_url, transport.cert_sha256, {
      ...connectOpts,
      onFrame: (f) => controller.take(f),
      onError: ({ frameIndex, reason }) => controller.refused(frameIndex, reason),
    });
  }
} catch (e) {
  fail(`connect: ${e.message}`);
  report({ error: String(e.message) });
  lab.finished?.({ error: String(e.message) });
  throw e;
}

view = new View(n, controller ?? worker);
function show(i) {
  const step = view.show(i);
  status();
  return step;
}
if (!fillMode) show(0);

/** The lab's trace: from frame 0 on screen, one step every `everyMs`, each on time however the last went. lab/viewer/trace.js */
const stepped = [];
const until = (done) => new Promise((resolve) => {
  const poll = setInterval(() => done() && (clearInterval(poll), resolve()), 5);
});
const traced = lab.trace && (async () => {
  await until(() => shown?.i === 0 || errors.length);
  const t0 = performance.now();
  for (const [k, i] of lab.trace.steps(n).entries()) {
    await new Promise((r) => setTimeout(r, t0 + (k + 1) * lab.trace.everyMs - performance.now()));
    stepped.push({ i, at: at() });
    show(i);
  }
  // On demand a frame the reader left may never be asked, so the trace ends on its last step's frame.
  await until(() => shown?.i === stepped.at(-1)?.i || errors.length);
})();

const cineEl = document.getElementById("cine");
function toggleCine() {
  if (view.playing) view.pause();
  else view.play(1000 / (meta.frameTimeMs ?? (meta.cineRate ? 1000 / meta.cineRate : 100)));
  cineEl.textContent = view.playing ? "❚❚ cine" : "▶ cine";
}
cineEl.onclick = toggleCine;

const display = () => view.setDisplay({ window: userVoi, invert, pose });
function reset() {
  pose = FIT;
  invert = false;
  userVoi = null;
  display();
}
const zoom = (by) => ((pose = { ...pose, zoom: pose.zoom * by }), display());
const KEYS = {
  ArrowRight: () => show(view.current + 1), ArrowDown: () => show(view.current + 1), PageDown: () => show(view.current + 1),
  ArrowLeft: () => show(view.current - 1), ArrowUp: () => show(view.current - 1), PageUp: () => show(view.current - 1),
  Home: () => show(0), End: () => show(n - 1), " ": toggleCine, "+": () => zoom(1.25), "=": () => zoom(1.25), "-": () => zoom(0.8),
  r: () => ((pose = { ...pose, rotate: (pose.rotate + 90) % 360 }), display()),
  h: () => ((pose = { ...pose, flipH: !pose.flipH }), display()),
  v: () => ((pose = { ...pose, flipV: !pose.flipV }), display()),
  i: () => ((invert = !invert), display()),
  0: reset, Escape: reset,
};
addEventListener("keydown", (e) => {
  const k = KEYS[e.key];
  if (!k || e.target === cineEl) return;
  e.preventDefault();
  k();
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey) zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  else show(view.current + Math.sign(e.deltaY));
}, { passive: false });

/** A primary drag moves window and level, a secondary or shift drag pans: pointer events, so a touch drags too. */
let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  if (shown?.i !== view.current) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey, voi: shown.window, pose };
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (drag.pan) pose = { ...drag.pose, panX: drag.pose.panX + dx, panY: drag.pose.panY + dy };
  else {
    const k = Math.max(drag.voi.width, 1) / 256;
    userVoi = { ...drag.voi, width: Math.max(1, drag.voi.width + dx * k), center: drag.voi.center + dy * k };
  }
  display();
});
canvas.addEventListener("pointerup", () => (drag = null));
canvas.addEventListener("pointercancel", () => (drag = null));
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("resize", () => view.resize(size()));

function report(result) {
  globalThis.__viewerResult = result;
  // Read off the page in Chromium and off stdout in Firefox: client/viewer/check.mjs.
  if (q.get("check")) console.log(`viewer-result ${JSON.stringify(result)}`);
}

// Only the check and a lab harness read the fill's end, so a product page does not poll for it.
if (q.get("check") || lab.finished) {
  const giveUp = q.get("check") ? performance.now() + 60000 : Infinity;
  await new Promise((resolve) => {
    const poll = setInterval(() => {
      // The check judges a fill that stops short rather than waiting on it.
      if (progress.have + errors.length >= n || (!fillMode && progress.have) || performance.now() > giveUp) {
        clearInterval(poll);
        resolve();
      }
    }, 20);
  });
  await view.repaint();
  const check = worker ? (phase, args) => worker.check(phase, args)
    : async (phase, args) => (await import("/client/view/check.js"))[phase]({ controller, ...args });
  if (q.get("check")) (await import("/client/viewer/check-page.js")).run({ q, n, check, errors, report, rendererName, toggleCine,
    current: () => view.current, seen, close: () => (worker ?? controller.client).close() });
  else {
    await traced;
    for (const i of lab.steps ?? []) {
      stepped.push({ i, at: at() });
      show(i);
      await until(() => shown?.i === i || errors.length);
    }
    const { frames, firstShownMs, fillMs, stats } = await (worker ?? controller).ledger({ flip: q.get("mutate") === "sample" });
    lab.finished({ issuedAt, firstShownMs, fillMs, frames, errors, stats, stepped });
  }
}
