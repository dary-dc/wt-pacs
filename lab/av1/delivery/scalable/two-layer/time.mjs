/**
 * SVCQ's decode time: dav1d-WASM (`simd-op`) on the base alone, both layers and single-layer lossless,
 * WebCodecs beside it on the 8-bit series. Every (environment × throttle) cell is a fresh process each
 * round, the cells in a Williams order (lab/order.mjs); sets and arms rotate inside. README.md here.
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/delivery/scalable/two-layer/time.mjs [--rounds 15] [--throttles 1,4]
 *     [--envs node,chromium] [--mutate sample] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../../order.mjs";
import { throttleTree } from "../../../../scripts/cpu_throttle.mjs";
import { prepare, round, SETS } from "./bench.mjs";

const require = createRequire(import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = new URL("../../../../..", import.meta.url).pathname;
const NAMES = Object.keys(SETS);

if (arg("--child")) {
  const { r, mutate } = JSON.parse(arg("--child"));
  const sets = await prepare(async (p) => new Uint8Array(readFileSync(ROOT + p)), NAMES, false);
  const factory = require(`${ROOT}lab/.av1-build/out/simd-op.js`);
  process.stdout.write(JSON.stringify(await round({ dav1d: factory }, sets, r, mutate)));
  process.exit(0);
}

const ROUNDS = Number(arg("--rounds", 15));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const ENVS = arg("--envs", "node,chromium").split(",");
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", null);
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((ok) => setTimeout(ok, 1000));

async function inNode(throttle, r) {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, "--child", JSON.stringify({ r, mutate: MUTATE })],
    { stdio: ["ignore", "pipe", "inherit"] });
  const stop = throttleTree(child.pid, throttle);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  await new Promise((ok) => child.once("exit", ok));
  stop();
  return JSON.parse(out);
}

async function inChromium(throttle, r) {
  const { chromium } = require("playwright");
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/delivery/scalable/two-layer/index.html`);
  await page.waitForFunction(() => globalThis.ready);
  const stop = throttleTree(server.process().pid, throttle);
  const rows = await page.evaluate((o) => globalThis.run(o), { sets: NAMES, r, mutate: MUTATE });
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const cells = ENVS.flatMap((env) => THROTTLES.map((throttle) => ({ env, throttle })));
const rows = [];
for (let r = 0; r < ROUNDS; r++) {
  for (const { env, throttle } of order(cells, r)) {
    const got = await (env === "node" ? inNode : inChromium)(throttle, r);
    rows.push(...got.map((row) => ({ env, throttle, ...row })));
    process.stderr.write(`round ${r} ${env} ${throttle}x done\n`);
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows));

const median = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const groups = new Map();
for (const row of rows) {
  const k = [row.env, row.throttle, row.set, row.arm].join(" ");
  groups.set(k, [...(groups.get(k) ?? []), row]);
}
for (const [k, g] of groups) {
  const ms = g.map((x) => x.ms);
  const exact = g[0].exact === null ? "lossy" : `${g.reduce((n, x) => n + x.exact, 0)}/${g.reduce((n, x) => n + x.frames, 0)}`;
  console.log(`${k}\t${median(ms).toFixed(2)} [${Math.min(...ms).toFixed(2)}–${Math.max(...ms).toFixed(2)}] ms/frame\tn=${g.length}\t${g[0].size}\t${exact}`);
}
process.exit(0);
