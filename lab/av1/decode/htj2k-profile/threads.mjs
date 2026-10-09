// A frame's decode with its code-blocks decoded by 1, 2 and 4 threads, against the unthreaded build,
// one frame at a time in a worker (an ask on an idle decoder). lab/av1/decode/htj2k-profile/README.md
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 8));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const VARIANTS = arg("--variants", "web,webpt,cb2,cb4").split(",");
const PASSES = Number(arg("--passes", 3));
const CORES = Number(arg("--cores", 4));
const FRAMES = arg("--frames", "lab/.av1-work/fasthtj2k");
const MUTATE = process.argv.includes("--mutate");
const OUT = arg("--out", null);
const ROOT = new URL("../../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;
const manifest = JSON.parse(readFileSync(`${ROOT}/${FRAMES}/manifest.json`, "utf8"));
const CHROME = process.env.CHROME_PATH || chromium.executablePath();
const WRAPPED = path.join(mkdtempSync(path.join(tmpdir(), "fasthtj2k-")), "chrome.sh");
writeFileSync(WRAPPED, `#!/bin/sh\nexec taskset -c 0-${CORES - 1} "${CHROME}" "$@"\n`, { mode: 0o755 });

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: WRAPPED });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/decode/htj2k-profile/threads.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const stop = throttleTree(server.process().pid, throttle, { cores: CORES });
  const rows = [];
  for (const s of order(manifest, round)) {
    const urls = s.frames.map((_, i) => `${BASE}/${FRAMES}/${s.name}/${String(i).padStart(3, "0")}.htj2k`);
    for (const a of order(VARIANTS, round)) {
      const r = await page.evaluate((o) => globalThis.variant(o), { glue: `${BASE}/lab/.openjph-build/wasm/${a}.js`, urls,
        truth: s.frames.map((f) => f.truth), passes: PASSES, mutate: MUTATE });
      rows.push({ round, throttle, set: s.name, variant: a, frames: urls.length, ...r });
      if (r.error || r.exact !== urls.length) console.error(`round ${round} ${throttle}x ${s.name} ${a}: ${r.exact}/${urls.length} ${r.error ?? ""}`);
    }
  }
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const rows = [];
const cells = THROTTLES.map((throttle) => ({ throttle }));
for (let round = 0; round < ROUNDS; round++) {
  for (const { throttle } of order(cells, round)) {
    rows.push(...await inChromium(throttle, round));
    console.error(`round ${round} ${throttle}x done`);
    if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => v.toFixed(v < 10 ? 2 : 1);
console.log(`ms a frame, median over rounds of each round's median [range]; × ${VARIANTS[0]} paired by round, rounds faster; exact`);
for (const { throttle } of cells) for (const s of manifest) {
  const of = (a) => rows.filter((r) => r.throttle === throttle && r.set === s.name && r.variant === a && r.ms);
  const ref = new Map(of(VARIANTS[0]).map((r) => [r.round, med(r.ms)]));
  for (const a of VARIANTS) {
    const all = rows.filter((r) => r.throttle === throttle && r.set === s.name && r.variant === a);
    const per = of(a).map((r) => med(r.ms));
    const ratio = of(a).filter((r) => ref.has(r.round)).map((r) => med(r.ms) / ref.get(r.round));
    console.log(`${throttle}× ${s.name} ${a}: ${per.length ? `${f(med(per))} [${f(Math.min(...per))}–${f(Math.max(...per))}]` : "failed"}` +
      ` ×${per.length ? med(ratio).toFixed(3) : "-"} faster ${ratio.filter((x) => x < 1).length}/${ratio.length}` +
      ` exact ${all.reduce((n, r) => n + (r.exact ?? 0), 0)}/${all.reduce((n, r) => n + r.frames, 0)}`);
  }
}
process.exit(0);
