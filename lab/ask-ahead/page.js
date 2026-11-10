/**
 * A fill of the whole series through the product's downloader; once `at` of it has landed (half unless
 * set; `none`, no ask), an ask for frame `ask` (the last unless set), which the fill has not reached.
 * With `codec` the product's decoders are on, and `askJump` sets that lab flag. Every frame is hashed for
 * the driver to check. lab/ask-ahead/README.md
 */
import { DownloaderClient } from "/client/transport/consumer.js";
import { built } from "/client/decode/wasm-glue.js";

const q = new URLSearchParams(location.search);
const N = Number(q.get("frames"));
const AT = q.get("at") ?? "0.5";
const ASK = AT === "none" ? -1 : Number(q.get("ask") ?? N - 1);
const at = () => performance.timeOrigin + performance.now();
const hex = async (b) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");

const landed = new Map();
const sha = {};
let issuedAt = 0;
let askAt = 0;
let askDoneAt = 0;
let landedBeforeAsk = 0;
let before = [];
let client = null;
const CODEC = q.get("codec");
const pixels = new Map();
let askStamps = null;

function maybeDone() {
  if (landed.size < N || (ASK >= 0 && !askDoneAt)) return;
  const fillLast = Math.max(...landed.values());
  // Fill frames that landed after the ask went out and before the asked frame: what the ask waited behind.
  const ahead = [...landed].filter(([i, t]) => i !== ASK && t > askAt && t <= askDoneAt).map(([i]) => i);
  // The first fill frame to land after the asked one: what the re-issued remainder delivered first.
  const after = [...landed].filter(([i, t]) => i !== ASK && t > askDoneAt).sort((a, b) => a[1] - b[1])[0];
  // Decoded pixels are hashed once the run is over, so the hash takes no CPU from the decoders.
  for (const [i, px] of pixels) hashed(i, Uint8Array.from(px));
  Promise.all(Object.values(sha)).then(() => {
    globalThis.__result = {
      askMs: ASK >= 0 ? askDoneAt - askAt : null, fillMs: fillLast - issuedAt, landedBeforeAsk, before, ahead,
      // From the later of the ask and its bytes in hand: a frame the fill already delivered is promoted at the ask.
      askDecoderMs: askStamps ? askStamps.decodeEnd - Math.max(askStamps.lastByte, askAt) : null,
      askInHand: askStamps ? askStamps.lastByte < askAt : null, settings,
      next: ASK >= 0 && after ? { index: after[0], ms: after[1] - askDoneAt } : null,
      landedMs: [...Array(N).keys()].map((i) => landed.get(i) - issuedAt),
      sha: Object.fromEntries(Object.entries(sha).map(([i, p]) => [i, p.value])),
    };
    client.close();
  });
}

function hashed(i, bytes) {
  if (q.get("mutate") === "sample") bytes[bytes.length >> 1] ^= 1;
  const p = hex(bytes).then((h) => { p.value = h; });
  sha[i] = p;
}

function keep(i, bytes) {
  landed.set(i, at());
  if (CODEC) pixels.set(i, bytes);
  else hashed(i, bytes);
}

const decoding = CODEC ? {
  decoder: CODEC === "av1" ? { codec: "av1", ...(await built("dav1d")) } : await built("openjph"),
  askJump: q.has("askJump"),
} : { decode: false, decoders: 0 };
const decoders = Math.min(3, navigator.hardwareConcurrency || 3);
// The downloader's own defaults, restated: it reports neither. client/transport/downloader.js `cfg`, `openSession`
const settings = CODEC ? { decoder: decoding.decoder.glue, decoders, perDecoder: 2, ring: decoders * 2 + 2 + (decoding.askJump ? 1 : 0), askJump: decoding.askJump } : null;
const cfg = await (await fetch("/wt/dev-transport.json")).json();
client = await DownloaderClient.connect(cfg.wt_url, cfg.cert_sha256, {
  ...decoding,
  refill: q.get("refill") ?? undefined,
  onFrame: (f) => {
    keep(f.frameIndex, f.bytes);
    if (ASK >= 0 && !askAt && landed.size >= N * Number(AT)) {
      landedBeforeAsk = landed.size;
      before = [...landed.keys()];
      askAt = at();
      client.requestExactFrame(ASK).then((g) => {
        askDoneAt = at();
        askStamps = g.info?.stamps ?? null;
        keep(ASK, g.bytes);
        maybeDone();
      }, (e) => { globalThis.__result = { error: String(e.message) }; });
    }
    maybeDone();
  },
  onError: (e) => { globalThis.__result = { error: `frame ${e.frameIndex}: ${e.reason}` }; },
});
issuedAt = at();
client.fill([...Array(N).keys()]);
