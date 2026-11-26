/**
 * Each arm wired end to end in the real view worker: a second of cine on a quiet page, its log read back. Nothing timed.
 *   node lab/frame-clock/check.mjs [--browser chromium|firefox]
 */
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { ARMS } from "./arms.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const engine = process.argv.includes("--browser") ? process.argv[process.argv.indexOf("--browser") + 1] : "chromium";
const playwright = createRequire(import.meta.url)("playwright");

const port = 30000 + ((Math.random() * 20000) | 0);
const host = spawn("python3", ["server/dev-server.py", "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => host.kill());
await new Promise((r) => setTimeout(r, 700));
const browser = await playwright[engine].launch(engine === "firefox" ? { headless: false, firefoxUserPrefs: { "webgl.force-enabled": true } } : { channel: "chromium" });

/** What each arm's log must show: whether its ticks carry a vsync, and so whether they are rAF's. */
const VSYNC = { "page-raf": true, "page-raf′": true, "page-interval": false, "worker-raf": true, "worker-timeout": false, "worker-channel": false, "worker-wait": false };
/** ms: how far frame 0's due time may sit from the middle of its display interval, for a vsync log's jitter. */
const PHASE_SLACK_MS = 3;

/** How far `t0` is from halfway between the two vsyncs around it. */
function offMiddle(t0, vsyncs) {
  const k = vsyncs.findIndex((v) => v > t0);
  return k < 1 ? Infinity : Math.abs(t0 - (vsyncs[k - 1] + vsyncs[k]) / 2);
}

async function visit(arm, busy) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/lab/frame-clock/index.html?series=s512&fps=30&busy=${busy}&arm=${encodeURIComponent(arm)}&seconds=1`);
  const r = await page.evaluate(() => globalThis.__run);
  await page.close();
  return r;
}

let bad = 0;
for (const arm of ARMS) {
  const r = await visit(arm, 0);
  const d = r.draws ?? [];
  const problems = [
    r.error,
    ...(r.failures ?? []),
    d.length < 10 && `${d.length} paints in a second at 30/s`,
    d.some((e, k) => k && e.i <= d[k - 1].i) && "a frame painted twice or out of order",
    d.some((e) => e.tick < r.t0 + e.i * r.period) && "a frame painted before it was due",
    d.some((e) => (e.vsync !== null && e.vsync !== undefined) !== VSYNC[arm]) && `ticks ${VSYNC[arm] ? "without" : "with"} a vsync`,
    (r.vsyncs ?? []).length < 30 && "no display phase logged",
    offMiddle(r.t0, r.vsyncs ?? []) > PHASE_SLACK_MS && "frame 0 not due halfway between two vsyncs",
    r.tasks?.length && "long tasks on a quiet page",
  ].filter(Boolean);
  bad += problems.length > 0;
  console.log(`${arm.padEnd(15)} ${problems.length ? `FAIL ${problems.join("; ")}` : `ok, ${d.length} paints`}`);
}
const busy = await visit("page-raf", 1);
const busyOk = busy.tasks?.length >= 2 && Math.min(...busy.tasks) >= 200;
bad += !busyOk;
console.log(`busy page       ${busyOk ? `ok, ${busy.tasks.length} long tasks` : `FAIL long tasks ${JSON.stringify(busy.tasks ?? busy.error)}`}`);
await browser.close();
console.log(bad ? `${bad} arms not wired` : `all ${ARMS.length} arms wired (${engine})`);
process.exit(bad ? 1 : 0);
