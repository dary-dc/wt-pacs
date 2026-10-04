/**
 * WCBASE in headless Chromium: `--check` decodes every unit of every set once (conformance, `--mutate`
 * to break it on purpose); otherwise each throttle is a fresh browser each round, the cells in a
 * Williams order (lab/order.mjs), sets and arms rotating inside. README.md here.
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/wcbase/time.mjs --check [--mutate keep-top|drop-base|sample]
 *   NODE_PATH=$(npm root -g) node lab/av1/wcbase/time.mjs [--rounds 15] [--throttles 1,4] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const require = createRequire(import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = new URL("../../..", import.meta.url).pathname;
const CHECK = process.argv.includes("--check");
const NAMES = arg("--sets", CHECK
  ? "us_liver,synthetic-grey10,synthetic-rgb8,rf_fluoro-top10,mr_ispy1-top10,rf_fluoro,mr_ispy1"
  : "us_liver,rf_fluoro-top10,mr_ispy1-top10").split(",");
const CODINGS = CHECK ? ["half", "half-g1", "full-g1"] : ["half-g1", "full-g1"];
const ROUNDS = CHECK ? 1 : Number(arg("--rounds", 15));
const THROTTLES = CHECK ? [1] : arg("--throttles", "1,4").split(",").map(Number);
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", null);
const PORT = 30000 + ((Math.random() * 10000) | 0);
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((ok) => setTimeout(ok, 1000));

async function inChromium(throttle, r) {
  const { chromium } = require("playwright");
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  page.on("pageerror", (e) => process.stderr.write(`page: ${e}\n`));
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/wcbase/index.html`);
  await page.waitForFunction(() => globalThis.ready);
  const stop = throttleTree(server.process().pid, throttle);
  const rows = [];
  // One set a call keeps a page's memory to one set's pictures.
  for (const name of order(NAMES, r)) {
    rows.push(...await page.evaluate((o) => globalThis.run(o),
      { names: [name], codings: CODINGS, frames: CHECK ? null : 18, r, opts: { mutate: MUTATE, warm: !CHECK } }));
  }
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const cells = THROTTLES.map((throttle) => ({ throttle }));
const rows = [];
for (let r = 0; r < ROUNDS; r++) {
  for (const { throttle } of order(cells, r)) {
    rows.push(...(await inChromium(throttle, r)).map((row) => ({ throttle, ...row })));
    process.stderr.write(`round ${r} ${throttle}x done\n`);
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows));

const median = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const groups = new Map();
for (const row of rows) {
  const k = [row.throttle, row.set, row.coding, row.arm].join(" ");
  groups.set(k, [...(groups.get(k) ?? []), row]);
}
const sum = (g, f) => g.reduce((n, x) => n + x[f], 0);
for (const [k, g] of groups) {
  const ms = g.map((x) => x.ms).filter((x) => x !== null);
  const time = ms.length ? `${median(ms).toFixed(2)} [${Math.min(...ms).toFixed(2)}–${Math.max(...ms).toFixed(2)}]` : "-";
  const err = g.find((x) => x.errors.length)?.errors[0] ?? "";
  console.log(`${k}\t${time} ms/frame\tn=${ms.length}\tunits ${sum(g, "units")}\tfiltered=alone ${sum(g, "sameAsAlone")}` +
    `\tlate ${sum(g, "late")}\tbase ${sum(g, "baseExact")}/${sum(g, "bases")}\ttop ${sum(g, "topExact")}/${sum(g, "tops")}\t${err}`);
}
process.exit(0);
