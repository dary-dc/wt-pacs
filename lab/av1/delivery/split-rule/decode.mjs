/**
 * SPLITTIME: decode time a frame through the product's decoder worker, each series' AV1 payloads at every
 * variant's split k (the payload picks WebCodecs or dav1d-WASM) against OpenJPH on the same frames. rep14's
 * harness, its frames now payloads. Every throttle cell is a fresh browser, in a Williams order every
 * round; variants and sets rotate inside it. lab/av1/delivery/split-rule/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/delivery/split-rule/decode.mjs [--rounds 12] [--throttles 1,4]
 *     [--frames lab/.av1-work/splittime] [--sets a,b] [--mutate sample|truth] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 12));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const FRAMES = arg("--frames", "lab/.av1-work/splittime");
const MUTATE = arg("--mutate", "").split(",").filter(Boolean);
const OUT = arg("--out", null);
const ROOT = new URL("../../../..", import.meta.url).pathname;
const SETS = arg("--sets", null)?.split(",");
const MANIFEST = JSON.parse(readFileSync(`${ROOT}/${FRAMES}/manifest.json`, "utf8"));
const VARIANTS = [...new Set(MANIFEST.flatMap((s) => Object.keys(s.variants)))];
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/delivery/split-rule/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const stop = throttleTree(server.process().pid, throttle);
  const rows = await page.evaluate((o) => globalThis.run(o), { frames: FRAMES, variants: VARIANTS, round, mutate: MUTATE, sets: SETS });
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const throttle of order(THROTTLES, round)) {
    const got = await inChromium(throttle, round);
    for (const r of got) rows.push({ round, throttle, ...r });
    for (const r of got.filter((r) => r.error || r.exact !== r.frames)) {
      console.error(`round ${round} ${throttle}x ${r.set} ${r.variant}: ${r.exact}/${r.frames} exact ${r.error ?? ""}`);
    }
    console.error(`round ${round} ${throttle}x done`);
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows));

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
const span = (a) => `[${Math.min(...a).toFixed(2)}–${Math.max(...a).toFixed(2)}]`;
console.log("ms a frame in its decoder: median over rounds of each round's median [range of round medians]; exact frames;" +
  " ×HTJ2K, the median of paired round ratios [range], and rounds faster than HTJ2K");
for (const throttle of THROTTLES) {
  for (const set of [...new Set(rows.map((r) => r.set))]) {
    const of = (variant) => rows.filter((r) => r.throttle === throttle && r.set === set && r.variant === variant);
    const per = (variant) => new Map(of(variant).filter((r) => r.ms.length).map((r) => [r.round, med(r.ms)]));
    const ref = per("htj2k");
    const parts = [];
    for (const variant of VARIANTS) {
      const rs = of(variant);
      if (!rs.length) continue;
      const m = per(variant);
      const exact = `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
      if (!m.size) { parts.push(`${variant} failed (${rs[0].error})`); continue; }
      const v = [...m.values()];
      let line = `${variant} ${f(med(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}] n=${v.length} exact ${exact}`;
      const ratio = (to) => [...m].filter(([r]) => to.has(r)).map(([r, x]) => x / to.get(r));
      if (variant !== "htj2k") {
        const r = ratio(ref);
        line += `, ×${med(r).toFixed(2)} HTJ2K ${span(r)}, faster ${r.filter((x) => x < 1).length}/${r.length}`;
      }
      parts.push(line);
    }
    console.log(`${throttle}x ${set}: ${parts.join(" · ")}`);
  }
}
process.exit(0);
