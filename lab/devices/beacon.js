/** The round's client beacon: what one page load did, sent so that it never competes with the fill. lab/devices/README.md §The round */

export const BEACON_PATH = "/lab/beacon";

const epochMs = () => performance.timeOrigin + performance.now();
const sendBeacon = (body) => navigator.sendBeacon(BEACON_PATH, new Blob([body], { type: "application/json" }));
/** `null` once the server took the batch, else why not. */
export const postBatch = (body, ms) => fetch(BEACON_PATH, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(ms) })
  .then((r) => (r.ok ? null : `HTTP ${r.status}`), (e) => e?.name ?? String(e));
const DRAIN_MS = 5000;
// Bytes of one fallback beacon: Chrome refuses a keepalive body once 64 KiB are in flight. lab/devices/README.md §The round
const BEACON_BYTES = 16 * 1024;

/** `records` as JSON lists of at most `bytes` each; a record longer than that is a list of its own. */
export function chunks(records, bytes) {
  const out = [];
  let size = Infinity;
  for (const r of records) {
    const n = JSON.stringify(r).length + 1;
    if (size + n > bytes) out.push([]), (size = 1);
    out.at(-1).push(r);
    size += n;
  }
  return out;
}

/** One frame as the overlay shows it, from the controller's ledger. */
export const frameRow = ({ i, route, refusal, wireBytes, decodeMs, decoded }) =>
  ({ i, route, ...(refusal && { refusal }), kb: wireBytes === undefined ? null : +(wireBytes / 1024).toFixed(1), decodeMs: decodeMs ?? null, decodedAt: decoded ?? null });

/** Records of the load `load`, queued and sent as one JSON list: none before the fill ends, then at its end, each `flush` and the `drain`. */
export function recorder(load, { send = sendBeacon, post = postBatch, now = epochMs } = {}) {
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
    /** The load's last batch, awaited before the page leaves; on a failed post, beacons the quota takes. lab/devices/README.md §The round */
    async drain() {
      const records = queued.splice(0);
      const why = await post(JSON.stringify([...records, { ...load, kind: "drain", at: now(), path: "post", records: records.length }]), DRAIN_MS);
      if (why === null) return;
      send(JSON.stringify([{ ...load, kind: "drain", at: now(), path: "sendBeacon", why, records: records.length }]));
      for (const c of chunks(records, BEACON_BYTES)) if (!send(JSON.stringify(c))) break;
    },
    /** The fill's end, from viewer.js's `lab.finished`: the fill as §7's Second amendment defines it, lab/devices/README.md §The round. */
    filled({ error, fillMs = null, issuedAt, boot, frames = [], errors = [] }, meta) {
      const fillFrom = boot?.dial ?? null;
      const fillTo = error || fillMs === null ? null : issuedAt + fillMs;
      const routes = {};
      for (const f of frames) routes[f.route] = (routes[f.route] ?? 0) + 1;
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
