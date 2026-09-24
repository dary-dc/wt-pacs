/**
 * One arm, one fill, against the real server through the relay: the page records when each frame
 * landed and run.mjs cuts the path under it. `built` is the client as it is; `today` turns
 * resumption off and does what a page could do without it — re-ask once the transport says the
 * fill is gone. docs/proposal-session-survival.md §The measurement this owes
 */
import { DownloaderClient } from "/client/downloader/consumer.js";

const q = new URLSearchParams(location.search);
const arm = q.get("arm") || "built";
/** `quick` is the same code with a tighter wait: what the default costs, not a proposed default. */
const SURVIVAL = { today: false, built: undefined, quick: { stallMs: 1000 } };
const FILL = Number(q.get("fill") || 80);
/** `asks=K` asks for frames 0..K-1 at once instead of filling: each settles its own promise. */
const ASKS = Number(q.get("asks") || 0);

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

function finish() {
  const { resumedAt } = client.stats();
  globalThis.__wtpacsResult = { arm, frames, failures, resumedAt };
  globalThis.__wtpacsDone = true;
  log(`done: ${frames.length}/${FILL} frames, ${failures.length} failures, ${resumedAt.length} resumes`);
}

const cfg = await (await fetch("/wt/dev-transport.json")).json();
client = await DownloaderClient.connect(cfg.wt_url, cfg.cert_sha256, {
  decode: false,
  decoders: 0,
  survival: SURVIVAL[arm],
  onFrame: (f) => {
    frames.push({ i: f.frameIndex, at: at() });
    globalThis.__wtpacsFrames = frames.length;
    if (frames.length >= FILL) finish();
  },
  onError: (e) => {
    failures.push({ i: e.frameIndex, at: at(), reason: e.reason });
    if (arm === "today") askAgain();
  },
});
globalThis.__wtpacsReady = true;
if (ASKS) {
  log(`arm ${arm}, asking for ${ASKS} frames at once`);
  const t0 = at();
  await Promise.all([...Array(ASKS).keys()].map((i) => client.requestExactFrame(i).then(
    () => frames.push({ i, at: at() }),
    (e) => failures.push({ i, at: at(), reason: String(e.message), afterMs: Math.round(at() - t0) }),
  )));
  globalThis.__wtpacsFrames = frames.length;
  finish();
} else {
  log(`arm ${arm}, filling ${FILL} frames`);
  client.fill([...Array(FILL).keys()]);
}
