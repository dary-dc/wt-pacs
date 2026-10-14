/**
 * A fill of the whole series through the product's downloader; once `at` of it has landed (half unless
 * set; `none`, no ask), an ask for frame `ask` (the last unless set), which the fill has not reached.
 * Every frame is hashed for the driver to check. lab/ask-ahead/README.md
 */
import { DownloaderClient } from "/client/transport/consumer.js";

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
let client = null;

function maybeDone() {
  if (landed.size < N || (ASK >= 0 && !askDoneAt)) return;
  const fillLast = Math.max(...landed.values());
  // Fill frames that landed after the ask went out and before the asked frame: what the ask waited behind.
  const ahead = [...landed].filter(([i, t]) => i !== ASK && t > askAt && t <= askDoneAt).map(([i]) => i);
  // The first fill frame to land after the asked one: what the re-issued remainder delivered first.
  const after = [...landed].filter(([i, t]) => i !== ASK && t > askDoneAt).sort((a, b) => a[1] - b[1])[0];
  Promise.all(Object.values(sha)).then(() => {
    globalThis.__result = {
      askMs: ASK >= 0 ? askDoneAt - askAt : null, fillMs: fillLast - issuedAt, landedBeforeAsk, ahead,
      next: ASK >= 0 && after ? { index: after[0], ms: after[1] - askDoneAt } : null,
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
  refill: q.get("refill") ?? undefined,
  onFrame: (f) => {
    keep(f.frameIndex, f.bytes);
    if (ASK >= 0 && !askAt && landed.size >= N * Number(AT)) {
      landedBeforeAsk = landed.size;
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
