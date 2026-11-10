/**
 * What an OPFS cache of decoded frames costs through FileSystemSyncAccessHandle in a dedicated
 * worker, one file per frame: handle, write, close and read-back per frame size, a nested worker,
 * three writers at once, a 1000-file listing and storage.estimate(). Each round is a fresh profile.
 * lab/target-review/opfs/README.md
 *
 *   node lab/target-review/opfs/run.mjs [--rounds 7] [--frames 20] [--browser chromium|firefox] [--profile DIR]
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const playwright = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 7));
const FRAMES = Number(arg("--frames", 20));
const BROWSER = arg("--browser", "chromium");
const PROFILES = arg("--profile", os.tmpdir());
const PORT = Number(arg("--port", 8781));
const SIZES = [524288, 1669104, 17039360];
const LABEL = { 524288: "CT 512² 16-bit", 1669104: "DBT 614×1359 16-bit", 17039360: "mammo 2560×3328 16-bit" };

const engine = playwright[BROWSER];
if (!fs.existsSync(engine.executablePath())) {
  console.log(`${BROWSER} was not run: no binary at ${engine.executablePath()}`);
  process.exit(0);
}

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript" };
// Cross-origin isolation only for the 5 µs worker clock; OPFS does not need it.
const server = http.createServer((req, res) => {
  const file = path.join(DIR, path.basename(new URL(req.url, "http://x").pathname));
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end();
    const coi = { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" };
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", ...coi }).end(data);
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const samples = {};
const errors = {};
const put = (cell, size, rows) => {
  const slot = (samples[cell] ??= {})[size] ??= {};
  for (const row of rows) for (const [k, v] of Object.entries(row)) (slot[k] ??= []).push(v);
};
const fail = (cell, size, err) => ((errors[cell] ??= {})[size] ??= []).push(String(err.message ?? err));
async function cell(name, size, run, pick = (r) => r.rows) {
  try { put(name, size, pick(await run())); } catch (err) { fail(name, size, err); }
}

let engineLine = "";
let estimate = null;
for (let round = 0; round < ROUNDS; round++) {
  const profile = fs.mkdtempSync(path.join(PROFILES, "opfs-probe-"));
  const ctx = await engine.launchPersistentContext(profile, { headless: true });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/page.html`);
  if (!round) engineLine = `${BROWSER} ${ctx.browser()?.version() ?? ""} — ${await page.evaluate(() => navigator.userAgent)}`;
  const probe = (req) => page.evaluate((r) => window.probe(r), req);
  if (!round) engineLine += `; crossOriginIsolated=${await page.evaluate(() => crossOriginIsolated)}`;
  const order = [...SIZES.slice(round % 3), ...SIZES.slice(0, round % 3)];
  for (const size of order) {
    const base = { size, frames: FRAMES };
    await cell("write", size, () => probe({ cmd: "write", series: `w${size}`, ...base }));
    await cell("read", size, () => probe({ cmd: "read", series: `w${size}`, ...base }));
    await cell("preopen", size, () => probe({ cmd: "write", series: `p${size}`, preopen: true, ...base }));
    await cell("nested", size, () => probe({ cmd: "nested", inner: { cmd: "write", series: `n${size}`, ...base } }));
    const three = [0, 1, 2].map((i) => ({ cmd: "write", series: `c${size}-${i}`, ...base }));
    await cell("three", size, () => page.evaluate((r) => window.probeEach(r), three), (rs) => rs.flatMap((r) => r.rows));
  }
  await cell("list", 1000, () => probe({ cmd: "list", count: 1000 }), (r) => [r]);
  estimate ??= await probe({ cmd: "estimate" });
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  console.error(`round ${round + 1}/${ROUNDS} done`);
}
server.close();

const stat = (xs) => { const s = [...xs].sort((a, b) => a - b); return { med: s[s.length >> 1], min: s[0], max: s[s.length - 1], n: s.length }; };
const ms = (v) => (v < 10 ? v.toFixed(3) : v.toFixed(1));
const span = (xs) => { const { med, min, max } = stat(xs); return `${ms(med)} [${ms(min)} … ${ms(max)}]`; };
const rate = (size, xs) => (size / stat(xs).med / 1000).toFixed(0);
const cols = { write: ["handle", "sync", "write", "close"], read: ["handle", "sync", "getSize", "read", "close"] };
const HEAD = { handle: "getFileHandle", sync: "createSyncAccessHandle", write: "write", read: "read", getSize: "getSize", close: "close" };

function table(name, keys, title) {
  const rows = SIZES.filter((s) => samples[name]?.[s]);
  if (!rows.length) return console.log(`\n### ${title}\n\nno sample: ${JSON.stringify(errors[name] ?? {})}`);
  const io = keys.includes("read") ? "read" : "write";
  console.log(`\n### ${title}\n`);
  console.log(`| frame | ${keys.map((k) => HEAD[k] + " ms").join(" | ")} | MB/s (${io} only) | MB/s (all steps) | n |`);
  console.log(`|---|${keys.map(() => "---:").join("|")}|---:|---:|---:|`);
  for (const s of rows) {
    const d = samples[name][s];
    const all = d[io].map((_, i) => keys.reduce((acc, k) => acc + d[k][i], 0));
    const err = errors[name]?.[s]?.length ? ` (${errors[name][s].length} errors)` : "";
    console.log(`| ${LABEL[s]} ${(s / 1e6).toFixed(2)} MB${err} | ${keys.map((k) => span(d[k])).join(" | ")} | ${rate(s, d[io])} | ${rate(s, all)} | ${d[io].length} |`);
  }
}

console.log(`engine: ${engineLine}`);
console.log(`host: ${os.cpus().length} cores, ${os.cpus()[0]?.model.trim()}, ${os.platform()} ${os.release()}; rounds ${ROUNDS}, frames ${FRAMES}; per-frame median [min … max] over all rounds; MB = 10^6 bytes`);
table("write", cols.write, "Sequential write, dedicated worker (handle created, then written, per frame)");
table("read", cols.read, "Read-back, dedicated worker (into one reused buffer)");
table("preopen", cols.write, `Pre-opened handles: all ${FRAMES} handles created while nothing else runs, then write+close each`);
table("nested", cols.write, `Nested worker (worker started by a worker): createSyncAccessHandle ${samples.nested ? "works" : "FAILED"}`);
table("three", cols.write, `Three workers writing different files at once (errors: ${JSON.stringify(errors.three ?? "none")})`);
const l = samples.list?.[1000];
console.log(`\n### Directory of 1000 files\n\n| step | ms |\n|---|---:|`);
if (l) console.log(`| create 1000 files (getFileHandle create:true, serial) | ${span(l.create)} |\n| for await (const k of dir.keys()) — ${stat(l.n).med} keys | ${span(l.keys)} |`);
else console.log(`| failed | ${JSON.stringify(errors.list)} |`);
console.log(`\n### navigator.storage.estimate() from the worker\n\n${JSON.stringify(estimate)}`);
if (Object.keys(errors).length) console.log(`\nerrors: ${JSON.stringify(errors)}`);
process.exit(0);
