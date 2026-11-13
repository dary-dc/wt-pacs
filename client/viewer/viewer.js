/** The product's page: metadata → fill → exactness → paint, with step, cine and a status line. client/README.md §The viewer */
import { DownloaderClient } from "/client/transport/consumer.js";
import { built } from "/client/decode/wasm-glue.js";
import { Painter } from "/client/paint/painter.js";

const q = new URLSearchParams(location.search);
const canvas = document.getElementById("view");
const statusEl = document.getElementById("status");
const markEl = document.getElementById("mark");
const at = () => performance.timeOrigin + performance.now();

const lab = await Promise.all([globalThis.viewerLab, globalThis.viewerTransport])
  .then(([levers, transport]) => ({ ...levers, pinned: Boolean(levers.transport), transport }), (e) => ({ refused: e.message }));
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
  const stop = (why) => globalThis.__viewerResult || report({ error: why, received: frames.size, errors });
  addEventListener("error", (e) => stop(`uncaught: ${e.message}`));
  addEventListener("unhandledrejection", (e) => stop(`unhandled: ${e.reason?.message ?? e.reason}`));
  setTimeout(() => stop(`no result in ${q.get("deadline") ?? 120} s`), (q.get("deadline") ?? 120) * 1000);
}
const frames = new Map();
const seen = { exact: 0, inexact: 0, unchecked: 0, paths: {} };
const errors = [];
let current = 0;
let issuedAt = 0;
let fillMs = null;
let firstShownMs = null;
let rendererName = "starting";
let userVoi = null;
const view = () => ({ fit: true, zoom: 1, panX: 0, panY: 0, rotate: 0, flipH: false, flipV: false });
let pose = view();
let invert = false;

const painter = new Painter(canvas, { onLost: (why) => fail(`painter: ${why}`) });
painter.renderer.then((r) => ((rendererName = r), status()), () => {});

function fail(why) {
  errors.push(why);
  status();
}

/** The frame's display: its own rescale and window where the metadata varies them, the user's window over both. */
function display(i, info) {
  const per = meta.perFrame ?? {};
  const rescale = per.rescale?.[i] ?? meta.rescale ?? { slope: 1, intercept: 0 };
  const w = per.window?.[i] ?? meta.window;
  let voi = userVoi ?? (w && { center: w.center[0], width: w.width[0], function: w.function ?? "LINEAR" });
  if (!voi) {
    // No window in the metadata: the frame's decoded range, through its rescale.
    const lo = info.min * rescale.slope + rescale.intercept;
    const hi = info.max * rescale.slope + rescale.intercept;
    voi = { center: (lo + hi) / 2, width: Math.max(1, Math.abs(hi - lo) + 1), function: "LINEAR" };
  }
  const photometric = meta.photometric ?? (info.components === 3 ? "RGB" : "MONOCHROME2");
  return { photometric, rescale, voi, invert, view: pose };
}

const asPainted = (info) => ({ pixels: info.pixels, width: info.width, height: info.height, bits: info.bits, components: info.components, signed: info.signed });

let painting = null;
let dirty = false;
/** Paints the current frame, coalescing requests: at most one paint in flight and one waiting. */
function repaint() {
  dirty = true;
  if (painting) return painting;
  painting = (async () => {
    while (dirty) {
      dirty = false;
      const f = frames.get(current);
      if (!f) continue;
      markEl.className = f.info.exact === true ? "" : f.info.exact === false ? "inexact" : "unchecked";
      markEl.textContent = f.info.exact === false ? `NOT EXACT — ${f.info.reason ?? ""}` : f.info.exact === true ? "" : "unchecked";
      try {
        await painter.paint(asPainted(f.info), display(current, f.info));
        if (firstShownMs === null && f.info.exact === true) firstShownMs = at() - issuedAt;
      } catch (e) {
        fail(`paint: ${e.message}`);
      }
    }
    painting = null;
    status();
  })();
  return painting;
}

function take(f) {
  if (frames.has(f.frameIndex)) return;
  frames.set(f.frameIndex, { info: f.info, arrived: at() });
  const e = f.info.exact;
  seen[e === true ? "exact" : e === false ? "inexact" : "unchecked"]++;
  if (f.info.path) seen.paths[f.info.path] = (seen.paths[f.info.path] ?? 0) + 1;
  if (fillMode && fillMs === null && frames.size === n) fillMs = at() - issuedAt;
  if (f.frameIndex === current) repaint();
  status();
}

function status() {
  const soft = /swiftshader|llvmpipe|software|basic render/i.test(rendererName) ? " (software)" : "";
  const paths = Object.entries(seen.paths).map(([p, k]) => `${p} ${k}`).join(", ") || "none yet";
  statusEl.textContent = [
    `frame ${current + 1} of ${n}`,
    `client ${transport.client}`,
    `received ${frames.size}, exact ${seen.exact}, not exact ${seen.inexact}, unchecked ${seen.unchecked}`,
    `decoders: ${paths}`,
    `codec ${meta.codec ?? "htj2k"}`,
    `renderer ${rendererName}${soft}`,
    fillMs !== null ? `fill ${Math.round(fillMs)} ms` : fillMode ? "filling" : "on demand",
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
const client = await DownloaderClient.connect(transport.wt_url, transport.cert_sha256, {
  transport: transport.module,
  ...(fillMode && { fill: all }),
  // The file follows a restarted server; a pair the lab named stays pinned.
  transportFile: lab.pinned ? undefined : transportFile,
  digests,
  ...options,
  decoder,
  onFrame: take,
  onError: ({ frameIndex, reason }) => fail(`frame ${frameIndex}: ${reason}`),
}).catch((e) => {
  fail(`connect: ${e.message}`);
  report({ error: String(e.message) });
  lab.finished?.({ error: String(e.message) });
  throw e;
});

/** Each pending ask's frame and the step that made it; a cancel empties it. */
const asks = new Map();
let steps = 0;
/** A step: its frame painted from memory, or asked — ahead of the fill, and in on-demand mode the newest ask alone. */
async function show(i) {
  current = Math.min(Math.max(i, 0), n - 1);
  status();
  if (frames.has(current)) return repaint();
  const want = current;
  if (asks.has(want)) return;
  const step = ++steps;
  if (!fillMode && asks.size) {
    asks.clear();
    await client.cancel();
    if (step !== steps) return;
  }
  asks.set(want, step);
  try {
    take(await client.requestExactFrame(want));
  } catch (e) {
    if (asks.get(want) === step) fail(`frame ${want}: ${e.message}`);
  } finally {
    if (asks.get(want) === step) asks.delete(want);
  }
}
if (!fillMode) show(0);

let cine = null;
const cineEl = document.getElementById("cine");
function toggleCine() {
  if (cine) {
    clearInterval(cine);
    cine = null;
  } else {
    const ms = meta.frameTimeMs ?? (meta.cineRate ? 1000 / meta.cineRate : 100);
    cine = setInterval(() => show((current + 1) % n), ms);
  }
  cineEl.textContent = cine ? "❚❚ cine" : "▶ cine";
}
cineEl.onclick = toggleCine;

function reset() {
  pose = view();
  invert = false;
  userVoi = null;
  repaint();
}
const zoom = (by) => ((pose = { ...pose, zoom: pose.zoom * by }), repaint());
const KEYS = {
  ArrowRight: () => show(current + 1), ArrowDown: () => show(current + 1), PageDown: () => show(current + 1),
  ArrowLeft: () => show(current - 1), ArrowUp: () => show(current - 1), PageUp: () => show(current - 1),
  Home: () => show(0), End: () => show(n - 1), " ": toggleCine, "+": () => zoom(1.25), "=": () => zoom(1.25), "-": () => zoom(0.8),
  ...(["DX", "CR"].includes(meta.modality) && {
    r: () => ((pose = { ...pose, rotate: (pose.rotate + 90) % 360 }), repaint()),
    h: () => ((pose = { ...pose, flipH: !pose.flipH }), repaint()),
    v: () => ((pose = { ...pose, flipV: !pose.flipV }), repaint()),
  }),
  i: () => ((invert = !invert), repaint()),
  0: reset, Escape: reset,
};
addEventListener("keydown", (e) => {
  const k = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
  if (!k || e.target === cineEl) return;
  e.preventDefault();
  k();
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey) zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  else show(current + Math.sign(e.deltaY));
}, { passive: false });

/** A primary drag moves window and level, a secondary or shift drag pans: pointer events, so a touch drags too. */
let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  const f = frames.get(current);
  if (!f) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey, voi: display(current, f.info).voi, pose };
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
  repaint();
});
canvas.addEventListener("pointerup", () => (drag = null));
canvas.addEventListener("pointercancel", () => (drag = null));
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("resize", () => repaint());

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
      if (frames.size + errors.length >= n || (!fillMode && frames.size) || performance.now() > giveUp) {
        clearInterval(poll);
        resolve();
      }
    }, 20);
  });
  await repaint();
  if (q.get("check")) (await import("/client/viewer/check-page.js")).run({ q, n, frames, seen, errors, client, painter, display, asPainted, all, report, fillMs, firstShownMs, rendererName: await painter.renderer.catch((e) => e.message), setView: (v) => (pose = v), current: () => current, toggleCine, show });
  else lab.finished({ issuedAt, firstShownMs, frames, errors, stats: client.stats() });
}
