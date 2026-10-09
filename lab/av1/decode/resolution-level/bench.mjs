/**
 * RESLEVEL, decode only: a frame's whole codestream through the product's HTJ2K module against its level from the
 * same codestream and from its prefix, in headless Chromium. A fresh browser per throttle, throttles in a Williams
 * order every round; sets, frames and variants rotate inside it. lab/av1/decode/resolution-level/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/decode/resolution-level/bench.mjs [--rounds 10] [--first-round 0] [--throttles 1,4]
 *     [--frames lab/.av1-work/reslevel] [--sets a,b] [--mutate] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 10));
const FIRST = Number(arg("--first-round", 0));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const FRAMES = arg("--frames", "lab/.av1-work/reslevel");
const OUT = arg("--out", null);
const ROOT = new URL("../../../..", import.meta.url).pathname;
const SETS = arg("--sets", null)?.split(",") ?? readdirSync(path.join(ROOT, FRAMES)).filter((d) => existsSync(path.join(ROOT, FRAMES, d, "variants.json")));

const PORT = 30000 + ((Math.random() * 10000) | 0);
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer();
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/decode/resolution-level/bench.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) throw new Error("not cross-origin isolated");
  const version = browser.version();
  const stop = throttleTree(server.process().pid, throttle);
  const r = await page.evaluate((o) => globalThis.run(o), { frames: FRAMES, sets: SETS, round, mutate: process.argv.includes("--mutate") });
  stop();
  await browser.close();
  await server.close();
  if (r.error) throw new Error(r.error);
  return r.rows.map((x) => ({ ...x, version }));
}

// A run resumed with --first-round adds its rounds to the ones already in --out.
const rows = OUT && FIRST && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).filter((r) => r.round < FIRST) : [];
for (let round = FIRST; round < FIRST + ROUNDS; round++) {
  for (const throttle of order(THROTTLES, round)) {
    const got = await inChromium(throttle, round);
    for (const r of got) rows.push({ round, throttle, ...r });
    console.error(`round ${round} ${throttle}x: exact ${got.reduce((n, r) => n + r.exact, 0)}/${got.reduce((n, r) => n + r.frames, 0)} (${got[0]?.version})`);
    if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
console.log("ms a frame: median over rounds of each round's median [range]; level/whole and prefix/whole, the median of paired round ratios [range]");
for (const throttle of THROTTLES) {
  for (const set of SETS) {
    const of = (variant) => new Map(rows.filter((r) => r.throttle === throttle && r.set === set && r.variant === variant).map((r) => [r.round, med(r.ms)]));
    const exact = (variant) => { const rs = rows.filter((r) => r.throttle === throttle && r.set === set && r.variant === variant); return `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`; };
    const whole = of("whole");
    const parts = ["whole", "level", "prefix"].map((variant) => {
      const m = of(variant);
      const v = [...m.values()];
      let s = `${variant} ${f(med(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}] exact ${exact(variant)}`;
      if (variant !== "whole") {
        const q = [...m].filter(([k]) => whole.has(k)).map(([k, x]) => x / whole.get(k));
        s += ` ×${med(q).toFixed(3)} [${Math.min(...q).toFixed(3)}–${Math.max(...q).toFixed(3)}]`;
      }
      return s;
    });
    console.log(`${throttle}x ${set} n=${whole.size}: ${parts.join(" · ")}`);
  }
}
process.exit(0);
