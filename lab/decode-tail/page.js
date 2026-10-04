/**
 * One fill through the downloader with real decoders, every frame's stamps kept: when its last byte
 * landed, when it was handed to a decoder, when decoding started and ended. run.mjs reads the split
 * from them. docs/decode/README.md §The decode tail
 */
import { DownloaderClient } from "/client/downloader/consumer.js";

const q = new URLSearchParams(location.search);
const FILL = Number(q.get("fill"));
const DECODERS = Number(q.get("decoders") || 3);
const dir = q.get("decoderDir") || "/lab/decode-bench/vendor/openjph";
const decoder = { glue: `${dir}/${q.get("glue") || "openjphjs.js"}`, wasm: `${dir}/${q.get("wasm") || "openjphjs.wasm"}`, dir };

const frames = [];
const cfg = { wt_url: q.get("wt"), cert_sha256: q.get("hash") };
let resolveAll;
const all = new Promise((r) => (resolveAll = r));
const client = await DownloaderClient.connect(cfg.wt_url, cfg.cert_sha256, {
  decoders: DECODERS,
  decoder,
  decoderWorker: q.get("decoderWorker") || undefined,
  onFrame: (f) => {
    frames.push({ i: f.frameIndex, bytes: f.info.byteCount, ...f.info.stamps, received: performance.timeOrigin + performance.now() });
    if (frames.length === FILL) resolveAll();
  },
  onError: (e) => frames.push({ i: e.frameIndex, error: e.reason }),
});
// Decoders compile after `connect` settles; a fill asked before they are up is a start-up cell.
const settle = (ms) => new Promise((r) => setTimeout(r, ms * Number(q.get("slow") || 1)));
await settle(1500);
const askAt = performance.timeOrigin + performance.now();
client.fill([...Array(FILL).keys()]);
await Promise.race([all, new Promise((r) => setTimeout(r, 60000))]);
// One frame asked on an idle, warm session, spread over the study: one frame's latency.
const asks = [];
for (const i of (q.get("asks") || "").split(",").filter(Boolean).map(Number)) {
  await settle(300);
  const at = performance.timeOrigin + performance.now();
  const f = await client.requestExactFrame(i).catch(() => null);
  if (f) asks.push({ i, at, received: performance.timeOrigin + performance.now(), ...f.info.stamps });
}
client.close();
fetch(`http://127.0.0.1:${q.get("report")}/`, {
  method: "POST",
  body: JSON.stringify({ set: q.get("set"), arm: q.get("arm"), askAt, frames, asks }),
  keepalive: true,
});
