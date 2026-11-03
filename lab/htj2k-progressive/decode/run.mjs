/**
 * Stage 2, decode only, in headless Chromium: worker.js's arms on each set's first 16 frames. A fresh browser per
 * throttle, throttles in a Williams order every round; sets, frames and arms rotate inside it. lab/htj2k-progressive/README.md §Stage 2
 *
 *   NODE_PATH=$(npm root -g) node lab/htj2k-progressive/decode/run.mjs [--rounds 6] [--first-round 0] [--throttles 1,4]
 *     [--frames lab/.av1-work/hp/ladder] [--sets a,b] [--per-set 16] [--mutate] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 6));
const FIRST = Number(arg("--first-round", 0));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const FRAMES = arg("--frames", "lab/.av1-work/hp/ladder");
const PER_SET = Number(arg("--per-set", 16));
const OUT = arg("--out", null);
const ROOT = new URL("../../..", import.meta.url).pathname;
const SETS = arg("--sets", null)?.split(",") ?? readdirSync(path.join(ROOT, FRAMES)).filter((d) => existsSync(path.join(ROOT, FRAMES, d, "cuts.json")));

const PORT = 30000 + ((Math.random() * 10000) | 0);
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer();
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/lab/htj2k-progressive/decode/index.html`);
  await page.waitForFunction(() => globalThis.ready !== undefined);
  const version = browser.version();
  const stop = throttleTree(server.process().pid, throttle);
  const r = await page.evaluate((o) => globalThis.run(o), { frames: FRAMES, sets: SETS, round, perSet: PER_SET, mutate: process.argv.includes("--mutate") });
  stop();
  await browser.close();
  await server.close();
  if (r.error) throw new Error(r.error);
  return r.rows.map((x) => ({ ...x, version }));
}

const rows = OUT && FIRST && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).filter((r) => r.round < FIRST) : [];
for (let round = FIRST; round < FIRST + ROUNDS; round++) {
  for (const throttle of order(THROTTLES, round)) {
    const got = await inChromium(throttle, round);
    for (const r of got) rows.push({ round, throttle, ...r });
    console.error(`round ${round} ${throttle}x: exact ${got.reduce((n, r) => n + r.exact, 0)}/${got.reduce((n, r) => n + r.pictures, 0)} pictures (${got[0]?.version})`);
    if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  }
}
process.exit(0);
