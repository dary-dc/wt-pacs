/**
 * One arm, one scenario, one fresh session, against the real server. Three arms:
 *   H   today's harness path — the TS session on this thread, the fill as a waiter per frame
 *   Dw  the downloader with decode off — the same bytes, delivered from its worker
 *   Dd  the downloader decoding, three decoders — pixels in a SharedArrayBuffer (the product path)
 * Five scenarios: a fill of `fill` frames; one cold ask; a fill with an ask for a frame outside it
 * once 10, 50 or 90 % has landed. Numbers go to window.__wtpacsResult; run.mjs adds what only
 * CDP can see. docs/proposal-downloader.md §S4.
 */
import { DownloaderClient } from "/client/downloader/consumer.js";

const q = new URLSearchParams(location.search);
const arm = q.get("arm") || "H";
const scenario = q.get("scenario") || "fill";
const FILL = Number(q.get("fill") || 80);
const ASK = Number(q.get("askFrame") || 86);
const DECODER = {
  glue: "/lab/decode-bench/vendor/openjph/openjphjs.js",
  wasm: "/lab/decode-bench/vendor/openjph/openjphjs.wasm",
  dir: "/lab/decode-bench/vendor/openjph",
};

// D7: ?decoder=source points at the build with a 4 MB floor instead of the package's 50 MB.
const SOURCE_DECODER = {
  glue: "/lab/.openjph-build/wasm/plain.js",
  wasm: "/lab/.openjph-build/wasm/plain.wasm",
  dir: "/lab/.openjph-build/wasm",
};

const logEl = document.getElementById("log");
const log = (s) => { logEl.textContent += s + "\n"; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One byte per 4 KiB and the last, so the bytes are used — the harness shell's `touch`. */
let checksum = 0;
let handlerMs = 0;
function handle(bytes) {
  const t = performance.now();
  for (let i = 0; i < bytes.length; i += 4096) checksum = (checksum * 31 + bytes[i]) >>> 0;
  if (bytes.length) checksum = (checksum * 31 + bytes[bytes.length - 1]) >>> 0;
  handlerMs += performance.now() - t;
}

async function harnessArm(cfg) {
  const { TransportSession } = await import("/client/transport-ts/dist/session.js");
  const s = await TransportSession.connect(cfg.wt_url, cfg.cert_sha256);
  return {
    workers: 0,
    fill(onFrame, onDone, fillEnded) {
      const askMs = s.startStreamFrames(FILL - 1);
      (async () => {
        let i = 0;
        for (; i < FILL; i++) {
          // Once an ask has ended this fill on the server, a waiter that would sit 15 s is given 1.5.
          const wait = s.waitExactFrame(i, askMs).catch(() => null);
          const r = fillEnded() ? await Promise.race([wait, sleep(1500).then(() => null)]) : await wait;
          if (!r) break;
          onFrame(r.frameIndex, r.bytes);
        }
        // The waiters the dead fill leaves armed reject on close(); give each a handler.
        for (i += 1; i < FILL; i++) s.waitExactFrame(i, askMs).catch(() => {});
        onDone();
      })();
    },
    ask: async (i) => (await s.requestExactFrame(i)).bytes,
    stats: () => s.stats(),
    close: () => s.close(),
  };
}

async function downloaderArm(cfg, decode) {
  let deliver = () => {};
  const c = await DownloaderClient.connect(cfg.wt_url, cfg.cert_sha256, {
    decode,
    decoders: decode ? 3 : 0,
    decoder: decode
      ? (new URLSearchParams(location.search).get("decoder") === "source" ? SOURCE_DECODER : DECODER)
      : undefined,
    onFrame: (f) => deliver(f),
  });
  return {
    workers: decode ? 4 : 1,
    fill(onFrame, onDone, _fillEnded) {
      let n = 0;
      deliver = (f) => {
        onFrame(f.frameIndex, f.bytes);
        if (++n === FILL) onDone();
      };
      c.fill(Array.from({ length: FILL }, (_, i) => i));
    },
    ask: async (i) => (await c.requestExactFrame(i)).bytes,
    stats: () => c.stats(),
    close: () => c.close(),
  };
}

async function main() {
  const result = { arm, scenario, fill: FILL, askFrame: ASK, cores: navigator.hardwareConcurrency };
  const cfg = await (await fetch("/wt/dev-transport.json")).json();
  const rig = arm === "H" ? await harnessArm(cfg) : await downloaderArm(cfg, arm === "Dd");
  result.workers = rig.workers;
  log(`${arm} ${scenario}: connected, workers=${rig.workers}, crossOriginIsolated=${globalThis.crossOriginIsolated}`);

  // The driver snapshots its counters and starts tracing here, then lets the scenario go.
  globalThis.__wtpacsReady = true;
  while (!globalThis.__wtpacsGo) await sleep(5);

  let heapPeak = 0;
  const sampler = setInterval(() => { heapPeak = Math.max(heapPeak, performance.memory?.usedJSHeapSize ?? 0); }, 50);
  const t0 = performance.now();

  if (scenario === "ask") {
    const b = await rig.ask(ASK);
    result.ask_ms = performance.now() - t0;
    handle(b);
  } else {
    const k = scenario === "fill" ? null : Number(scenario.slice(3)) / 100;
    const askAt = k === null ? Infinity : Math.round(FILL * k);
    let delivered = 0;
    let lastFrameMs = 0;
    let askIssued = false;
    let resolveDone;
    let resolveAsk;
    const fillDone = new Promise((r) => { resolveDone = r; });
    const askDone = k === null ? Promise.resolve() : new Promise((r) => { resolveAsk = r; });
    rig.fill(
      (index, bytes) => {
        handle(bytes);
        delivered += 1;
        lastFrameMs = performance.now() - t0;
        if (!askIssued && delivered >= askAt) {
          askIssued = true;
          result.ask_issued_at_ms = performance.now() - t0;
          result.ask_issued_after = delivered;
          const t = performance.now();
          rig.ask(ASK).then(
            (b) => { result.ask_ms = performance.now() - t; handle(b); resolveAsk(); },
            (e) => { result.ask_error = String(e?.message ?? e); resolveAsk(); },
          );
        }
      },
      () => resolveDone(),
      () => askIssued,
    );
    await askDone;
    await Promise.race([fillDone, sleep(30000)]);
    result.delivered = delivered;
    result.fill_completed = delivered === FILL;
    result.last_frame_ms = lastFrameMs;
  }

  clearInterval(sampler);
  result.handler_ms = handlerMs;
  result.js_heap_peak = heapPeak;
  result.checksum = checksum;
  result.stats = rig.stats();
  // The driver stops tracing here: the memory measurement below forces a GC that must not count.
  globalThis.__wtpacsScenarioDone = true;
  while (!globalThis.__wtpacsMeasure) await sleep(5);
  try {
    const mem = await performance.measureUserAgentSpecificMemory();
    result.memory_bytes = mem.bytes;
    result.memory_workers_bytes = mem.breakdown
      .filter((b) => b.attribution.some((a) => a.scope === "DedicatedWorkerGlobalScope"))
      .reduce((n, b) => n + b.bytes, 0);
  } catch (e) {
    result.memory_error = String(e?.message ?? e);
  }
  rig.close();
  log(JSON.stringify(result));
  globalThis.__wtpacsResult = result;
  globalThis.__wtpacsDone = true;
}

main().catch((e) => {
  log("FAILED: " + (e?.stack || e?.message || e));
  globalThis.__wtpacsResult = { arm, scenario, error: String(e?.message ?? e) };
  globalThis.__wtpacsDone = true;
});
