/**
 * P-COPY: a frame through the delivered build, its -pthread build and P-COPY's (index.html), one decoder worker, every frame
 * checked against the encoder's input; a fresh Chromium per (round × throttle) in a Williams order, sets and variants
 * rotating inside it. --memory: every frame of a set decoded and kept, a fresh Chromium per (set × variant), the browser
 * tree's peak resident memory after. lab/decode-bench/copy/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/decode-bench/copy/run.mjs [--rounds 10] [--throttles 1,4] [--variants del,pt,copy]
 *     [--frames lab/.av1-work/emsdk] [--sets a,b] [--mutate sample|truth] [--memory] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 10));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const VARIANTS = arg("--variants", "del,pt,copy").split(",");
const FRAMES = arg("--frames", "lab/.av1-work/emsdk");
const MUTATE = arg("--mutate", "").split(",").filter(Boolean);
const OUT = arg("--out", null);
const SETS = arg("--sets", null)?.split(",");
const MEMORY = process.argv.includes("--memory");
const ROOT = new URL("../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

/** kB: each process's peak resident set (VmHWM) under `root`, summed — every process the browser started. */
function treePeakKb(root) {
  const parent = new Map();
  for (const p of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try { parent.set(Number(p), Number(readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" ")[1])); } catch { /* gone */ }
  }
  const under = (p) => { for (let q = p; q > 1; q = parent.get(q)) if (q === root) return true; return false; };
  let kb = 0;
  for (const p of [...parent.keys()].filter(under)) {
    try { kb += Number(/^VmHWM:\s+(\d+)/m.exec(readFileSync(`/proc/${p}/status`, "utf8"))[1]); } catch { /* gone */ }
  }
  return kb;
}

async function inChromium(throttle, work) {
  const server = await chromium.launchServer();
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/decode-bench/copy/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const stop = throttleTree(server.process().pid, throttle);
  try {
    return await work(page, server.process().pid);
  } finally {
    stop();
    await browser.close();
    await server.close();
  }
}

const sets = JSON.parse(readFileSync(`${ROOT}/${FRAMES}/manifest.json`, "utf8")).map((s) => s.name).filter((s) => !SETS || SETS.includes(s));
const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  if (MEMORY) {
    for (const set of order(sets, round)) {
      for (const variant of order(VARIANTS, round)) {
        const r = await inChromium(1, async (page, pid) => {
          const kept = await page.evaluate((o) => globalThis.keep(o), { frames: FRAMES, set, variant });
          return { kept, peakKb: treePeakKb(pid) };
        });
        rows.push({ round, set, variant, ...r });
        console.error(`round ${round} ${set} ${variant}: ${r.kept} kept, peak ${(r.peakKb / 1024).toFixed(1)} MB`);
      }
    }
  } else {
    for (const throttle of order(THROTTLES, round)) {
      const got = await inChromium(throttle, (page) =>
        page.evaluate((o) => globalThis.run(o), { frames: FRAMES, variants: VARIANTS, round, mutate: MUTATE, sets: SETS }));
      for (const r of got) rows.push({ round, throttle, ...r });
      for (const r of got.filter((r) => r.error || r.exact !== r.frames)) {
        console.error(`round ${round} ${throttle}x ${r.set} ${r.variant}: ${r.exact}/${r.frames} exact ${r.error ?? ""}`);
      }
      console.error(`round ${round} ${throttle}x done`);
    }
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(rows));
}
process.exit(0);
