/**
 * DECSPEED's screen: ms a frame for every encoder variant and thread count, one frame at a time through
 * the product's decoder worker in headless Chromium. Each (throttle) cell is a fresh browser, in a
 * Williams order every round; sets and arms rotate inside it. lab/av1/decspeed/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/decspeed/screen.mjs --arms htj2k,av1,av1-t4@2 [--rounds 8]
 *     [--throttles 1,4] [--cores 3] [--frames lab/.av1-work/decspeed] [--mutate sample|truth] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 8));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const ARMS = arg("--arms", "htj2k,av1").split(",");
const CORES = Number(arg("--cores", 3));
const FRAMES = arg("--frames", "lab/.av1-work/decspeed");
const MUTATE = arg("--mutate", "").split(",").filter(Boolean);
const OUT = arg("--out", null);
const ROOT = new URL("../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || chromium.executablePath();
/** Three cores at 1×, and at 4× three cores each a quarter as fast: threads and decoders share them. */
const WRAPPED = path.join(mkdtempSync(path.join(tmpdir(), "decspeed-")), "chrome.sh");
writeFileSync(WRAPPED, `#!/bin/sh\nexec taskset -c 0-${CORES - 1} "${CHROME}" "$@"\n`, { mode: 0o755 });

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: WRAPPED });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/decspeed/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const stop = throttleTree(server.process().pid, throttle, { cores: CORES });
  const rows = await page.evaluate((o) => globalThis.run(o), { frames: FRAMES, arms: ARMS, round, mutate: MUTATE });
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const cells = THROTTLES.map((throttle) => ({ throttle }));
const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const { throttle } of order(cells, round)) {
    const got = await inChromium(throttle, round);
    for (const r of got) rows.push({ round, throttle, ...r });
    for (const r of got.filter((r) => r.error || r.exact !== r.frames)) {
      console.error(`round ${round} ${throttle}x ${r.set} ${r.arm}: ${r.exact}/${r.frames} exact ${r.error ?? ""}`);
    }
    console.error(`round ${round} ${throttle}x done`);
    if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
console.log("ms a frame: median over rounds of each round's median [range of round medians]; × the base AV1 arm, paired by round; exact");
for (const { throttle } of cells) {
  for (const set of [...new Set(rows.map((r) => r.set))]) {
    const of = (arm) => rows.filter((r) => r.throttle === throttle && r.set === set && r.arm === arm && r.ms.length);
    const ref = new Map(of("av1").map((r) => [r.round, med(r.ms)]));
    for (const arm of ARMS) {
      const all = rows.filter((r) => r.throttle === throttle && r.set === set && r.arm === arm);
      const per = of(arm).map((r) => med(r.ms));
      const exact = `${all.reduce((n, r) => n + r.exact, 0)}/${all.reduce((n, r) => n + r.frames, 0)}`;
      if (!per.length) { console.log(`${throttle}x ${set} ${arm}: failed (${all[0]?.error}) exact ${exact}`); continue; }
      const ratios = of(arm).filter((r) => ref.has(r.round)).map((r) => med(r.ms) / ref.get(r.round));
      const x = ratios.length ? ` ×${med(ratios).toFixed(2)} [${Math.min(...ratios).toFixed(2)}–${Math.max(...ratios).toFixed(2)}]` : "";
      console.log(`${throttle}x ${set} ${arm}: ${f(med(per))} [${f(Math.min(...per))}–${f(Math.max(...per))}] n=${per.length}${x} exact ${exact}`);
    }
  }
}
process.exit(0);
