/**
 * The page's time per decoded frame's message under Chromium's CPU throttle, by what the message
 * carries and how many frames it holds: port.html's variants, rotated with the throttles every round.
 * Charged from the trace: each message's dispatch, callback included. docs/ARCHITECTURE.md §The hand-off
 *
 *   NODE_PATH=$(npm root -g) node lab/downloader-campaign/port.mjs [--rounds 7] [--throttles 1,4,6]
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 7));
const THROTTLES = arg("--throttles", "1,4,6").split(",").map(Number);
/** [name, what the message carries, frames per message]; frames leave at the fill's pace either way. */
const ARMS = [["product", "product", 1], ["same SAB", "reused", 1], ["no SAB", "none", 1], ["no stamps", "bare", 1],
  ["two a message", "product", 2]];
const FRAMES = 80;
const EVERY_MS = 8;
const ROOT = new URL("../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });

async function cell(throttle, [, variant, per]) {
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await page.goto(`http://127.0.0.1:${PORT}/lab/downloader-campaign/port.html`);
  await page.waitForFunction(() => globalThis.ready);
  // Tiered up first, unthrottled and untraced: the question is the steady state.
  await page.evaluate(([v, p]) => globalThis.run(v, 40, 2, p), [variant, per]);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  const events = [];
  cdp.on("Tracing.dataCollected", (d) => events.push(...(d.value ?? [])));
  await cdp.send("Tracing.start", { categories: "toplevel,__metadata", transferMode: "ReportEvents" });
  await page.evaluate(([v, n, e, p]) => globalThis.run(v, n, e, p), [variant, FRAMES, EVERY_MS, per]);
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.end");
  await done;
  await page.close();
  const main = new Set(events.filter((e) => e.ph === "M" && e.args?.name === "CrRendererMain").map((e) => e.tid));
  const msgs = events.filter((e) => e.ph === "X" && main.has(e.tid) && e.name === "SimpleWatcher::OnHandleReady");
  return { ms: msgs.reduce((s, e) => s + e.dur, 0) / 1000 / FRAMES, messages: msgs.length };
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  const cells = THROTTLES.flatMap((t) => ARMS.map((a) => [t, a]));
  for (let k = 0; k < cells.length; k++) {
    const [throttle, arm] = cells[(k + round) % cells.length];
    rows.push({ round, throttle, arm: arm[0], ...(await cell(throttle, arm)) });
  }
}
await browser.close();

const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
console.log(`page time per frame, ms, ${FRAMES} frames every ${EVERY_MS} ms; median over ${ROUNDS} rounds (messages seen)`);
for (const throttle of THROTTLES) {
  const base = (r) => rows.find((b) => b.round === r.round && b.throttle === throttle && b.arm === ARMS[0][0]).ms;
  console.log(`${throttle}x  ` + ARMS.map(([name]) => {
    const rs = rows.filter((r) => r.throttle === throttle && r.arm === name);
    const less = name === ARMS[0][0] ? "" : `, less in ${rs.filter((r) => r.ms < base(r)).length}/${rs.length}`;
    return `${name} ${med(rs.map((r) => r.ms)).toFixed(3)} (${med(rs.map((r) => r.messages))}${less})`;
  }).join("   "));
}
process.exit(0);
