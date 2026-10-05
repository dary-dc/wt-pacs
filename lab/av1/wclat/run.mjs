/**
 * WCLAT: WebCodecs' AV1 decoder with and without a flush per unit, in headless Chromium at 1× and 4×.
 * Each (round × throttle) is a fresh browser in a Williams order; streams and arms rotate inside it.
 * lab/av1/wclat/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/wclat/run.mjs [--arms flush,latency,keyflush,hold] [--rounds 10]
 *     [--throttles 1,4] [--streams a,b] [--wait-ms 1000] [--cores 3] [--dir lab/.av1-work/wclat]
 *     [--mutate] [--out rows.json]
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
const ROUNDS = Number(arg("--rounds", 10));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const ARMS = arg("--arms", "flush,latency").split(",");
const NAMES = arg("--streams", null)?.split(",");
const WAIT = Number(arg("--wait-ms", 1000));
const CORES = Number(arg("--cores", 3));
const DIR = arg("--dir", "lab/.av1-work/wclat");
const MUTATE = process.argv.includes("--mutate");
const OUT = arg("--out", null);
const ROOT = new URL("../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const CHROME = process.env.CHROME_PATH || chromium.executablePath();
const WRAPPED = path.join(mkdtempSync(path.join(tmpdir(), "wclat-")), "chrome.sh");
writeFileSync(WRAPPED, `#!/bin/sh\nexec taskset -c 0-${CORES - 1} "${CHROME}" "$@"\n`, { mode: 0o755 });

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: WRAPPED });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/wclat/index.html`);
  await page.waitForFunction(() => globalThis.ready);
  const stop = throttleTree(server.process().pid, throttle, { cores: CORES });
  const rows = await page.evaluate((o) => globalThis.run(o),
    { dir: `/${DIR}`, names: NAMES, arms: ARMS, round, mutate: MUTATE, waitMs: WAIT * throttle });
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const throttle of order(THROTTLES, round)) {
    for (const r of await inChromium(throttle, round)) {
      rows.push({ round, throttle, ...r });
      if (r.errors.length || r.exact !== r.expected || r.perUnit !== r.expected) {
        console.error(`round ${round} ${throttle}x ${r.stream} ${r.arm}: ${r.perUnit}/${r.expected} out per unit, ` +
          `${r.exact}/${r.expected} exact ${r.errors[0] ?? ""}`);
      }
    }
    console.error(`round ${round} ${throttle}x done`);
    if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
console.log("per stream and arm: frames out per unit, exact; ms decode() to output, median over rounds of each round's median [range]; × flush, paired by round");
for (const throttle of THROTTLES) {
  for (const stream of [...new Set(rows.map((r) => r.stream))]) {
    const of = (arm) => rows.filter((r) => r.throttle === throttle && r.stream === stream && r.arm === arm);
    const ref = new Map(of("flush").filter((r) => r.ms.length).map((r) => [r.round, med(r.ms)]));
    for (const arm of ARMS) {
      const all = of(arm);
      const sum = (k) => all.reduce((n, r) => n + r[k], 0);
      let s = `${throttle}x ${stream} ${arm}: out per unit ${sum("perUnit")}/${sum("expected")}, exact ${sum("exact")}/${sum("expected")}`;
      const per = all.filter((r) => r.ms.length).map((r) => med(r.ms));
      if (per.length) s += `, ${f(med(per))} ms [${f(Math.min(...per))}–${f(Math.max(...per))}] n=${per.length}`;
      const x = all.filter((r) => r.ms.length && ref.has(r.round)).map((r) => med(r.ms) / ref.get(r.round));
      if (arm !== "flush" && x.length) s += ` ×${med(x).toFixed(2)} [${Math.min(...x).toFixed(2)}–${Math.max(...x).toFixed(2)}]`;
      if (all[0]) s += `, ${all[0].bytes} B`;
      console.log(s);
    }
  }
}
process.exit(0);
