/**
 * One fill through the downloader with its decoders on, against the real server: when every
 * frame's last byte reached the downloader and when its pixels reached the page, every frame
 * hashed against its source. run.mjs drives it. lab/av1/delivery/fill/README.md
 *
 *   ?arm=htj2k|av1|webcodecs|EXT[@T][/D]&fill=N&wt=URL&hash=CERT_SHA256[&wc=av01…]
 */
import { DownloaderClient } from "/client/transport/consumer.js";

const q = new URLSearchParams(location.search);
const ARM = q.get("arm");
const FILL = Number(q.get("fill"));
const DECODER = {
  htj2k: { decoder: { glue: "/client/decode/wasm/vendor/openjph/openjphjs.js",
    wasm: "/client/decode/wasm/vendor/openjph/openjphjs.wasm", dir: "/client/decode/wasm/vendor/openjph" } },
  av1: { decoder: { codec: "av1", glue: "/lab/.av1-build/out/simd.js",
    wasm: "/lab/.av1-build/out/simd.wasm", dir: "/lab/.av1-build/out" } },
  webcodecs: { decoderWorker: "/lab/av1/decode/per-frame/webcodecs-worker.js", decoder: { codec: "av1", webcodecs: q.get("wc") } },
}[ARM] ?? dav1d(ARM);

/** `EXT[@T][/D]`: dav1d-WASM, the threaded build with T threads when T is given, D decoders. */
function dav1d(arm) {
  const [, t, d] = arm.match(/^[^@/]+(?:@(\d+))?(?:\/(\d+))?$/);
  const build = t ? "simd-mt" : "simd";
  return { decoders: Number(d ?? 3), decoder: { codec: "av1", glue: `/lab/.av1-build/out/${build}.js`,
    wasm: `/lab/.av1-build/out/${build}.wasm`, dir: "/lab/.av1-build/out", threads: Number(t ?? 1) } };
}

const at = () => performance.timeOrigin + performance.now();
const frames = [];
const failures = [];
const pixels = new Map();
let issuedAt = 0;

async function sha256(sab) {
  // SubtleCrypto refuses a view on shared memory.
  const copy = new Uint8Array(sab.byteLength);
  copy.set(sab);
  if (q.get("mutate") === "sample") copy[copy.length >> 1] ^= 1;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function finish(client) {
  client.close();
  const sha = {};
  for (const [i, px] of pixels) sha[i] = await sha256(px);
  globalThis.__result = { issuedAt, frames, failures, sha };
}

const client = await DownloaderClient.connect(q.get("wt"), q.get("hash"), {
  ...DECODER,
  onFrame: (f) => {
    const s = f.info.stamps;
    frames.push({ i: f.frameIndex, page: at(), lastByte: s.lastByte, decodeStart: s.decodeStart,
      decodeEnd: s.decodeEnd, decoder: s.decoder, decoderReady: s.decoderReady });
    pixels.set(f.frameIndex, f.bytes);
    if (frames.length + failures.length === FILL) finish(client);
  },
  onError: (e) => {
    failures.push({ i: e.frameIndex, reason: e.reason });
    if (frames.length + failures.length === FILL) finish(client);
  },
}).catch((e) => {
  globalThis.__result = { error: String(e?.message ?? e) };
  throw e;
});
issuedAt = at();
client.fill([...Array(FILL).keys()]);
