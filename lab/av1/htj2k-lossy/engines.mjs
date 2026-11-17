// Cell E in a browser (docs/decode/mobile/htj2k-lossy.md §4): the pinned OpenJPH-WASM decodes the lossy frames in
// headless Chromium, through the client's own htj2k.js, and their samples' SHA-256 are printed for bench.mjs's.
//
//   node lab/av1/htj2k-lossy/engines.mjs STREAMS_DIR
import { createServer } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = new URL("../../../", import.meta.url).pathname;
const dir = process.argv[2];
const TYPES = { js: "text/javascript", mjs: "text/javascript", wasm: "application/wasm" };

const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  const file = path.startsWith("/streams/") ? `${dir}/${path.slice(9)}` : `${ROOT}${path.slice(1)}`;
  try {
    const body = path === "/" ? "<!doctype html><title>engines</title>" : readFileSync(file);
    // Cross-origin isolation: frame-buffer.js hands frames over in a SharedArrayBuffer.
    res.writeHead(200, { "Content-Type": path === "/" ? "text/html" : TYPES[file.split(".").pop()] ?? "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const names = readdirSync(dir).filter((f) => f.startsWith("lossy-") && f.endsWith(".j2c")).sort();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${base}/`);
const out = await page.evaluate(async (names) => {
  const { built } = await import("/client/decode/wasm-glue.js");
  const htj2k = await import("/client/decode/htj2k.js");
  await htj2k.init(await built("openjph"));
  const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
  const hashes = [];
  for (const n of names) {
    const f = htj2k.decodeFrame(new Uint8Array(await (await fetch(`/streams/${n}`)).arrayBuffer()));
    hashes.push(hex(await crypto.subtle.digest("SHA-256", new Uint8Array(f.sab, 0, f.byteCount).slice())));
  }
  return { ua: navigator.userAgent, hashes };
}, names);
console.log(JSON.stringify({ engine: "chromium", version: browser.version(), ...out }));
await browser.close();
server.close();
