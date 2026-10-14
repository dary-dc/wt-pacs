/**
 * A fill of the whole series through the product's downloader; once `askAt` of it (default half) has landed, an ask for
 * the last frame, which the fill has not reached. Every frame is hashed for the driver to check.
 * lab/ask-ahead/README.md
 */
import { DownloaderClient } from "/client/transport/consumer.js";

const q = new URLSearchParams(location.search);
const N = Number(q.get("frames"));
const ASK = N - 1;
const ASK_AT = Number(q.get("askAt") ?? 0.5);
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

function maybeDone() {
  if (landed.size < N || !askDoneAt) return;
  const fillLast = Math.max(...landed.values());
  // Fill frames that landed after the ask went out and before the asked frame: what the ask waited behind.
  const ahead = [...landed].filter(([i, t]) => i !== ASK && t > askAt && t <= askDoneAt).map(([i]) => i);
  Promise.all(Object.values(sha)).then(() => {
    globalThis.__result = {
      askMs: askDoneAt - askAt, fillMs: fillLast - issuedAt, landedBeforeAsk, before, ahead,
      landedMs: [...Array(N).keys()].map((i) => landed.get(i) - issuedAt),
      sha: Object.fromEntries(Object.entries(sha).map(([i, p]) => [i, p.value])),
    };
    client.close();
  });
}

function keep(i, bytes) {
  landed.set(i, at());
  const p = hex(bytes).then((h) => { p.value = h; });
  sha[i] = p;
}

const cfg = await (await fetch("/wt/dev-transport.json")).json();
client = await DownloaderClient.connect(cfg.wt_url, cfg.cert_sha256, {
  decode: false,
  decoders: 0,
  onFrame: (f) => {
    keep(f.frameIndex, f.bytes);
    if (!askAt && landed.size >= N * ASK_AT) {
      landedBeforeAsk = landed.size;
      before = [...landed.keys()];
      askAt = at();
      client.requestExactFrame(ASK).then((g) => {
        askDoneAt = at();
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
