/**
 * Cut the path under a live fill and time the first frame after the cut, both arms interleaved:
 * every round runs `today` and `built` with the order rotated, so a drift in the host lands on
 * both alike. The cut is `link_impair.py`'s `cut` — the port this session is on is blackholed for
 * good and a session from a new port is not, which is what a handover does on one host.
 * docs/proposal-session-survival.md §The measurement this owes
 *
 *   NODE_PATH=$(npm root -g) node lab/session-survival/run.mjs [--rounds 7] [--cut-after 12]
 */
import fs from "node:fs";
import dgram from "node:dgram";
import { createRequire } from "node:module";

// `import` ignores NODE_PATH; `require` honours it, which is how a global playwright is found.
const { chromium } = createRequire(import.meta.url)("playwright");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 7));
const CUT_AFTER = Number(arg("--cut-after", 12));
const FILL = Number(arg("--fill", 80));
const BASE = arg("--base", "http://127.0.0.1:8792");
const CONTROL = Number(arg("--control", 5583));
const OUT = arg("--out", "");
const ARMS = ["today", "built"];

const sock = dgram.createSocket("udp4");
const cut = () => new Promise((r) => sock.send("cut", CONTROL, "127.0.0.1", () => r()));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  // A 30 s freeze is most of a run, and a throttled timer would be measured instead of the freeze.
  args: [
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});

async function runOne(arm) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/lab/session-survival/index.html?arm=${arm}&fill=${FILL}`);
  await page.waitForFunction((n) => (globalThis.__wtpacsFrames ?? 0) >= n, CUT_AFTER, { timeout: 60000 });
  const cutAt = Date.now();
  await cut();
  let done = true;
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 120000 }).catch(() => { done = false; });
  const r = await page.evaluate(() => globalThis.__wtpacsResult ?? { frames: [], failures: [], resumes: 0 });
  await page.close();
  const after = r.frames.filter((f) => f.at > cutAt).map((f) => f.at - cutAt);
  return {
    arm,
    done,
    firstAfterMs: after.length ? Math.round(Math.min(...after)) : null,
    before: r.frames.length - after.length,
    delivered: r.frames.length,
    failures: r.failures.length,
    resumes: r.resumes ?? 0,
    errors,
  };
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const arm of ARMS.map((_, k) => ARMS[(k + round) % ARMS.length])) {
    const row = { round, ...(await runOne(arm)) };
    rows.push(row);
    console.log(
      `round ${round} ${row.arm.padEnd(5)} first frame after the cut ${String(row.firstAfterMs ?? "never").padStart(7)} ms` +
        `  (${row.before} before, ${row.delivered}/${FILL} delivered, ${row.failures} failed, ${row.resumes} resumes)` +
        (row.errors.length ? `  page error: ${row.errors[0]}` : ""),
    );
  }
}
await browser.close();
sock.close();
if (OUT) fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
console.log(`\nfirst frame after the cut, ${ROUNDS} rounds, interleaved`);
for (const arm of ARMS) {
  const got = rows.filter((r) => r.arm === arm && r.firstAfterMs !== null).map((r) => r.firstAfterMs);
  const complete = rows.filter((r) => r.arm === arm && r.delivered === FILL).length;
  console.log(
    `  ${arm.padEnd(5)} ${got.length ? `${median(got)} ms [${Math.min(...got)} … ${Math.max(...got)}]` : "never"}` +
      `  n=${got.length}/${ROUNDS}, the fill completed in ${complete}/${ROUNDS}`,
  );
}
