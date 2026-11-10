/**
 * A depth cut's frames decode through WebCodecs in headless Chromium: every frame of the fixture, a group of four
 * from its keyframe on, comes back on the av1-webcodecs path as 10-bit codes equal to native dav1d's.
 * client/contract/av1/payloads/depth-cut, made by ingest/coded-frames/make_golden.py --depth-cut.
 *
 *   NODE_PATH=$(npm root -g) node client/decode/depth-cut.browser.mjs
 */
import { createServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const FIXTURE = "client/contract/av1/payloads/depth-cut";
const isolated = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

const host = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  if (url === "/") return res.writeHead(200, { ...isolated, "Content-Type": "text/html" }).end("<!doctype html>");
  const body = url.startsWith("/client/") ? await readFile(path.join(ROOT, url)).catch(() => null) : null;
  if (!body) return res.writeHead(404, isolated).end();
  res.writeHead(200, { ...isolated, "Content-Type": url.endsWith(".js") ? "text/javascript" : "application/octet-stream" }).end(body);
});
await new Promise((r) => host.listen(0, "127.0.0.1", r));

const meta = JSON.parse(await readFile(path.join(ROOT, FIXTURE, "metadata.json"), "utf8"));
const names = (await readdir(path.join(ROOT, FIXTURE))).filter((f) => f.endsWith(".av1")).sort();
const want = await Promise.all(names.map(async (f) => (await readFile(path.join(ROOT, FIXTURE, f.replace(".av1", ".sha256")), "utf8")).trim()));

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
let failed = 0;
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${host.address().port}/`);
  const got = await page.evaluate(async ({ dir, names, g }) => {
    const av1 = await import("/client/decode/av1.js");
    await av1.init({ groupLength: g });
    const out = [];
    for (const [i, name] of names.entries()) {
      const bytes = new Uint8Array(await (await fetch(`/${dir}/${name}`)).arrayBuffer());
      try {
        const r = await av1.decodeFrame(bytes, { key: i % g === 0, index: i, gen: 0 });
        const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(r.sab).slice())), (b) => b.toString(16).padStart(2, "0")).join("");
        out.push({ path: r.path, bits: r.info.bitsPerSample, max: r.range.max, sha });
      } catch (e) {
        out.push({ error: e.message });
      }
    }
    return out;
  }, { dir: FIXTURE, names, g: meta.lossy.g });
  for (const [i, r] of got.entries()) {
    const ok = r.path === "av1-webcodecs" && r.bits === 10 && r.max <= 1023 && r.sha === want[i];
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} frame ${i}: ${r.error ?? `${r.path}, ${r.bits}-bit, max ${r.max}, ${r.sha === want[i] ? "dav1d's codes" : `sha ${r.sha}, not ${want[i]}`}`}`);
  }
  if (got.length !== meta.frameCount) failed++;
} finally {
  await browser.close();
  host.close();
}
console.log(`depth cut through WebCodecs: ${failed ? `${failed} failed` : `${names.length} frames, every one dav1d's codes`}`);
process.exit(failed ? 1 : 0);
