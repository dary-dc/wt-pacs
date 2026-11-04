/**
 * f4c396c8's total-time/page.js, and `tf-frame`'s slice i as entries 2i (top) and 2i + 1 (exact). README.md
 * One fill through the downloader, every frame timed and hashed; a layer-major series (lab/av1/delivery/bases-first)
 * fills F bases as previews, then F exact frames; then frames N … N+K−1 asked one at a time, each timed
 * from its ask. run.mjs drives it. lab/av1/delivery/total-time/README.md
 *
 *   ?opts=<JSON of connect's decoder, groupLength, frameCount>&fill=N&wt=URL&hash=CERT_SHA256[&asks=i,j,…][&after=K][&post=URL]  (fill=0: a cold ask)
 */
import { DownloaderClient } from "/client/transport/consumer.js";

const q = new URLSearchParams(location.search);
const FILL = Number(q.get("fill"));
const AFTER = Number(q.get("after") ?? 0);
const OPTS = JSON.parse(q.get("opts"));
/** Entries a frame has: a layer-major series' exact frame N is entry F + N. */
const LAYERS = OPTS.decoder?.layers ?? 1;
const F = FILL / LAYERS;
const EXACT_AT = OPTS.decoder?.exactAt ?? (LAYERS - 1) * F;
/** [start, count, layer] a layer, when a series names its entries (lab/av1/delivery/scalable/tool). */
const RANGES = OPTS.decoder?.ranges;
const MIDDLE_AT = OPTS.decoder?.middleAt ?? Infinity;
const INTERLEAVED = OPTS.decoder?.mode === "tf-frame";
const ENTRIES = RANGES ? RANGES.flatMap(([at, n]) => Array.from({ length: n }, (_, i) => at + i))
  : OPTS.decoder?.exactAt ? [...Array(F).keys(), ...Array.from({ length: F }, (_, i) => EXACT_AT + i)] : [...Array(FILL).keys()];
const at = () => performance.timeOrigin + performance.now();
const frames = [];
const failures = [];
const previews = [];
const after = [];
const pixels = new Map();
const previewPixels = new Map();
let issuedAt = 0;
const quiet = [];
new BroadcastChannel("quiet").onmessage = (e) => quiet.push(e.data);

/** The harness takes the result by POST: Firefox runs without a remote protocol. */
function report(result) {
  globalThis.__result = result;
  if (q.get("post")) fetch(`${q.get("post")}result`, { method: "POST", body: JSON.stringify(result) });
}

async function sha256(sab) {
  // SubtleCrypto refuses a view on shared memory.
  const copy = new Uint8Array(sab.byteLength);
  copy.set(sab);
  if (q.get("mutate") === "sample") copy[copy.length >> 1] ^= 1;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function finish(client) {
  for (let i = FILL; i < FILL + AFTER; i++) {
    const t0 = at();
    try {
      pixels.set(i, (await client.requestExactFrame(i)).bytes);
      after.push({ i, ms: at() - t0 });
    } catch (e) {
      failures.push({ i, reason: String(e?.message ?? e) });
    }
  }
  const { resumedAt, exact: checked } = client.stats();
  // Decode pacing: the harness reads the decoders' threads while they still exist.
  if (q.get("post")) await fetch(`${q.get("post")}filled`, { method: "POST" });
  client.close();
  const sha = {};
  for (const [i, px] of pixels) sha[i] = await sha256(px);
  const previewSha = {};
  for (const [i, px] of previewPixels) previewSha[i] = await sha256(px);
  report({ issuedAt, frames, failures, sha, previews, previewSha, after, resumes: resumedAt.length, quiet: [...quiet], checked });
}

const exact = (f) => {
  frames.push({ i: f.frameIndex, page: at(), lastByte: f.info.stamps.lastByte });
  pixels.set(f.frameIndex, f.bytes);
};
const settled = (client) => frames.length + previews.length + failures.length === FILL && finish(client);
// The harness slows the CPU here: after the browser's start, before anything timed.
if (q.get("post")) await fetch(`${q.get("post")}hello`, { method: "POST" });
const client = await DownloaderClient.connect(q.get("wt"), q.get("hash"), {
  ...OPTS,
  onFrame: (f) => {
    const i = INTERLEAVED ? (f.frameIndex - 1) / 2 : f.frameIndex - EXACT_AT;
    const { lastByte, decoder, decodeStart: start, decodeEnd: end } = f.info.stamps;
    frames.push({ i, page: at(), lastByte, decoder, start, end, exact: f.info.exact, path: f.info.path, wireBytes: f.info.wireBytes });
    pixels.set(i, f.bytes);
    settled(client);
  },
  // A base decoded after its exact frame must not replace it: it is counted, never shown.
  onPreview: (f) => {
    const middle = f.frameIndex >= MIDDLE_AT;
    const i = middle ? f.frameIndex - MIDDLE_AT : INTERLEAVED ? f.frameIndex / 2 : f.frameIndex;
    const { lastByte, decoder, decodeStart: start, decodeEnd: end } = f.info.stamps;
    previews.push({ i, layer: middle ? "middle" : "base", page: at(), late: pixels.has(i), lastByte, decoder, start, end, wireBytes: f.info.wireBytes });
    previewPixels.set(middle ? f.frameIndex : i, f.bytes);
    settled(client);
  },
  onError: (e) => {
    failures.push({ i: e.frameIndex, reason: e.reason });
    settled(client);
  },
}).catch((e) => {
  report({ error: String(e?.message ?? e) });
  throw e;
});
issuedAt = q.get("origin") === "navigation" ? performance.timeOrigin : at();
// Asked frames come back through their promise, never onFrame.
for (const i of q.get("asks")?.split(",").map(Number) ?? []) {
  client.requestExactFrame(i).then(exact, (e) => failures.push({ i, reason: String(e?.message ?? e) })).then(() => settled(client));
}
if (FILL || q.get("asks")) client.fill(ENTRIES);
else finish(client);
