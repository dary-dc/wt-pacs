/**
 * DECODE-OVERLAP's first step: of a frame's time on one WebCodecs decoder, the share after the frame is out (read
 * back, packed, checked). Rounds alternate the throttles' order; each round a fresh page. Rows as JSON lines.
 * docs/decode/README.md §The read-back's share
 *
 *   node lab/decode-bench/read-share/run.mjs SERIES.sbnd G [--throttles 1,4] [--rounds 4] [--out FILE]
 */
import { appendFileSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const [SERIES, G] = [resolve(process.argv[2]), Number(process.argv[3])];
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const ROUNDS = Number(arg("--rounds", "4"));
const OUT = arg("--out", null);
const ROOT = new URL("../../..", import.meta.url).pathname;
const { chromium } = createRequire(import.meta.url)("playwright");

const TYPES = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };
const server = createServer((req, res) => {
  const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cache-Control": "no-store" };
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = p === "/series.sbnd" ? SERIES : join(ROOT, p);
  try {
    if (!statSync(file).isFile()) throw new Error();
    res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  } catch {
    res.writeHead(404, headers).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/lab/decode-bench/read-share/index.html?series=/series.sbnd&g=${G}`;

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN; };
const browser = await chromium.launch();
let bad = 0;
for (let r = 0; r < ROUNDS; r++) {
  for (const throttle of r % 2 ? [...THROTTLES].reverse() : THROTTLES) {
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForFunction(() => globalThis.__go || globalThis.__result, null, { timeout: 60000 });
    // Chromium throttles the page's main thread, where page.js decodes; not the browser's own decode threads.
    await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await page.evaluate(() => globalThis.__go?.());
    await page.waitForFunction(() => globalThis.__result, null, { timeout: 600000, polling: 500 });
    const res = await page.evaluate(() => globalThis.__result);
    await page.close();
    if (res.error) throw new Error(res.error);
    // Frame 0 carries the decoder's configure; a group's last frame carries its flush after the read.
    const steady = res.rows.filter((x) => x.i > 0 && (x.i + 1) % G);
    const after = (x) => x.outToReturn + x.check;
    const share = steady.reduce((a, x) => a + after(x), 0) / steady.reduce((a, x) => a + x.total, 0);
    const exact = res.rows.filter((x) => x.exact).length;
    bad += res.rows.length - exact;
    const row = { series: SERIES.split("/").pop(), g: G, round: r, throttle, at: new Date().toISOString(), frames: res.rows.length, exact,
      routes: [...new Set(res.rows.map((x) => x.route))], share, medianTotalMs: median(steady.map((x) => x.total)),
      medianToOutMs: median(steady.map((x) => x.toOut)), medianAfterOutMs: median(steady.map(after)), rows: res.rows };
    if (OUT) appendFileSync(OUT, JSON.stringify(row) + "\n");
    console.log(`round ${r} ×${throttle}: share ${(100 * share).toFixed(1)} %, frame ${row.medianTotalMs.toFixed(1)} ms ` +
      `(to out ${row.medianToOutMs.toFixed(1)}, after ${row.medianAfterOutMs.toFixed(1)}), ${exact}/${res.rows.length} exact, ${row.routes}`);
  }
}
await browser.close();
server.close();
process.exit(bad ? 1 : 0);
