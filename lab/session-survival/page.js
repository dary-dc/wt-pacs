/**
 * One arm, one fill, against the real server through the relay: the page records when each frame
 * landed and run.mjs cuts the path under it. `built` is the client as it is; `today` turns
 * resumption off and does what a page could do without it — re-ask once the transport says the
 * fill is gone. docs/proposal-session-survival.md §The measurement this owes
 */
import { DownloaderClient } from "/client/downloader/consumer.js";

const q = new URLSearchParams(location.search);
const arm = q.get("arm") || "built";
const FILL = Number(q.get("fill") || 80);

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
  globalThis.__wtpacsResult = { arm, frames, failures, resumes: client.stats().resumes };
  globalThis.__wtpacsDone = true;
  log(`done: ${frames.length}/${FILL} frames, ${failures.length} failures, ${client.stats().resumes} resumes`);
}

const cfg = await (await fetch("/wt/dev-transport.json")).json();
client = await DownloaderClient.connect(cfg.wt_url, cfg.cert_sha256, {
  decode: false,
  decoders: 0,
  survival: arm === "today" ? false : undefined,
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
log(`arm ${arm}, filling ${FILL} frames`);
globalThis.__wtpacsReady = true;
client.fill([...Array(FILL).keys()]);
