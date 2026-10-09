/**
 * One variant, one fill, against the real server through the relay: the page records when each frame
 * landed and run.mjs cuts the path under it. `built` is the client as it is; `today` turns
 * resumption off and does what a page could do without it — re-ask once the transport says the
 * fill is gone. docs/ARCHITECTURE.md §The measurement this owes
 */
const q = new URLSearchParams(location.search);
/** `client=` loads another copy of the downloader — a mutant a cell built. */
const { DownloaderClient } = await import(q.get("client") || "/client/transport/consumer.js");
const variant = q.get("variant") || "built";
/** `quick` is the same code with a tighter wait: what the default costs, not a proposed default. */
const SURVIVAL = { today: false, built: undefined, quick: { stallMs: 1000 } };
// Unknown variants (a recycle cell's) are the client as it is.
const FILL = Number(q.get("fill") || 80);
/** `asks=K` asks for frames 0..K-1 at once instead of filling: each settles its own promise. */
const ASKS = Number(q.get("asks") || 0);
/** `recycle=N` swaps the session before N bytes; `sha=1` hashes every frame once the fill is done. */
const RECYCLE = Number(q.get("recycle") || 0) || undefined;
const SHA = q.get("sha") === "1";
const bodies = new Map();

const at = () => performance.timeOrigin + performance.now();
const frames = [];
const failures = [];
const logEl = document.getElementById("log");
const log = (s) => { logEl.textContent += s + "\n"; };

let client = null;
let retry = 0;

/** Today's page learns its fill is gone only when the transport says so, and asks for the rest. */
function askAgain() {
  clearTimeout(retry);
  retry = setTimeout(() => {
    const have = new Set(frames.map((f) => f.i));
    const missing = [];
    for (let i = 0; i < FILL; i++) if (!have.has(i)) missing.push(i);
    if (missing.length) {
      log(`re-asking for ${missing.length} frames`);
      client.fill(missing);
    }
  }, 0);
}

let issuedAt = 0;

async function finish() {
  const { resumedAt, recycledAt } = client.stats();
  const last = Math.max(...frames.map((f) => f.at));
  const sha = {};
  for (const [i, b] of bodies) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", b));
    sha[i] = [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  globalThis.__wtpacsResult = {
    variant, frames, failures, resumedAt, recycledAt, issuedAt, sha, spanMs: frames.length ? Math.round(last - issuedAt) : null,
  };
  globalThis.__wtpacsDone = true;
  client.close();
  log(`done: ${frames.length}/${FILL} frames, ${failures.length} failures, ${resumedAt.length} resumes`);
}

const cfg = await (await fetch("/wt/dev-transport.json")).json();
client = await DownloaderClient.connect(cfg.wt_url, cfg.cert_sha256, {
  decode: false,
  decoders: 0,
  survival: SURVIVAL[variant],
  recycleAtBytes: RECYCLE,
  onFrame: (f) => {
    frames.push({ i: f.frameIndex, at: at() });
    if (SHA) bodies.set(f.frameIndex, f.bytes);
    globalThis.__wtpacsFrames = frames.length;
    if (frames.length >= FILL) finish();
  },
  onError: (e) => {
    failures.push({ i: e.frameIndex, at: at(), reason: e.reason });
    if (variant === "today") askAgain();
  },
});
globalThis.__wtpacsReady = true;
if (ASKS) {
  log(`variant ${variant}, asking for ${ASKS} frames at once`);
  const t0 = at();
  issuedAt = t0;
  await Promise.all([...Array(ASKS).keys()].map((i) => client.requestExactFrame(i).then(
    () => frames.push({ i, at: at() }),
    (e) => failures.push({ i, at: at(), reason: String(e.message), afterMs: Math.round(at() - t0) }),
  )));
  globalThis.__wtpacsFrames = frames.length;
  finish();
} else {
  log(`variant ${variant}, filling ${FILL} frames`);
  issuedAt = at();
  client.fill([...Array(FILL).keys()]);
}
