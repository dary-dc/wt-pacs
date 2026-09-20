/**
 * One arm, one fresh session, against the real server, decode off. Two arms:
 *   after  connect(), wait for `started`, then fill() — what the page did before
 *   start  the fill handed to connect(), so it rides in the `start` message
 * `?block=<ms>` holds the main thread for that long, `?at=call` inside connect()'s own task and
 * `?at=<ms>` that far after it — a viewer's SDK boot task, before or after its worker is alive.
 * Numbers go to window.__wtpacsResult; run.mjs interleaves the arms and README.md reads them.
 */
import { DownloaderClient } from "/client/downloader/consumer.js";

const q = new URLSearchParams(location.search);
const arm = q.get("arm") || "after";
const FILL = Number(q.get("fill") || 20);
const BLOCK_MS = Number(q.get("block") || 0);
const BLOCK_AT = q.get("at") || "call";

const logEl = document.getElementById("log");
const log = (s) => { logEl.textContent += s + "\n"; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hold(ms) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    /* the SDK's boot task, as far as this worker is concerned */
  }
}

async function main() {
  const result = { arm, fill: FILL, block: BLOCK_MS, at: BLOCK_AT };
  const cfg = await (await fetch("/wt/dev-transport.json")).json();
  const indices = Array.from({ length: FILL }, (_, i) => i);

  let received = 0;
  let resolveDone;
  const fillDone = new Promise((r) => { resolveDone = r; });
  let askEpoch = 0;
  let firstEpoch = Infinity;
  let lastEpoch = 0;
  let deliveredMs = 0;

  const onFrame = (f) => {
    received += 1;
    askEpoch ||= f.timing.askMs;
    firstEpoch = Math.min(firstEpoch, f.timing.lastChunkMs);
    lastEpoch = Math.max(lastEpoch, f.timing.lastChunkMs);
    deliveredMs = performance.now();
    if (received === FILL) resolveDone();
  };

  const opts = { decode: false, decoders: 0, onFrame };
  if (arm === "start") opts.fill = indices;

  // The clock starts where the page's work does: the worker is born inside connect().
  await sleep(0);
  const t0 = performance.now();
  const epoch0 = performance.timeOrigin + t0;
  const opening = DownloaderClient.connect(cfg.wt_url, cfg.cert_sha256, opts);
  if (BLOCK_MS && BLOCK_AT === "call") hold(BLOCK_MS);
  else if (BLOCK_MS) setTimeout(() => hold(BLOCK_MS), Number(BLOCK_AT));
  const c = await opening;
  result.started_ms = performance.now() - t0;
  if (arm !== "start") c.fill(indices);

  await Promise.race([fillDone, sleep(30000)]);
  result.received = received;
  result.ask_ms = askEpoch ? askEpoch - epoch0 : null;
  result.received_first_ms = received ? firstEpoch - epoch0 : null;
  result.received_all_ms = received === FILL ? lastEpoch - epoch0 : null;
  result.delivered_all_ms = received === FILL ? deliveredMs - t0 : null;
  c.close();
  log(JSON.stringify(result));
  globalThis.__wtpacsResult = result;
  globalThis.__wtpacsDone = true;
}

main().catch((e) => {
  log("FAILED: " + (e?.stack || e?.message || e));
  globalThis.__wtpacsResult = { arm, block: BLOCK_MS, at: BLOCK_AT, error: String(e?.message ?? e) };
  globalThis.__wtpacsDone = true;
});
