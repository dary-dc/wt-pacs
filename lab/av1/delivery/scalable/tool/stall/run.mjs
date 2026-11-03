/**
 * The failed visit reproduced: a group's exact frames through the product's AV1 path in headless Chromium, every
 * thread capped by lab/scripts/cpu_throttle.mjs. README §The failed visit.
 *
 *   node make_group.mjs WORK
 *   NODE_PATH=$(npm root -g) node run.mjs WORK [--rate 4] [--stall-ms 10000] [--hole 3] [--frames 16]
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { throttleTree } from "../../../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const work = path.resolve(process.argv[2]);
const ROOT = new URL("../../../../../..", import.meta.url).pathname;
const HERE = new URL(".", import.meta.url).pathname;
const opts = { n: Number(arg("--frames", 16)), stallMs: Number(arg("--stall-ms", 0)) || undefined,
  hole: arg("--hole") === undefined ? undefined : Number(arg("--hole")) };

// SharedArrayBuffer, which av1-frame.js writes into, needs a cross-origin-isolated page.
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  const f = u.startsWith("/work/") ? path.join(work, u.slice(6)) : u.startsWith("/stall/") ? path.join(HERE, u.slice(7)) : path.join(ROOT, u);
  if (!fs.existsSync(f)) return s.writeHead(404).end();
  const h = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp",
    "Content-Type": f.endsWith(".js") ? "text/javascript" : f.endsWith(".html") ? "text/html" : "application/octet-stream" };
  const m = /bytes=(\d+)-(\d+)/.exec(q.headers.range ?? "");
  if (!m) return fs.createReadStream(f).pipe(s.writeHead(200, h));
  s.writeHead(206, { ...h, "Content-Range": `bytes ${m[1]}-${m[2]}/${fs.statSync(f).size}` });
  fs.createReadStream(f, { start: +m[1], end: +m[2] }).pipe(s);
}).listen(0);
const browserServer = await chromium.launchServer();
const browser = await chromium.connect(browserServer.wsEndpoint());
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/stall/page.html`);
await page.waitForFunction(() => window.run);
const stop = throttleTree(browserServer.process().pid, Number(arg("--rate", 4)));
const out = await page.evaluate((o) => window.run(o), opts);
stop();
console.log(JSON.stringify({ chromium: browser.version(), rate: Number(arg("--rate", 4)), ...opts, out }));
await browser.close();
await browserServer.close();
server.close();
