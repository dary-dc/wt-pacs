/**
 * HTJ2KENC: decode time a frame in Chromium of each encoder setting sweep.py wrote, through the product's
 * decoder worker. Every throttle cell a fresh browser in a Williams order each round; sets and settings
 * rotate inside it. lab/av1/bytes/htj2k-settings/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/bytes/htj2k-settings/time.mjs [--rounds 10] [--throttles 1,4]
 *     [--frames lab/.av1-work/htj2kenc] [--arms a,b] [--mutate sample|truth] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 10));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const FRAMES = arg("--frames", "lab/.av1-work/htj2kenc");
const MUTATE = arg("--mutate", "").split(",").filter(Boolean);
const OUT = arg("--out", null);
const SERVED = "b64x64-d5-RPCL";
const ARMS = arg("--arms", null)?.split(",") ?? [SERVED, "b32x32-d5-RPCL", "b32x128-d5-RPCL", "b128x32-d5-RPCL",
  "b64x64-d3-RPCL", "b64x64-d4-RPCL", "b64x64-d6-RPCL", "b64x64-d5-LRCP", `${SERVED}-p128`, "imagecodecs"];
const ROOT = new URL("../../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/bytes/htj2k-settings/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const stop = throttleTree(server.process().pid, throttle);
  const rows = await page.evaluate((o) => globalThis.run(o), { frames: FRAMES, arms: ARMS, round, mutate: MUTATE });
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const rows = [];
let inexact = 0;
for (let round = 0; round < ROUNDS; round++) {
  for (const throttle of order(THROTTLES, round)) {
    const got = await inChromium(throttle, round);
    for (const r of got) rows.push({ round, throttle, ...r });
    for (const r of got.filter((r) => r.error || r.exact !== r.frames)) {
      inexact++;
      console.error(`round ${round} ${throttle}x ${r.set} ${r.arm}: ${r.exact}/${r.frames} exact ${r.error ?? ""}`);
    }
    console.error(`round ${round} ${throttle}x done`);
    if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
console.log(`ms a frame: median of round medians [range]; exact frames; ×${SERVED}, the median of paired round ratios [range]`);
for (const throttle of THROTTLES) {
  for (const set of [...new Set(rows.map((r) => r.set))]) {
    const of = (arm) => rows.filter((r) => r.throttle === throttle && r.set === set && r.arm === arm);
    const per = (arm) => new Map(of(arm).filter((r) => r.ms.length).map((r) => [r.round, med(r.ms)]));
    const ref = per(SERVED);
    for (const arm of ARMS) {
      const rs = of(arm), m = per(arm);
      if (!m.size) continue;
      const v = [...m.values()];
      const exact = `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
      const r = [...m].filter(([k]) => ref.has(k)).map(([k, x]) => x / ref.get(k));
      console.log(`${throttle}x ${set} ${arm}\t${f(med(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}] n=${v.length} exact ${exact}` +
        `\t×${med(r).toFixed(3)} [${Math.min(...r).toFixed(3)}–${Math.max(...r).toFixed(3)}]`);
    }
  }
}
process.exit(inexact && !MUTATE.length ? 1 : 0);
