/**
 * Stage 2 in headless Chromium: index.html's arms on each set's first frames, a fresh browser per throttle and round,
 * throttles in a Williams order. Pass 0 checks; passes 1..3 are timed. lab/htj2k-tiles/improve/README.md §Stage 2
 *
 *   NODE_PATH=$(npm root -g) node lab/htj2k-tiles/improve/decode/run.mjs [--rounds 10] [--first-round 0]
 *     [--throttles 1,4] [--per-set 8] [--mutate] [--level-build URL] --out rows.jsonl
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 10));
const FIRST = Number(arg("--first-round", 0));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const OUT = arg("--out", null);
const ROOT = new URL("../../../..", import.meta.url).pathname;
const SETS = ["dbts_a1/phone", "dbts_b1/phone", "dbts_c1/phone", "dbts_c1/sideways"];
const opts = { root: "lab/.av1-work/htj2k-improve", sets: SETS, perSet: Number(arg("--per-set", 8)), passes: 3,
  mutate: process.argv.includes("--mutate"), levelBuild: arg("--level-build", undefined) };

const PORT = 30000 + ((Math.random() * 10000) | 0);
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));
console.error(`host: ${os.cpus().length} × ${os.cpus()[0].model}`);

for (let round = FIRST; round < FIRST + ROUNDS; round++) {
  for (const throttle of order(THROTTLES, round)) {
    const server = await chromium.launchServer();
    const browser = await chromium.connect(server.wsEndpoint());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/lab/htj2k-tiles/improve/decode/index.html`);
    await page.waitForFunction(() => globalThis.ready !== undefined);
    const version = browser.version();
    const stop = throttleTree(server.process().pid, throttle);
    const r = await page.evaluate((o) => globalThis.run(o), { ...opts, round });
    stop();
    await browser.close();
    await server.close();
    if (r.error) throw new Error(r.error);
    if (OUT) appendFileSync(OUT, r.rows.map((x) => JSON.stringify({ round, throttle, version, ...x })).join("\n") + "\n");
    const timed = r.rows.filter((x) => x.pass > 0);
    console.error(`round ${round} ${throttle}x: exact ${r.rows.filter((x) => x.exact).length}/${r.rows.length} (${version}); timed ${timed.length}`);
  }
}
process.exit(0);
