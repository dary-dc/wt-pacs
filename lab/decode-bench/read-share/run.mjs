/**
 * Of a frame's time on one WebCodecs decoder, the share after its frame is out; `overlap`, each frame's samples
 * against the serial variant's. Rounds alternate the cells' order. docs/decode/README.md §The read-back's share
 *
 *   node lab/decode-bench/read-share/run.mjs SERIES.sbnd G [--throttles 1,4] [--variants serial,overlap] [--rounds 4] [--out FILE]
 */
import { appendFileSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const [SERIES, G] = [resolve(process.argv[2]), Number(process.argv[3])];
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const VARIANTS = arg("--variants", "serial").split(",");
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
const url = (v) => `http://127.0.0.1:${server.address().port}/lab/decode-bench/read-share/index.html?series=/series.sbnd&g=${G}&overlap=${v === "overlap" ? 1 : 0}`;
const cells = THROTTLES.flatMap((throttle) => VARIANTS.map((variant) => ({ throttle, variant })));
const sums = {};

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN; };
const browser = await chromium.launch();
let bad = 0;
for (let r = 0; r < ROUNDS; r++) {
  for (const { throttle, variant } of r % 2 ? [...cells].reverse() : cells) {
    const page = await browser.newPage();
    await page.goto(url(variant));
    await page.waitForFunction(() => globalThis.__go || globalThis.__result, null, { timeout: 60000 });
    // Chromium throttles the page's main thread, where page.js decodes; not the browser's own decode threads.
    await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await page.evaluate(() => globalThis.__go?.());
    await page.waitForFunction(() => globalThis.__result, null, { timeout: 600000, polling: 500 });
    const res = await page.evaluate(() => globalThis.__result);
    await page.close();
    if (res.error) throw new Error(res.error);
    const failures = res.rows.filter((x) => x.error);
    if (failures.length) throw new Error(`${variant}: frame ${failures[0].i}: ${failures[0].error}`);
    const same = res.rows.every((x) => (sums[x.i] ??= x.sum) === x.sum);
    if (!same) bad += 1;
    // Frame 0 carries the decoder's configure; a group's last frame carries its flush after the read.
    const steady = res.rows.filter((x) => x.i > 0 && (x.i + 1) % G);
    // decoder.js hashes only a frame its series has a digest for; a view series has none, so the hash is apart.
    const sum = (f) => steady.reduce((a, x) => a + f(x), 0);
    const share = sum((x) => x.outToReturn) / sum((x) => x.toOut + x.outToReturn);
    const shareChecked = sum((x) => x.outToReturn + x.check) / sum((x) => x.total);
    const exact = res.rows.filter((x) => x.exact).length;
    if (res.digested) bad += res.rows.length - exact;
    const row = { series: SERIES.split("/").pop(), g: G, round: r, throttle, variant, wallMs: res.wall, sameSamples: same, at: new Date().toISOString(), frames: res.rows.length, exact,
      routes: [...new Set(res.rows.map((x) => x.route))], digested: res.digested, share, shareChecked,
      medianFrameMs: median(steady.map((x) => x.toOut + x.outToReturn)), medianToOutMs: median(steady.map((x) => x.toOut)),
      medianOutToReturnMs: median(steady.map((x) => x.outToReturn)), medianCheckMs: median(steady.map((x) => x.check)),
      medianSentToOutMs: median(steady.map((x) => x.decodeMs)), medianSentAfterMs: median(steady.map((x) => x.sentAfter)), rows: res.rows };
    if (OUT) appendFileSync(OUT, JSON.stringify(row) + "\n");
    const pct = (x) => `${(100 * x).toFixed(1)} %`;
    console.log(`round ${r} ×${throttle} ${variant}: span ${res.wall.toFixed(0)} ms, samples ${same ? "as the first round's" : "DIFFER"}, share ${pct(share)} (${pct(shareChecked)} with the hash), frame ${row.medianFrameMs.toFixed(1)} ms ` +
      `(to out ${row.medianToOutMs.toFixed(1)}, out to return ${row.medianOutToReturnMs.toFixed(1)}, hash ${row.medianCheckMs.toFixed(1)}; sent +${row.medianSentAfterMs.toFixed(1)}, sent to out ${row.medianSentToOutMs.toFixed(1)}), ` +
      `${res.digested ? `${exact}/${res.rows.length} exact` : "no digests"}, ${row.routes}`);
  }
}
await browser.close();
server.close();
process.exit(bad ? 1 : 0);
