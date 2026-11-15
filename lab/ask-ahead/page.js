/**
 * A fill of the whole series through the product's downloader; once `at` of it has landed (half unless
 * set; `none`, no ask), an ask for frame `ask` (the last unless set), which the fill has not reached; with
 * `asks=K`, K asks for the K frames ending at `ask`, `every` ms apart, each skipped if its frame has landed: a
 * scroll's steps, `scroll` the downloader's lab flag for them.
 * Every frame is hashed for the driver to check. lab/ask-ahead/README.md
 */
import { DownloaderClient } from "/client/transport/consumer.js";

const q = new URLSearchParams(location.search);
const N = Number(q.get("frames"));
const AT = q.get("at") ?? "0.5";
const ASK = AT === "none" ? -1 : Number(q.get("ask") ?? N - 1);
const K = Number(q.get("asks") ?? 1);
const EVERY = Number(q.get("every") ?? 0);
const at = () => performance.timeOrigin + performance.now();
const hex = async (b) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");

const landed = new Map();
const sha = {};
let issuedAt = 0;
let askAt = 0;
let askDoneAt = 0;
const asks = new Map();
let landedBeforeAsk = 0;
let before = [];
let client = null;
const steps = [];

/** ms the cursor showed another frame than its own, each step's wait cut at the next step, the last one's not. */
function stale() {
  const wait = (k) => Math.max(0, landed.get(steps[k][0]) - steps[k][1]);
  return steps.reduce((sum, [, t], k) => sum + (k + 1 < steps.length ? Math.min(wait(k), steps[k + 1][1] - t) : wait(k)), 0);
}

function maybeDone() {
  if (landed.size < N || (ASK >= 0 && (asks.size < K || [...asks.values()].some((a) => a && !a.done)))) return;
  const fillLast = Math.max(...landed.values());
  // Fill frames that landed after the ask went out and before the asked frame: what the ask waited behind.
  const ahead = [...landed].filter(([i, t]) => i !== ASK && t > askAt && t <= askDoneAt).map(([i]) => i);
  // The first fill frame to land after the asked one: what the re-issued remainder delivered first.
  const after = [...landed].filter(([i, t]) => i !== ASK && t > askDoneAt).sort((a, b) => a[1] - b[1])[0];
  Promise.all(Object.values(sha)).then(() => {
    globalThis.__result = {
      askMs: ASK >= 0 ? askDoneAt - askAt : null,
      asksMs: [...asks.values()].filter(Boolean).map((a) => a.done - a.sent),
      staleMs: steps.length ? stale() : null,
      restMs: steps.length ? Math.max(0, landed.get(ASK) - steps.at(-1)[1]) : null,
      allMs: ASK >= 0 ? Math.max(...[...asks.values()].filter(Boolean).map((a) => a.done)) - askAt : null,
      fillMs: fillLast - issuedAt, landedBeforeAsk, before, ahead,
      next: ASK >= 0 && after ? { index: after[0], ms: after[1] - askDoneAt } : null,
      landedMs: [...Array(N).keys()].map((i) => landed.get(i) - issuedAt),
      sha: Object.fromEntries(Object.entries(sha).map(([i, p]) => [i, p.value])),
    };
    client.close();
  });
}

/** One step of the shape: a frame that has landed is not asked, as the viewer asks only for a missing one. */
function askOne(i) {
  steps.push([i, at()]);
  if (landed.has(i)) {
    asks.set(i, null);
    return maybeDone();
  }
  const a = { sent: at() };
  asks.set(i, a);
  client.requestExactFrame(i).then((g) => {
    a.done = at();
    if (i === ASK) askDoneAt = a.done;
    keep(i, g.bytes);
    maybeDone();
  }, (e) => { globalThis.__result = { error: String(e.message) }; });
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
  scroll: q.get("scroll") ?? undefined,
  onFrame: (f) => {
    keep(f.frameIndex, f.bytes);
    if (ASK >= 0 && !askAt && landed.size >= N * Number(AT)) {
      landedBeforeAsk = landed.size;
      before = [...landed.keys()];
      askAt = at();
      for (let k = 0; k < K; k++) {
        const i = ASK - K + 1 + k;
        if (EVERY) setTimeout(() => askOne(i), k * EVERY);
        else askOne(i);
      }
    }
    maybeDone();
  },
  onError: (e) => { globalThis.__result = { error: `frame ${e.frameIndex}: ${e.reason}` }; },
});
issuedAt = at();
client.fill([...Array(N).keys()]);
