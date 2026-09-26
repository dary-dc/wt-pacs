/**
 * D6: a decoder's first frame against its steady state, over three cache arms on a persistent
 * profile. lab/decode-first-frame/README.md.
 *
 *   NODE_PATH=$(npm root -g) node lab/decode-first-frame/run.mjs [rounds]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROUNDS = Number(process.argv[2] || 3);
const SETS = ["decode_g512", "decode_cine512"];
const K = 8;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

const port = 21000 + ((Math.random() * 2000) | 0);
const host = spawn("python3", [path.join(ROOT, "server/dev-server.py"), "--port", String(port)], {
  cwd: ROOT,
  stdio: "ignore",
});
const base = `http://127.0.0.1:${port}`;
await new Promise((r) => setTimeout(r, 1200));

async function visit(ctx, set, warmup) {
  const page = await ctx.newPage();
  await page.goto(`${base}/lab/decode-first-frame/index.html?set=${set}&k=${K}${warmup ? "&warmup=1" : ""}`);
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 120000 });
  const out = await page.evaluate(() => globalThis.__d6);
  await page.close();
  return out;
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const set of SETS) {
    // A fresh profile per round is what makes "cold" cold.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d6-"));
    const ctx = await chromium.launchPersistentContext(dir, {
      headless: true,
      executablePath: process.env.CHROME_PATH || chromium.executablePath(),
      args: ["--disable-background-networking"],
    });
    for (const arm of ["cold", "warm-http", "warm-code"]) {
      const out = await visit(ctx, set, false);
      if (out?.per) rows.push({ set, arm, ...out });
    }
    // D6's own suggested remedy, as a fourth arm.
    const w = await visit(ctx, set, true);
    if (w?.per) rows.push({ set, arm: "warm-code+warmup", ...w });
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.stderr.write(`round ${round + 1}/${ROUNDS}\n`);
}

host.kill();

const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
console.log(
  `\n${"set".padEnd(15)} ${"arm".padEnd(17)} ${"load ms".padStart(8)} ${"frame 0".padStart(8)} ` +
    `${"frames 1-5".padStart(11)} ${"steady".padStart(8)} ${"first pays".padStart(11)}`,
);
for (const set of SETS) {
  for (const arm of ["cold", "warm-http", "warm-code", "warm-code+warmup"]) {
    const v = rows.filter((r) => r.set === set && r.arm === arm);
    if (!v.length) continue;
    const first = median(v.map((r) => r.per[0].ms));
    const early = median(v.flatMap((r) => r.per.slice(1, 6).map((p) => p.ms)));
    const steady = median(v.flatMap((r) => r.per.slice(5).map((p) => p.ms)));
    const load = median(v.map((r) => r.loadMs));
    console.log(
      `${set.padEnd(15)} ${arm.padEnd(17)} ${load.toFixed(0).padStart(8)} ${first.toFixed(1).padStart(8)} ` +
        `${early.toFixed(1).padStart(11)} ${steady.toFixed(1).padStart(8)} ` +
        `${(first / steady).toFixed(2).padStart(10)}x`,
    );
  }
}
