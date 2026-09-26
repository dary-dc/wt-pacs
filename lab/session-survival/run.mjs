/**
 * Cut the path under a live fill and time the first frame after the cut, both arms interleaved:
 * every round runs `today` and `built` with the order rotated, so a drift in the host lands on
 * both alike. The cut is `link_impair.py`'s `cut` — the port this session is on is blackholed for
 * good and a session from a new port is not, which is what a handover does on one host.
 * docs/ARCHITECTURE.md §The measurement this owes
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
const ARMS = arg("--arms", "today,built,quick").split(",");
/** `--no-cut` runs the fill undisturbed: every resume it reports is a false alarm. */
const NO_CUT = process.argv.includes("--no-cut");
const BLINK_EVERY = Number(arg("--blink-every", 0));
const BLINK_MS = Number(arg("--blink-ms", 1000));
/** One blink, this long after the page loads, rather than a train of them. */
const BLINK_AT = Number(arg("--blink-at", 0));
const ASKS = Number(arg("--asks", 0));

const sock = dgram.createSocket("udp4");
const poke = (m) => new Promise((r) => sock.send(m, CONTROL, "127.0.0.1", () => r()));
const cut = () => poke("cut");

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
  if (process.env.DEBUG) {
    const t0 = Date.now();
    const say = (who) => (m) => console.log(`  [${who} +${Date.now() - t0}] ${m.text()}`);
    page.on("console", say("page"));
    page.on("worker", (w) => w.on("console", say(w.url().split("/").pop())));
  }
  const startAt = Date.now();
  await page.goto(`${BASE}/lab/session-survival/index.html?arm=${arm}&fill=${FILL}&asks=${ASKS}`);
  let cutAt = Infinity;
  if (!NO_CUT) {
    await page.waitForFunction((n) => (globalThis.__wtpacsFrames ?? 0) >= n, CUT_AFTER, { timeout: 60000 });
    cutAt = Date.now();
    await cut();
  }
  const blinks = BLINK_EVERY ? setInterval(() => poke(`blackout ${BLINK_MS}`), BLINK_EVERY) : null;
  const blink = BLINK_AT ? setTimeout(() => poke(`blackout ${BLINK_MS}`), BLINK_AT) : null;
  let done = true;
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: Number(arg("--timeout", 600000)), polling: 100 }).catch(() => { done = false; });
  clearInterval(blinks);
  clearTimeout(blink);
  const tookMs = Date.now() - startAt;
  const r = await page.evaluate(() => globalThis.__wtpacsResult ?? { frames: [], failures: [], resumedAt: [] });
  await page.close();
  const after = r.frames.filter((f) => f.at > cutAt).map((f) => f.at - cutAt);
  // What noticed: this client resuming, or — with no resumption — the transport failing the run.
  const noticed = [...(r.resumedAt ?? []), ...r.failures.map((f) => f.at)].filter((t) => t > cutAt);
  return {
    arm,
    done,
    noticedMs: noticed.length ? Math.round(Math.min(...noticed) - cutAt) : null,
    firstAfterMs: after.length ? Math.round(Math.min(...after)) : null,
    before: r.frames.length - after.length,
    delivered: r.frames.length,
    failures: r.failures.length,
    reason: r.failures[0]?.reason ?? "",
    resumes: (r.resumedAt ?? []).length,
    tookMs,
    spanMs: r.spanMs ?? null,
    failedAfterMs: r.failures.map((f) => f.afterMs).filter((v) => v !== undefined),
    errors,
  };
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const arm of ARMS.map((_, k) => ARMS[(k + round) % ARMS.length])) {
    const row = { round, ...(await runOne(arm)) };
    rows.push(row);
    console.log(
      `round ${round} ${row.arm.padEnd(5)} noticed ${String(row.noticedMs ?? "never").padStart(6)} ms` +
        `  first frame after the cut ${String(row.firstAfterMs ?? "never").padStart(6)} ms` +
        `  (${row.before} before, ${row.delivered}/${ASKS || FILL} delivered, ${row.failures} failed, ${row.resumes} resumes, ${row.tookMs} ms)` +
        (row.reason ? `  ${row.reason}` : "") +
        (row.errors.length ? `  page error: ${row.errors[0]}` : ""),
    );
  }
}
await browser.close();
sock.close();
if (OUT) fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const cell = (rs, k) => {
  const got = rs.map((r) => r[k]).filter((v) => v !== null);
  return got.length ? `${median(got)} [${Math.min(...got)} … ${Math.max(...got)}]` : "never";
};
console.log(`\nms from the cut, ${ROUNDS} rounds, interleaved`);
for (const arm of ARMS) {
  const rs = rows.filter((r) => r.arm === arm);
  const complete = rs.filter((r) => r.delivered === (ASKS || FILL)).length;
  const resumes = rs.map((r) => r.resumes);
  console.log(
    `  ${arm.padEnd(5)} noticed ${cell(rs, "noticedMs").padEnd(22)} first frame ${cell(rs, "firstAfterMs").padEnd(22)}` +
      ` took ${cell(rs, "tookMs").padEnd(26)} resumes ${resumes.join(",")}` +
      ` failed ${rs.map((r) => r.failures).join(",")} n=${rs.length}, completed ${complete}/${rs.length}`,
  );
}
