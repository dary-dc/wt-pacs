/**
 * One variant, one scenario, one fresh session, against the real server. Two variants (H, the harness's
 * own path, was removed 2026-10-03 after its last run, docs/ARCHITECTURE.md §The container campaign):
 *   Dw  the downloader with decode off — the same bytes, delivered from its worker
 *   Dd  the downloader decoding, `decoders` of them (3) — pixels in a SharedArrayBuffer (the product path)
 * Five scenarios: a fill of `fill` frames; one cold ask; a fill with an ask for a frame outside it
 * once 10, 50 or 90 % has landed. HELPERSTART adds `warm`, an ask after the fill on idle decoders, and
 * `ready`, the decoder workers alone from start to ready. Numbers go to window.__wtpacsResult; run.mjs adds what only
 * CDP can see. docs/ARCHITECTURE.md §The container campaign.
 */
import { DownloaderClient } from "/client/transport/consumer.js";
import { built } from "/client/decode/wasm-glue.js";

const q = new URLSearchParams(location.search);
const variant = q.get("variant") || "Dw";
const scenario = q.get("scenario") || "fill";
const FILL = Number(q.get("fill") || 80);
const DECODERS = Number(q.get("decoders") || 3);
const ASK = Number(q.get("askFrame") || 86);
// BYM: `readMin` reads each frame through a BYOB reader; `digest` keeps every frame's sha256.
const READ_MIN = Number(q.get("readMin") || 0) || undefined;
const DIGEST = q.has("digest");
const CAP_MS = Number(q.get("capMs") || 30000);
const DECODER = {
  glue: "/client/decode/wasm/vendor/openjph/openjphjs.js",
  wasm: "/client/decode/wasm/vendor/openjph/openjphjs.wasm",
  dir: "/client/decode/wasm/vendor/openjph",
};

// D7: ?decoder=source points at the build with a 4 MB floor instead of the package's 50 MB.
const SOURCE_DECODER = {
  glue: "/lab/.openjph-build/wasm/plain.js",
  wasm: "/lab/.openjph-build/wasm/plain.wasm",
  dir: "/lab/.openjph-build/wasm",
};

// DECODERBUILD: ?decoder=built is the product's own build, checked against its manifest; `lab:<variant>` is one of
// lab/decode-bench/wasm/build.sh's.
const labDecoder = (n) => ({ glue: `/lab/.openjph-build/wasm/${n}.js`, wasm: `/lab/.openjph-build/wasm/${n}.wasm`, dir: "/lab/.openjph-build/wasm" });
const chosenDecoder = async (name) =>
  name === "source" ? SOURCE_DECODER : name === "built" ? await built("openjph") : name?.startsWith("lab:") ? labDecoder(name.slice(4)) : DECODER;

/** Ms from `new Worker` to `ready` for each of DECODERS product decoder workers started together. */
async function decodersReady() {
  const decoder = await chosenDecoder(q.get("decoder"));
  const t0 = performance.now();
  return Promise.all(Array.from({ length: DECODERS }, () => new Promise((resolve, reject) => {
    const w = new Worker("/client/decode/decoder.js", { type: "module" });
    const ch = new MessageChannel();
    w.onmessage = (e) => {
      if (e.data.kind === "ready") resolve(performance.now() - t0);
      else if (e.data.kind === "init-failed") reject(new Error(e.data.reason));
    };
    w.postMessage({ kind: "init", toConsumer: ch.port1, decoder }, [ch.port1]);
  })));
}

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

async function downloaderVariant(cfg, decode) {
  let deliver = () => {};
  let mediaReads;
  const c = await DownloaderClient.connect(cfg.wt_url, cfg.cert_sha256, {
    decode,
    decoders: decode ? DECODERS : 0,
    decoder: decode ? await chosenDecoder(q.get("decoder")) : undefined,
    readMin: READ_MIN,
    onFrame: (f) => deliver(f),
  });
  return {
    workers: decode ? 1 + DECODERS : 1,
    fill(onFrame, onDone, _fillEnded) {
      let n = 0;
      deliver = (f) => {
        mediaReads = Math.max(mediaReads ?? 0, f.info?.stamps?.mediaReads ?? 0);
        onFrame(f.frameIndex, f.bytes);
        if (++n === FILL) onDone();
      };
      c.fill(Array.from({ length: FILL }, (_, i) => i));
    },
    ask: async (i) => (await c.requestExactFrame(i)).bytes,
    stats: () => ({ ...c.stats(), mediaReads }),
    close: () => c.close(),
  };
}

async function main() {
  const result = { variant, scenario, fill: FILL, askFrame: ASK, cores: navigator.hardwareConcurrency };
  if (scenario === "ready") {
    globalThis.__wtpacsReady = true;
    while (!globalThis.__wtpacsGo) await sleep(5);
    result.ready_ms = await decodersReady();
    globalThis.__wtpacsScenarioDone = true;
    globalThis.__wtpacsResult = result;
    globalThis.__wtpacsDone = true;
    return;
  }
  const cfg = await (await fetch("/wt/dev-transport.json")).json();
  const rig = await downloaderVariant(cfg, variant === "Dd");
  result.workers = rig.workers;
  log(`${variant} ${scenario}: connected, workers=${rig.workers}, crossOriginIsolated=${globalThis.crossOriginIsolated}`);

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
    if (DIGEST) result.ask_digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", b.slice()))].map((x) => x.toString(16).padStart(2, "0")).join("");
  } else {
    const k = scenario === "fill" || scenario === "warm" ? null : Number(scenario.slice(3)) / 100;
    const askAt = k === null ? Infinity : Math.round(FILL * k);
    let delivered = 0;
    let lastFrameMs = 0;
    const received = [];
    result.received_ms = received;
    const digests = [];
    if (DIGEST) result.digests = digests;
    let askIssued = false;
    let resolveDone;
    let resolveAsk;
    const fillDone = new Promise((r) => { resolveDone = r; });
    const askDone = k === null ? Promise.resolve() : new Promise((r) => { resolveAsk = r; });
    rig.fill(
      (index, bytes) => {
        handle(bytes);
        if (DIGEST) digests[index] = crypto.subtle.digest("SHA-256", bytes.slice());
        delivered += 1;
        lastFrameMs = performance.now() - t0;
        received.push(lastFrameMs);
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
    await Promise.race([fillDone, sleep(CAP_MS)]);
    result.delivered = delivered;
    result.fill_completed = delivered === FILL;
    result.last_frame_ms = lastFrameMs;
    const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
    if (DIGEST) result.digests = (await Promise.all(digests)).map(hex);
    if (scenario === "warm") {
      await sleep(500);
      const t = performance.now();
      const b = await rig.ask(ASK);
      result.ask_ms = performance.now() - t;
      if (DIGEST) result.ask_digest = hex(await crypto.subtle.digest("SHA-256", b.slice()));
    }
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
  globalThis.__wtpacsResult = { variant, scenario, error: String(e?.message ?? e) };
  globalThis.__wtpacsDone = true;
});
