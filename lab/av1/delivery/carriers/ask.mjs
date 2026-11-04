/**
 * Row CARRIERS' browser rounds (docs/av1/profile-carriers.md §4): each (round, throttle, volume) a fresh headless
 * Chromium, throttles and volumes in a Williams order (lab/order.mjs), the arms inside it in one too. Rows go to
 * --out as JSON lines after every volume.
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/delivery/carriers/ask.mjs --work lab/.av1-work/carriers [--rounds 10]
 *     [--first-round 0] [--throttles 1,4] [--sets dbts_a1,dbts_b1,dbts_c1] [--arms a,b] [--mutate sample|truth|offset|skip|low]
 *     [--out rows.jsonl]
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const require = createRequire(import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = new URL("../../../..", import.meta.url).pathname;
const WORK = arg("--work", "lab/.av1-work/carriers");
const ROUNDS = Number(arg("--rounds", 10));
const FIRST = Number(arg("--first-round", 0));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const SETS = arg("--sets", "dbts_a1,dbts_b1,dbts_c1").split(",");
const ARMS = arg("--arms", "") ? arg("--arms", "").split(",") : undefined;
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", null);
const PORT = 30000 + ((Math.random() * 10000) | 0);
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((ok) => setTimeout(ok, 1000));

async function inChromium(throttle, set, r) {
  const { chromium } = require("playwright");
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/delivery/carriers/index.html`);
  await page.waitForFunction(() => globalThis.ready);
  const stop = throttleTree(server.process().pid, throttle);
  try {
    return await page.evaluate((o) => globalThis.run(o), { work: WORK, set, r, mutate: MUTATE, arms: ARMS });
  } finally {
    stop();
    await browser.close();
    await server.close();
  }
}

for (let r = FIRST; r < FIRST + ROUNDS; r++) {
  const t0 = Date.now();
  for (const throttle of order(THROTTLES, r)) {
    for (const set of order(SETS, r)) {
      const rows = (await inChromium(throttle, set, r)).map((row) => ({ throttle, mutate: MUTATE || null, ...row }));
      if (OUT) appendFileSync(OUT, rows.map((x) => JSON.stringify(x) + "\n").join(""));
      const bad = rows.filter((x) => x.exact === false || x.lossy === false || (x.frames && x.lossy < x.frames));
      process.stderr.write(`round ${r} ${throttle}x ${set}: ${rows.length} rows, ${bad.length} failing a check\n`);
    }
  }
  process.stderr.write(`round ${r}: ${((Date.now() - t0) / 60000).toFixed(1)} min\n`);
}
process.exit(0);
