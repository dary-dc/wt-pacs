/**
 * One fill through the downloader against the real server, configured by the runner: when each
 * frame's last byte reached the downloader and its pixels the page, every frame hashed. run.mjs
 * drives it. lab/av1/total/README.md
 *
 *   ?opts=<JSON of connect's decoder, groupLength, frameCount>&fill=N&wt=URL&hash=CERT_SHA256
 */
import { DownloaderClient } from "/client/downloader/consumer.js";

const q = new URLSearchParams(location.search);
const FILL = Number(q.get("fill"));
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

const settled = (client) => frames.length + failures.length === FILL && finish(client);
const client = await DownloaderClient.connect(q.get("wt"), q.get("hash"), {
  ...JSON.parse(q.get("opts")),
  onFrame: (f) => {
    frames.push({ i: f.frameIndex, page: at(), lastByte: f.info.stamps.lastByte });
    pixels.set(f.frameIndex, f.bytes);
    settled(client);
  },
  onError: (e) => {
    failures.push({ i: e.frameIndex, reason: e.reason });
    settled(client);
  },
}).catch((e) => {
  globalThis.__result = { error: String(e?.message ?? e) };
  throw e;
});
issuedAt = at();
client.fill([...Array(FILL).keys()]);
