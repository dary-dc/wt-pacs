/**
 * Row CARRIERS, amended (docs/av1/profile-carriers.md §Profile carriers protocol, amended): each (round, volume,
 * block) in a fresh headless Chromium at 1×, the blocks of a round in a Williams order (lab/order.mjs). Rows go to
 * --out as JSON lines after every block.
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/delivery/carriers/amended.mjs --work lab/.av1-work/amended --first-round 0
 *     [--rounds 1] [--sets dbts_a1,dbts_b1,dbts_c1] [--points 1,4,8,16] [--arms a,b]
 *     [--mutate sample|truth|offset|skip|low|dwell] [--out rows.jsonl]
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";

const require = createRequire(import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = new URL("../../../..", import.meta.url).pathname;
const WORK = arg("--work", "lab/.av1-work/amended");
const ROUNDS = Number(arg("--rounds", 1));
const FIRST = Number(arg("--first-round", 0));
const SETS = arg("--sets", "dbts_a1,dbts_b1,dbts_c1").split(",");
const POINTS = arg("--points", "1,4,8,16").split(",").map(Number);
const ARMS = arg("--arms", "") ? arg("--arms", "").split(",") : undefined;
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", null);
const PORT = 30000 + ((Math.random() * 10000) | 0);
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((ok) => setTimeout(ok, 1000));

/** A block past this is VOID: its browser is closed and the campaign goes on. */
const BLOCK_MS = 15 * 60 * 1000;

async function inChromium(set, point, r) {
  const { chromium } = require("playwright");
  const server = await chromium.launchServer({
    executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    args: ["--js-flags=--expose-gc"],
  });
  const timer = setTimeout(() => server.kill(), BLOCK_MS);
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  if (process.env.VERBOSE) page.on("console", (m) => process.stderr.write(`  ${new Date().toISOString().slice(11, 19)} ${m.text()}\n`));
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/delivery/carriers/amended.html`);
  await page.waitForFunction(() => globalThis.ready);
  try {
    return await page.evaluate((o) => globalThis.run(o), { work: WORK, set, point, r, mutate: MUTATE, arms: ARMS });
  } finally {
    clearTimeout(timer);
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

const blocks = SETS.flatMap((set) => POINTS.map((point) => [set, point]));
for (let r = FIRST; r < FIRST + ROUNDS; r++) {
  const t0 = Date.now();
  for (const [set, point] of order(blocks, r)) {
    const t1 = Date.now();
    let rows;
    try {
      rows = (await inChromium(set, point, r)).map((row) => ({ mutate: MUTATE || null, ...row }));
    } catch (e) {
      rows = [{ mutate: MUTATE || null, set, block: point, round: r, void: String(e).slice(0, 200) }];
    }
    if (OUT) appendFileSync(OUT, rows.map((x) => JSON.stringify(x) + "\n").join(""));
    const bad = rows.filter((x) => x.void || x.error || x.exact === false || x.lossy === false || (x.frames && (x.lossy ?? x.exact) < x.frames));
    process.stderr.write(`round ${r} ${set} k${point}: ${rows.length} rows, ${bad.length} failing a check or VOID, ${((Date.now() - t1) / 60000).toFixed(1)} min\n`);
  }
  process.stderr.write(`round ${r}: ${((Date.now() - t0) / 60000).toFixed(1)} min\n`);
}
process.exit(0);
