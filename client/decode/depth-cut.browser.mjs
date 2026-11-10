/**
 * A depth cut's frames decode through WebCodecs in headless Chromium: every frame of the fixture, a group of four
 * from its keyframe on, comes back on the av1-webcodecs path as 10-bit codes equal to native dav1d's; and a 12-bit
 * stored-form lossy frame is tried through WebCodecs first, refused, the refusal named, and only then handed to dav1d.
 * client/contract/av1/payloads/depth-cut, made by ingest/coded-frames/make_golden.py --depth-cut; plain/g12, 64×48.
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
  const stored = await page.evaluate(async (file) => {
    const calls = [];
    const dav1d = { init: async () => {}, picture: () => (calls.push("dav1d"), { width: 64, height: 48, bits: 12, planes: [{ heap: new Uint16Array(64 * 48), offset: 0, stride: 64 }] }) };
    const av1 = await import("/client/decode/av1.js?stored");
    await av1.init({ lossy: true }, async (p) => (p === "./av1-dav1d.js" ? dav1d : import(new URL(p, new URL("/client/decode/", location.href)).href)));
    const bytes = new Uint8Array(await (await fetch(file)).arrayBuffer());
    const out = [];
    for (let i = 0; i < 2; i++) {
      const r = await av1.decodeFrame(bytes).catch((e) => ({ path: e.message }));
      out.push({ path: r.path, refusal: r.refusal, calls: calls.splice(0).join() });
    }
    return out;
  }, "/client/contract/av1/payloads/plain/g12.av1");
  for (const [i, r] of stored.entries()) {
    const ok = r.path === "av1-dav1d" && /undecodable/.test(r.refusal ?? "") && r.calls === "dav1d";
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} 12-bit stored form, frame ${i}: ${r.path} after WebCodecs refused: ${r.refusal}`);
  }
} finally {
  await browser.close();
  host.close();
}
console.log(`depth cut through WebCodecs: ${failed ? `${failed} failed` : `${names.length} frames, every one dav1d's codes; the 12-bit stored form refused by it, then dav1d's`}`);
process.exit(failed ? 1 : 0);
