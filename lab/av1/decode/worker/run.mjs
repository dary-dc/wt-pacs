/**
 * DECODE: decode time a frame through the product's decoder worker, client/downloader before row 49 against after,
 * in headless Chromium. Every throttle is a fresh browser, in a Williams order every round; variants and sets rotate
 * inside it. lab/av1/decode/worker/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/decode/worker/run.mjs [--rounds 10] [--throttles 1,4]
 *     [--variants htj2k-before,htj2k-after,payload-before,payload-after] [--frames lab/.av1-work/decode/frames] [--sets a,b]
 *     [--mutate sample|truth] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 10));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const VARIANTS = arg("--variants", "htj2k-before,htj2k-after,payload-before,payload-after").split(",");
const FRAMES = arg("--frames", "lab/.av1-work/decode/frames");
const MUTATE = arg("--mutate", "").split(",").filter(Boolean);
const OUT = arg("--out", null);
const SETS = arg("--sets", null)?.split(",");
const ROOT = new URL("../../../..", import.meta.url).pathname;

const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer();
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/decode/worker/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const version = browser.version();
  const stop = throttleTree(server.process().pid, throttle);
  const rows = await page.evaluate((o) => globalThis.run(o), { frames: FRAMES, variants: VARIANTS, round, mutate: MUTATE, sets: SETS });
  stop();
  await browser.close();
  await server.close();
  return rows.map((r) => ({ ...r, version }));
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const throttle of order(THROTTLES, round)) {
    const got = await inChromium(throttle, round);
    for (const r of got) rows.push({ round, throttle, ...r });
    for (const r of got.filter((r) => r.error || r.exact !== r.frames)) {
      console.error(`round ${round} ${throttle}x ${r.set} ${r.variant}: ${r.exact}/${r.frames} exact ${r.error ?? ""}`);
    }
    console.error(`round ${round} ${throttle}x done (${got[0]?.version})`);
    if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
console.log("ms a frame: median over rounds of each round's median [range]; exact; after/before, the median of paired" +
  " round ratios [range], rounds after was faster");
const per = (sel) => new Map(rows.filter(sel).filter((r) => r.ms.length).map((r) => [r.round, med(r.ms)]));
for (const throttle of THROTTLES) {
  for (const set of [...new Set(rows.map((r) => r.set))]) {
    const at = (variant) => (r) => r.throttle === throttle && r.set === set && r.variant === variant;
    const parts = [];
    for (const variant of VARIANTS) {
      const rs = rows.filter(at(variant));
      if (!rs.length) continue;
      const m = per(at(variant));
      const exact = `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
      if (!m.size) { parts.push(`${variant} failed (${rs[0].error})`); continue; }
      const v = [...m.values()];
      let line = `${variant} ${f(med(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}] n=${v.length} exact ${exact}`;
      if (variant.endsWith("-after")) {
        const ref = per(at(variant.replace("-after", "-before")));
        const r = [...m].filter(([k]) => ref.has(k)).map(([k, x]) => x / ref.get(k));
        if (r.length) line += `, ×${med(r).toFixed(3)} [${Math.min(...r).toFixed(3)}–${Math.max(...r).toFixed(3)}] faster ${r.filter((x) => x < 1).length}/${r.length}`;
      }
      parts.push(line);
    }
    console.log(`${throttle}x ${set}:\n  ${parts.join("\n  ")}`);
  }
}
process.exit(0);
