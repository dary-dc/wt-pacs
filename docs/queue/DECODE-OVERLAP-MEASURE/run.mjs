/**
 * DECODE-OVERLAP-MEASURE's cells, arms interleaved in a Williams order each round, one browser per visit, a slow CPU
 * by lab/scripts/cpu_throttle.mjs over the browser's whole tree (decoder workers included). bench.js; README.md here.
 *
 *   NODE_PATH=$(npm root -g) node run.mjs --tip DIR --branch DIR --series DIR [--rounds 4] [--first-round 0] [--sets a,b] [--throttles 1,4] [--out rows.jsonl]
 */
import { appendFileSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const TIP = resolve(arg("--tip")), BRANCH = resolve(arg("--branch")), SERIES = resolve(arg("--series"));
const ROUNDS = Number(arg("--rounds", 4)), FIRST = Number(arg("--first-round", 0));
const SETS = arg("--sets", "dbts_a1-q8-g8-cut,dbts_b1-q8-g8,dbts_c1-q8-g8-cut").split(",");
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const CELLS = arg("--cells", "fill,ask0,ask3,ask7").split(",");
const OUT = arg("--out", null);
const HERE = new URL(".", import.meta.url).pathname;
const require = createRequire(join(TIP, "lab/"));
const { chromium } = require("playwright");
const { throttleTree } = await import(join(TIP, "lab/scripts/cpu_throttle.mjs"));
const { order } = await import(join(TIP, "lab/order.mjs"));

/** tip-aa is the tip's own files under another path: the A/A pair. */
const ROOTS = { tip: TIP, "tip-aa": TIP, branch: BRANCH, bench: HERE, s: SERIES };
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };
const httpServer = createServer((req, res) => {
  const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cache-Control": "no-store" };
  const [, top, ...rest] = decodeURIComponent(new URL(req.url, "http://x").pathname).split("/");
  const file = ROOTS[top] && join(ROOTS[top], ...rest);
  try {
    if (!file || !statSync(file).isFile()) throw new Error();
    res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  } catch {
    res.writeHead(404, headers).end();
  }
});
await new Promise((r) => httpServer.listen(0, "127.0.0.1", r));
const PORT = httpServer.address().port;

const ARMS = ["tip", "tip-aa", "branch"];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
const sums = {};

async function visit({ set, throttle, cell, arm }) {
  const ask = cell.startsWith("ask");
  const q = new URLSearchParams({ tree: arm, cell: ask ? "ask" : "fill", g: 8, decoders: 3, offset: ask ? cell.slice(3) : 0, series: `/s/${set}.sbnd` });
  const server = await chromium.launchServer();
  const browser = await chromium.connect(server.wsEndpoint());
  let stop = () => {};
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/bench/bench.html?${q}`);
    await page.waitForFunction(() => globalThis.__go || globalThis.__result, null, { timeout: 120000 });
    stop = throttleTree(server.process().pid, throttle);
    await page.evaluate(() => globalThis.__go?.());
    await page.waitForFunction(() => globalThis.__result, null, { timeout: 900000, polling: 200 });
    stop();
    stop = () => {};
    return await page.evaluate(() => globalThis.__result);
  } finally {
    stop();
    await browser.close();
    await server.close();
  }
}

let bad = 0;
for (let r = FIRST; r < FIRST + ROUNDS; r++) {
  const blocks = order(SETS.flatMap((set) => THROTTLES.flatMap((throttle) => CELLS.map((cell) => ({ set, throttle, cell })))), r);
  for (const [b, block] of blocks.entries()) {
    let prev = null;
    for (const [pos, arm] of order(ARMS, r * blocks.length + b).entries()) {
      const res = await visit({ ...block, arm });
      if (res.error) throw new Error(`${block.set} ${block.cell} ×${block.throttle} ${arm}: ${res.error}`);
      const key = `${block.set}`;
      const same = Object.entries(res.sums).every(([i, h]) => (sums[key] ??= {})[i] === undefined ? ((sums[key][i] = h), true) : sums[key][i] === h);
      if (!same || res.failures.length || res.routes.some((x) => x !== "av1-webcodecs")) bad += 1;
      const row = { ...block, arm, round: r, pos, prev, ms: res.spanMs ?? res.waitMs, frames: res.frames, sameSamples: same, failures: res.failures, routes: res.routes,
        medianDecodeMs: median(res.decodeMs), at: new Date().toISOString() };
      prev = arm;
      if (OUT) appendFileSync(OUT, JSON.stringify(row) + "\n");
      console.log(`round ${r} ${block.set} ×${block.throttle} ${block.cell} ${arm}: ${row.ms.toFixed(0)} ms, ${row.frames} frames, decode median ${row.medianDecodeMs.toFixed(0)} ms, ${same ? "samples as first seen" : "SAMPLES DIFFER"}${res.failures.length ? `, ${res.failures.length} failed` : ""}, ${res.routes}`);
    }
  }
}
httpServer.close();
process.exit(bad ? 1 : 0);
