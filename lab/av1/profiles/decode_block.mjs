/**
 * The amended decode protocol (README.md §Profiles decode protocol, amended): one block, its rounds 0 … N − 1. A round
 * is each throttle in a fresh headless Chromium; inside, every (series, rung) in one worker, and in it every unit
 * (arm, form, decoder, G, pattern, and H twice as the block's A/A) in that round's Williams row. Rows written after
 * every round and resumed from them.
 *
 *   NODE_PATH=… node lab/av1/profiles/decode_block.mjs --block K --out rows.json [--work lab/.av1-work/profiles-decode]
 *     [--sets dbts_a1,dbts_b1,dbts_c1] [--rounds N] [--throttles 1,4] [--every-rung-at 1,4] [--until UNIX_S]
 *     [--mutate hash|offset|drop]
 * At a throttle not in --every-rung-at, only each series' middle rung runs: its crossover rung (§6 Content).
 *     [--direct: adds §6's own ask at G = 16, to check the jump against]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { createRequire } from "node:module";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const WORK = arg("--work", "lab/.av1-work/profiles-decode");
const SETS = arg("--sets", "dbts_a1,dbts_b1,dbts_c1").split(",");
const ROUNDS = Number(arg("--rounds", 10));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const EVERY_RUNG = arg("--every-rung-at", "1,4").split(",").map(Number);
const UNTIL = Number(arg("--until", Infinity)) * 1000;
const BLOCK = arg("--block", "pilot");
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", null);
const DIRECT = process.argv.includes("--direct");
const ONLY = new RegExp(arg("--only", ""));
const ROOT = new URL("../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

const sets = SETS.map((s) => JSON.parse(readFileSync(`${ROOT}/${WORK}/${s}.json`, "utf8")));
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
const formOf = (e, dec) => (e.bits <= 10 ? `${e.bits}bit` : dec === "dav1d" ? "12bit" : "top10");

/** Every (series, rung), and in each the units its worker runs. */
function blocks() {
  const out = [];
  for (const e of sets) {
    for (const q of [...new Set(e.cells.map((c) => c.q))]) {
      const forms = [...new Set(["dav1d", "webcodecs"].map((d) => formOf(e, d)))];
      const units = [{ name: "H", arm: "H" }, { name: "H′", arm: "H" }];
      for (const form of forms) units.push({ name: `R|${form}`, arm: "R", form });
      for (const dec of ["dav1d", "webcodecs"]) {
        for (const g of [1, 8, 16]) {
          for (const pattern of ["order", "jump"]) units.push({ name: `S${g}|${dec}|${pattern}`, arm: "S", form: formOf(e, dec), dec, g, pattern });
        }
      }
      if (DIRECT) for (const dec of ["dav1d", "webcodecs"]) units.push({ name: `S16|${dec}|ask`, arm: "S", form: formOf(e, dec), dec, g: 16, pattern: "ask" });
      const cell = (form, g) => e.cells.find((c) => c.form === form && c.q === q && c.g === g);
      out.push({ e, q, name: `${e.name}|Q${q}`, units, forms: Object.fromEntries(forms.map((f) => [f, cell(f, 16)])),
        cells: Object.fromEntries(forms.map((f) => [f, Object.fromEntries([1, 8, 16].map((g) => [g, cell(f, g)]))])) });
    }
  }
  return out.filter((b) => ONLY.test(b.name));
}
const BLOCKS = blocks();

const flip = (h) => h && h.replace(/^./, (c) => (c === "0" ? "1" : "0"));
const tally = (pairs) => [pairs.filter(([got, want]) => got === (MUTATE === "hash" ? flip(want) : want)).length, pairs.length];

/** [matched, expected]: exact frames against the fetch checksum, lossy ones against native dav1d, residuals against
 *  what streams.py wrote; a missing frame (a chain cut by an error) counts as a miss. */
function checks(b, u, got) {
  const e = b.e;
  const mid = range(e.middle, e.middle + 16);
  const h = new Map(got.hashes);
  if (u.arm === "H") return { exact: tally(mid.map((i) => [h.get(i), e.truth[i]])) };
  if (u.arm === "R") {
    const c = b.forms[u.form];
    return { exact: tally(mid.map((i) => [h.get(i), e.truth[i]])), residuals: tally(mid.map((i) => [h.get(-1 - i), c.residuals[i]])) };
  }
  const lossy = b.cells[u.form][u.g].lossy;
  if (u.pattern === "ask") return { lossy: tally([...h].map(([i, x]) => [x, lossy[i]])) };
  const seen = u.pattern === "order" ? mid : [...new Set(mid.map((k) => k - (k % u.g)))].flatMap((s) => range(s, Math.min(s + u.g, e.middle + 16)));
  return { lossy: tally(seen.map((i) => [h.get(i), lossy[i]])) };
}

async function inChromium(throttle, round) {
  const server = await chromium.launchServer();
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/profiles/decode.html`);
  await page.waitForFunction(() => globalThis.ready);
  const stop = throttleTree(server.process().pid, throttle);
  const rows = [];
  const middle = (b) => { const qs = [...new Set(b.e.cells.map((c) => c.q))].sort((x, y) => x - y); return b.q === qs[1]; };
  for (const b of order(BLOCKS.filter((b) => EVERY_RUNG.includes(throttle) || middle(b)), round)) {
    const e = b.e;
    const units = order(b.units, round).map((u) => (u.pattern === "ask" ? { ...u, asks: order(range(e.middle, e.middle + 16), round) } : u));
    const forms = Object.fromEntries(Object.entries(b.cells).map(([f, cells]) => [f, {
      cells: Object.fromEntries(Object.entries(cells).map(([g, c]) => [g, c.cell])), shift: b.forms[f].shift,
      residualOffset: b.forms[f].residual_offset, residualBits: b.forms[f].residual_bits }]));
    const o = { worker: "./decode_block.js", base: `/${WORK}/${e.name}`, middle: e.middle, offset: e.offset, forms, units, mutate: MUTATE };
    const t0 = Date.now();
    const got = await page.evaluate((x) => globalThis.cell(x), o);
    const wall = (Date.now() - t0) / 1000;
    if (got.error) {
      rows.push({ block: BLOCK, round, throttle, set: e.name, q: b.q, unit: null, wall, error: got.error });
      console.error(`round ${round} ${throttle}x ${b.name}: ${got.error}`);
      continue;
    }
    const pre = Object.fromEntries(Object.entries(got.precomputed).map(([f, hs]) => [f, tally(hs.map(([i, x]) => [x, b.forms[f].lossy[i]]))]));
    let prev = null;
    for (const [n, u] of units.entries()) {
      const r = got.units[n];
      const bytes = u.arm === "H" ? e.htj2k : u.arm === "R" ? b.forms[u.form].residual_units : b.cells[u.form][u.g].units;
      const us = (t) => Math.round(t * 1000) / 1000;
      r.frames = r.frames.map(([i, handed, written]) => [i, us(handed), us(written), bytes[i]]);
      const c = checks(b, u, r);
      if (u.arm === "R") c.lossy = pre[u.form];
      rows.push({ block: BLOCK, round, throttle, set: e.name, q: b.q, unit: u.name, prev, arm: u.arm, form: u.form ?? null,
        dec: u.dec ?? null, g: u.g ?? null, pattern: u.pattern ?? null, wall, frames: r.frames, asks: r.asks, error: r.error ?? null, checks: c });
      if (r.error || Object.values(c).some(([ok, k]) => ok !== k)) console.error(`round ${round} ${throttle}x ${b.name} ${u.name}: ${JSON.stringify(c)} ${r.error ?? ""}`);
      prev = u.name;
    }
    if (process.env.VERBOSE) console.error(`round ${round} ${throttle}x ${b.name} ${wall.toFixed(1)} s`);
  }
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const rows = OUT && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
const done = (round) => THROTTLES.every((t) => rows.some((r) => r.round === round && r.throttle === t));
if (!rows.length) rows.push({ block: BLOCK, host: { cpu: cpus()[0].model, cores: cpus().length, gb: Math.round(totalmem() / 2 ** 30) } });
let start = 0;
while (start < ROUNDS && done(start)) start++;
rows.splice(0, rows.length, ...rows.filter((r) => r.host || r.round < start));
// A round's length: the last one this run timed, else the walls of the last round in the rows, else none.
const walls = rows.filter((r) => r.round === start - 1 && r.unit === "H").reduce((a, r) => a + r.wall * 1000, 0);
let per = walls * 1.05;
for (let round = start; round < ROUNDS; round++) {
  if (Date.now() + per > UNTIL) {
    console.error(`stopping before round ${round}: it would pass --until`);
    break;
  }
  const t0 = Date.now();
  for (const throttle of order(THROTTLES, round)) {
    rows.push(...(await inChromium(throttle, round)));
    console.error(`round ${round} ${throttle}x done, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  per = Date.now() - t0;
}
process.exit(0);
