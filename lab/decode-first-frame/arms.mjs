/**
 * D8: the same decoder from a buffer and by streaming, interleaved, over three visits to a
 * persistent profile, with what Chrome wrote to its WASM code cache beside the timings.
 * lab/decode-first-frame/README.md.
 *
 *   NODE_PATH=$(npm root -g) node lab/decode-first-frame/arms.mjs [rounds]
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROUNDS = Number(process.argv[2] || 5);
const SETS = ["decode_g512", "decode_cine512"];
const ARMS = ["buffer", "streaming"];
const VISITS = 3;
const K = 8;
/** V8 serialises a module's code only once it has tiered up, and not at the same moment. */
const SETTLE_MS = Number(process.env.SETTLE_MS || 3000);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const PROFILES = path.join(ROOT, "target", "d8-profiles");

const port = 21000 + ((Math.random() * 2000) | 0);
const host = spawn("python3", [path.join(ROOT, "server/dev-server.py"), "--port", String(port)], {
  cwd: ROOT,
  stdio: "ignore",
});
const base = `http://127.0.0.1:${port}`;
await new Promise((r) => setTimeout(r, 1200));

/** What Chrome has written under the profile's compiled-WebAssembly cache: entries and bytes. */
function codeCache(dir) {
  const at = path.join(dir, "Default", "Code Cache", "wasm");
  if (!fs.existsSync(at)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name);
      // The backend's own index is always there and is not a cached module.
      if (e.isDirectory()) {
        if (e.name !== "index-dir") walk(q);
      } else if (e.name !== "index") {
        files++;
        bytes += fs.statSync(q).size;
      }
    }
  };
  walk(at);
  return { files, bytes };
}

const fellBack = new Set();

async function visit(ctx, set, arm, extra = "") {
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.text().includes("wasm streaming compile failed")) fellBack.add(arm);
  });
  await page.goto(
    `${base}/lab/decode-first-frame/index.html?set=${set}&k=${K}&instantiate=${arm}${extra}`,
  );
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 120000 });
  const out = await page.evaluate(() => globalThis.__d6);
  await page.waitForTimeout(SETTLE_MS);
  await page.close();
  return out;
}

if (process.argv.includes("--parity")) {
  const dir = path.join(PROFILES, "parity");
  fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    args: ["--disable-background-networking"],
  });
  let bad = 0;
  for (const set of ["decode_g512", "decode_c512", "decode_s512", "decode_cine512"]) {
    const out = {};
    for (const arm of ARMS) out[arm] = (await visit(ctx, set, arm, "&digest=1")).digests;
    if (!out.buffer?.length) throw new Error(`${set}: no digests — the page decoded nothing`);
    // Ground truth is the encoder's input, never a decoder under test — parity.mjs says why.
    const truth = out.buffer.map((_, i) =>
      fs
        .readFileSync(path.join(ROOT, "lab/fixtures", set, `${String(i).padStart(3, "0")}.sha256`), "utf8")
        .trim(),
    );
    const same = out.buffer.filter((h, i) => h === out.streaming[i]).length;
    const right = out.buffer.filter((h, i) => h === truth[i]).length;
    const n = out.buffer.length;
    bad += n - same + (n - right);
    console.log(
      `${set.padEnd(15)} ${n} frames  buffer==streaming ${same}/${n}  ==encoder input ${right}/${n}`,
    );
  }
  await ctx.close();
  fs.rmSync(PROFILES, { recursive: true, force: true });
  host.kill();
  console.log(bad ? `PARITY FAILED: ${bad} difference(s)` : "PARITY OK: the two paths decode the same bytes");
  process.exit(bad ? 1 : 0);
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  const order = round % 2 ? [...ARMS].reverse() : ARMS;
  for (const set of SETS) {
    const live = {};
    for (const arm of ARMS) {
      const dir = path.join(PROFILES, `${arm}-${round}-${set}`);
      fs.rmSync(dir, { recursive: true, force: true });
      live[arm] = {
        dir,
        ctx: await chromium.launchPersistentContext(dir, {
          headless: true,
          executablePath: process.env.CHROME_PATH || chromium.executablePath(),
          args: ["--disable-background-networking"],
        }),
      };
    }
    for (let v = 1; v <= VISITS; v++) {
      for (const arm of order) {
        const out = await visit(live[arm].ctx, set, arm);
        if (out?.per) rows.push({ set, arm, visit: v, ...out, cache: codeCache(live[arm].dir) });
      }
    }
    for (const arm of ARMS) {
      await live[arm].ctx.close();
      fs.rmSync(live[arm].dir, { recursive: true, force: true });
    }
  }
  process.stderr.write(`round ${round + 1}/${ROUNDS}\n`);
}

host.kill();
fs.rmSync(PROFILES, { recursive: true, force: true });

const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const cell = (v) => ({
  load: median(v.map((r) => r.loadMs)),
  first: median(v.map((r) => r.per[0].ms)),
  early: median(v.flatMap((r) => r.per.slice(1, 6).map((p) => p.ms))),
  steady: median(v.flatMap((r) => r.per.slice(5).map((p) => p.ms))),
  files: median(v.map((r) => r.cache.files)),
  bytes: median(v.map((r) => r.cache.bytes)),
});

console.log(
  `\n${"set".padEnd(15)} ${"arm".padEnd(10)} ${"visit".padStart(5)} ${"ready ms".padStart(9)} ` +
    `${"frame 0".padStart(8)} ${"frames 1-5".padStart(11)} ${"steady".padStart(7)} ` +
    `${"pays".padStart(6)} ${"cache files".padStart(12)} ${"cache bytes".padStart(12)}`,
);
for (const set of SETS) {
  for (let v = 1; v <= VISITS; v++) {
    for (const arm of ARMS) {
      const s = rows.filter((r) => r.set === set && r.arm === arm && r.visit === v);
      if (!s.length) continue;
      const c = cell(s);
      console.log(
        `${set.padEnd(15)} ${arm.padEnd(10)} ${String(v).padStart(5)} ${c.load.toFixed(1).padStart(9)} ` +
          `${c.first.toFixed(1).padStart(8)} ${c.early.toFixed(1).padStart(11)} ` +
          `${c.steady.toFixed(1).padStart(7)} ${(c.first / c.steady).toFixed(2).padStart(5)}x ` +
          `${String(c.files).padStart(12)} ${String(c.bytes).padStart(12)}`,
      );
    }
    const pair = (arm, f) =>
      rows.filter((r) => r.set === set && r.arm === arm && r.visit === v).map(f);
    const b = pair("buffer", (r) => r.loadMs);
    const s = pair("streaming", (r) => r.loadMs);
    const bf = pair("buffer", (r) => r.per[0].ms);
    const sf = pair("streaming", (r) => r.per[0].ms);
    const wins = (x, y) => x.filter((n, i) => n < y[i]).length;
    console.log(
      `${"".padEnd(15)} ${"streaming wins".padEnd(10)} ${String(v).padStart(5)} ` +
        `${`${wins(s, b)}/${b.length}`.padStart(9)} ${`${wins(sf, bf)}/${bf.length}`.padStart(8)}`,
    );
  }
}
if (fellBack.size) console.log(`\nstreaming compile fell back to a buffer: ${[...fellBack]}`);
