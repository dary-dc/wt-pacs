/**
 * One fill through the downloader, every frame timed and hashed; a layer-major series (lab/av1/bases)
 * fills F bases as previews, then F exact frames; then frames N … N+K−1 asked one at a time, each timed
 * from its ask. run.mjs drives it. lab/av1/total/README.md
 *
 *   ?opts=<JSON of connect's decoder, groupLength, frameCount>&fill=N&wt=URL&hash=CERT_SHA256[&asks=i,j,…][&after=K][&post=URL]
 */
import { DownloaderClient } from "/client/downloader/consumer.js";

const q = new URLSearchParams(location.search);
const FILL = Number(q.get("fill"));
const AFTER = Number(q.get("after") ?? 0);
const OPTS = JSON.parse(q.get("opts"));
/** Entries a frame has: a layer-major series' exact frame N is entry F + N. */
const LAYERS = OPTS.decoder?.layers ?? 1;
const F = FILL / LAYERS;
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

/** An engine driven without a remote protocol (Firefox) is handed the result by POST. */
function report(result) {
  globalThis.__result = result;
  if (q.get("post")) fetch(q.get("post"), { method: "POST", body: JSON.stringify(result) });
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
  const { resumedAt } = client.stats();
  client.close();
  const sha = {};
  for (const [i, px] of pixels) sha[i] = await sha256(px);
  const previewSha = {};
  for (const [i, px] of previewPixels) previewSha[i] = await sha256(px);
  report({ issuedAt, frames, failures, sha, previews, previewSha, after, resumes: resumedAt.length, quiet: [...quiet] });
}

const exact = (f) => {
  frames.push({ i: f.frameIndex, page: at(), lastByte: f.info.stamps.lastByte });
  pixels.set(f.frameIndex, f.bytes);
};
const settled = (client) => frames.length + previews.length + failures.length === FILL && finish(client);
const client = await DownloaderClient.connect(q.get("wt"), q.get("hash"), {
  ...OPTS,
  onFrame: (f) => {
    const i = f.frameIndex - (LAYERS - 1) * F;
    frames.push({ i, page: at(), lastByte: f.info.stamps.lastByte });
    pixels.set(i, f.bytes);
    settled(client);
  },
  // A base decoded after its exact frame must not replace it: it is counted, never shown.
  onPreview: (f) => {
    previews.push({ i: f.frameIndex, page: at(), late: pixels.has(f.frameIndex) });
    previewPixels.set(f.frameIndex, f.bytes);
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
issuedAt = at();
// Asked frames come back through their promise, never onFrame.
for (const i of q.get("asks")?.split(",").map(Number) ?? []) {
  client.requestExactFrame(i).then(exact, (e) => failures.push({ i, reason: String(e?.message ?? e) })).then(() => settled(client));
}
client.fill([...Array(FILL).keys()]);
