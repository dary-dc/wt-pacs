/** The phone run's client beacon: what one page load did, sent so that it never competes with the fill. lab/phone/README.md */

export const BEACON_PATH = "/lab/beacon";

const epochMs = () => performance.timeOrigin + performance.now();
const sendBeacon = (body) => navigator.sendBeacon(BEACON_PATH, new Blob([body], { type: "application/json" }));

/** One frame as the overlay shows it, from the controller's ledger. */
export const frameRow = ({ i, path, refusal, wireBytes, decodeMs }) =>
  ({ i, route: path, ...(refusal && { refusal }), kb: wireBytes === undefined ? null : +(wireBytes / 1024).toFixed(1), decodeMs: decodeMs ?? null });

/**
 * Records of the load `load` (its fields head every record), queued and handed to `send` as one JSON list:
 * nothing before the fill ends, then at its end, then whenever `flush` is called (the page hidden, or the runner).
 */
export function recorder(load, { send = sendBeacon, now = epochMs } = {}) {
  const queued = [];
  let filled = false;
  const flush = ({ leaving = false } = {}) => {
    if ((!filled && !leaving) || !queued.length) return;
    send(JSON.stringify(queued.splice(0)));
  };
  const record = (kind, fields) => queued.push({ ...load, kind, at: now(), ...fields });
  return {
    record,
    flush,
    /**
     * The fill's end, from viewer.js's `lab.finished`: each frame's route, bytes and decode time, and the fill as
     * docs/devices.md §7's Second amendment defines it, from the downloader's dial to the last frame stored, epoch ms.
     */
    filled({ error, fillMs = null, issuedAt, boot, frames = [], errors = [] }, meta) {
      const fillFrom = boot?.dial ?? null;
      const fillTo = error || fillMs === null ? null : issuedAt + fillMs;
      const routes = {};
      for (const f of frames) routes[f.path] = (routes[f.path] ?? 0) + 1;
      queued.unshift({ ...load, kind: "load", at: now(), exactSeries: meta.exactSeries ?? null, lossy: meta.lossy ?? null,
        frameCount: meta.frameCount, received: frames.length, fillFrom, fillTo,
        fillMs: fillFrom === null || fillTo === null ? null : fillTo - fillFrom, statusFillMs: error ? null : fillMs,
        routes, frames: frames.map(frameRow), errors: error ? [error, ...errors] : errors });
      filled = true;
      flush();
    },
  };
}

/** viewer.js's lab hook for `?beacon=<controller>`, `fields` added to every record. */
export function beaconHooks(q, fields = {}) {
  const r = install(q, fields);
  return { recorder: r, finished: async (ledger) => r.filled(ledger, await globalThis.viewerMetadata) };
}

/** The page's own wiring: labels, lossless presses and errors recorded as they happen; the queue sent on page hide. */
function install(q, fields) {
  const r = recorder({ load: crypto.randomUUID(), view: q.get("view") ?? "page", controller: q.get("beacon"), port: location.port, ...fields });
  addEventListener("error", (e) => r.record("error", { source: "onerror", message: String(e.message) }));
  addEventListener("unhandledrejection", (e) => r.record("error", { source: "unhandledrejection", message: String(e.reason?.message ?? e.reason) }));
  const consoleError = console.error;
  console.error = (...a) => (r.record("error", { source: "console.error", message: a.map(String).join(" ") }), consoleError.apply(console, a));
  addEventListener("pagehide", () => r.flush({ leaving: true }));
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && r.flush({ leaving: true }));
  const watch = () => {
    const quality = document.getElementById("quality");
    new MutationObserver(() => r.record("label", { quality: quality.hidden ? null : quality.className, text: quality.textContent }))
      .observe(quality, { attributes: true, attributeFilter: ["class", "hidden"] });
    document.getElementById("lossless").addEventListener("click", (e) => r.record("lossless", { text: e.currentTarget.textContent }), { capture: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch);
  else watch();
  return r;
}
