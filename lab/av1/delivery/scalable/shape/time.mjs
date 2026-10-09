/**
 * SVCSHAPE's decode time: dav1d-WASM (`simd-op`) on each q 40 shape's base and full operating point and
 * on single-layer lossless, in headless Chromium. Each throttle is a fresh browser each round, the
 * throttles and the sets in a Williams order (lab/order.mjs), the arms rotating inside. README.md here.
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/delivery/scalable/shape/time.mjs [--rounds 10] [--throttles 1,4]
 *     [--sets a,b] [--mutate sample] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../../order.mjs";
import { throttleTree } from "../../../../scripts/cpu_throttle.mjs";
import { SETS } from "./bench.mjs";

const require = createRequire(import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = new URL("../../../../..", import.meta.url).pathname;
const ROUNDS = Number(arg("--rounds", 10));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const NAMES = arg("--sets", SETS.join(",")).split(",");
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", null);
const PORT = 30000 + ((Math.random() * 10000) | 0);
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((ok) => setTimeout(ok, 1000));

async function inChromium(throttle, sets, r) {
  const { chromium } = require("playwright");
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/delivery/scalable/shape/index.html`);
  await page.waitForFunction(() => globalThis.ready);
  const stop = throttleTree(server.process().pid, throttle);
  const rows = await page.evaluate((o) => globalThis.run(o), { sets, r, mutate: MUTATE });
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const rows = [];
for (let r = 0; r < ROUNDS; r++) {
  for (const throttle of order(THROTTLES, r)) {
    for (const set of order(NAMES, r)) {
      rows.push(...(await inChromium(throttle, [set], r)).map((row) => ({ throttle, ...row })));
      if (OUT) writeFileSync(OUT, JSON.stringify(rows));
    }
    process.stderr.write(`round ${r} ${throttle}x done\n`);
  }
}

const median = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const groups = new Map();
for (const row of rows) {
  const k = [row.throttle, row.set, row.arm].join(" ");
  groups.set(k, [...(groups.get(k) ?? []), row]);
}
for (const [k, g] of groups) {
  const ms = g.map((x) => x.ms);
  const exact = g[0].exact === null ? "lossy" : `${g.reduce((n, x) => n + x.exact, 0)}/${g.reduce((n, x) => n + x.frames, 0)}`;
  console.log(`${k}\t${median(ms).toFixed(2)} [${Math.min(...ms).toFixed(2)}–${Math.max(...ms).toFixed(2)}] ms/frame\tn=${g.length}\t${g[0].size}\t${exact}`);
}
process.exit(0);
