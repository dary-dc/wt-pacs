// What checking a shown frame costs: five hashes against the decode, and a decode-bound fill with and without
// the check, in headless Chromium at 1× and 4×. lab/av1/exactprod/README.md
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 10));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const PASSES = Number(arg("--passes", 3));
const CORES = Number(arg("--cores", 4));
const DECODERS = Number(arg("--decoders", 3));
const COPIES = Number(arg("--copies", 6));
const FRAMES = arg("--frames", "lab/.av1-work/exactprod");
const MUTATE = process.argv.includes("--mutate");
const OUT = arg("--out", null);
const ARMS = ["decode", "sha256-webcrypto", "sha256-wasm", "blake3-wasm", "xxh3-wasm", "crc32-wasm"];
const POOL = ["none", "sha256-webcrypto", "blake3-wasm", "xxh3-wasm"];
const ROOT = new URL("../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;
const manifest = JSON.parse(readFileSync(`${ROOT}/${FRAMES}/manifest.json`, "utf8"));
const glue = `${BASE}/lab/decode-bench/vendor/openjph/openjphjs.js`;
const hashWasm = `${BASE}/lab/.av1-build/hash-wasm/index.umd.min.js`;
const CHROME = process.env.CHROME_PATH || chromium.executablePath();
const WRAPPED = path.join(mkdtempSync(path.join(tmpdir(), "exactprod-")), "chrome.sh");
writeFileSync(WRAPPED, `#!/bin/sh\nexec taskset -c 0-${CORES - 1} "${CHROME}" "$@"\n`, { mode: 0o755 });

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

const urls = (s) => s.frames.map((_, i) => `${BASE}/${FRAMES}/${s.name}/${String(i).padStart(3, "0")}.${s.raw ? "raw" : "htj2k"}`);
let failures = 0;

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: WRAPPED });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/exactprod/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  if (!round) console.log(`WebCrypto on shared memory: ${await page.evaluate(() => globalThis.sharedDigest())}`);
  const stop = throttleTree(server.process().pid, throttle, { cores: CORES });
  const rows = [];
  for (const s of order(manifest, round)) {
    const r = await page.evaluate((o) => globalThis.bench(o), { glue, hashWasm, urls: urls(s), raw: !!s.raw,
      frames: s.frames, order: order(ARMS, round), passes: PASSES, mutate: MUTATE });
    if (r.error) throw new Error(r.error);
    for (const a of ARMS) {
      if (a === "decode" && s.raw) continue;
      rows.push({ kind: "hash", round, throttle, set: s.name, arm: a, frames: s.frames.length, exact: r.exact[a], ms: r.ms[a] });
      if (r.exact[a] !== s.frames.length) { failures++; console.error(`round ${round} ${throttle}x ${s.name} ${a}: ${r.exact[a]}/${s.frames.length}`); }
    }
  }
  for (const s of order(manifest.filter((s) => !s.raw), round)) {
    for (const arm of order(POOL, round)) {
      const r = await page.evaluate((o) => globalThis.pool(o), { glue, hashWasm, urls: urls(s), frames: s.frames, arm,
        decoders: DECODERS, copies: COPIES, mutate: MUTATE });
      if (r.error) throw new Error(r.error);
      if (r.failed) { failures++; console.error(`round ${round} ${throttle}x pool ${s.name} ${arm}: ${r.failed} failed`); }
      rows.push({ kind: "pool", round, throttle, set: s.name, arm, ...r });
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
const range = (v) => `${f(med(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}]`;
console.log("hash: ms a frame, median of each round's median [range over rounds]; MB/s; × decode paired by round; exact");
for (const { throttle } of cells) for (const s of manifest) {
  const mb = s.width * s.height * s.channels * (s.bits > 8 ? 2 : 1) / 1e6;
  const of = (a) => rows.filter((r) => r.kind === "hash" && r.throttle === throttle && r.set === s.name && r.arm === a);
  const dec = new Map(of("decode").map((r) => [r.round, med(r.ms)]));
  for (const a of ARMS) {
    const rs = of(a);
    if (!rs.length) continue;
    const per = rs.map((r) => med(r.ms));
    const x = dec.size ? ` ×${med(rs.map((r) => med(r.ms) / dec.get(r.round))).toFixed(3)}` : "";
    console.log(`${throttle}× ${s.name} ${mb.toFixed(2)} MB ${a}: ${range(per)} ms ${(mb / med(per) * 1e3).toFixed(0)} MB/s${x}` +
      ` exact ${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)} n=${rs.length}`);
  }
}
console.log(`pool: ${DECODERS} decoders, ${COPIES}× each set's frames; first and last frame handed on, ms; × none paired by round; checked`);
for (const { throttle } of cells) for (const s of manifest.filter((s) => !s.raw)) {
  const of = (a) => rows.filter((r) => r.kind === "pool" && r.throttle === throttle && r.set === s.name && r.arm === a);
  const none = new Map(of("none").map((r) => [r.round, r]));
  for (const a of POOL) {
    const rs = of(a);
    if (!rs.length) continue;
    const x = (k) => med(rs.map((r) => r[k] / none.get(r.round)[k])).toFixed(3);
    console.log(`${throttle}× ${s.name} ${a}: first ${range(rs.map((r) => r.first))} ×${x("first")}` +
      ` fill ${range(rs.map((r) => r.last))} ×${x("last")} checked ${rs.reduce((n, r) => n + r.ok, 0)}/${a === "none" ? 0 : rs.reduce((n, r) => n + r.frames, 0)} n=${rs.length}`);
  }
}
process.exit(failures ? 1 : 0);
