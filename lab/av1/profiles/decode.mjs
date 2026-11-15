/**
 * PROFILEDECODE (README.md §6): every (arm, decoder, series, rung, link) in a Williams order inside each round, each
 * (throttle, round) a fresh headless Chromium, every frame checked; rows written after every round, resumed from them.
 *
 *   NODE_PATH=… node lab/av1/profiles/decode.mjs --work lab/.av1-work/profiles-decode --sets dbts_a1,dbts_b1,dbts_c1
 *     [--rounds N] [--throttles 1,4] [--links none,5,50] [--series all|b1-L|none] [--mutate hash|offset|drop]
 *     [--hours H] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const WORK = arg("--work", "lab/.av1-work/profiles-decode");
const SETS = arg("--sets", "dbts_a1,dbts_b1,dbts_c1").split(",");
const ROUNDS = Number(arg("--rounds", 10));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const LINKS = arg("--links", "none,5,50").split(",");
const SERIES = arg("--series", "all");
const MUTATE = arg("--mutate", "");
const HOURS = Number(arg("--hours", Infinity));
const OUT = arg("--out", null);
const ONLY = new RegExp(arg("--only", ""));
const ROOT = new URL("../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const RATE = { none: 0, 5: 5e6, 50: 50e6 };

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

const sets = SETS.map((s) => JSON.parse(readFileSync(`${ROOT}/${WORK}/${s}.json`, "utf8")));
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

function units() {
  const out = [];
  for (const e of sets) {
    const rungs = [...new Set(e.cells.map((c) => c.q))];
    const form = (dec) => (e.bits <= 10 ? `${e.bits}bit` : dec === "dav1d" ? `${e.bits}bit` : "top10");
    const cellOf = (dec, q, g) => e.cells.find((c) => c.form === form(dec) && c.q === q && c.g === g);
    for (const link of LINKS) {
      const u = (arm, dec, q, c, g) => ({ name: `${arm}|${dec}|${e.name}|${q ? `Q${q}` : "-"}|${link}`, arm, dec, q, c, g, e, link });
      out.push(u("H", "openjph", null, null, 1));
      for (const dec of ["dav1d", "webcodecs"]) out.push(u("L", dec, null, null, 1));
      for (const q of rungs) {
        for (const dec of ["dav1d", "webcodecs"]) {
          for (const g of [1, 8, 16, e.frames]) out.push(u(`S${g === e.frames ? "W" : g}`, dec, q, cellOf(dec, q, g), g));
          out.push(u("R", dec, q, cellOf(dec, q, 16), 16), u("W", dec, q, cellOf(dec, q, 16), 16));
        }
      }
    }
  }
  return out;
}
const UNITS = units().filter((u) => ONLY.test(u.name));

const seriesClock = (u, throttle) => SERIES === "all" ? u.arm !== "W"
  : SERIES === "b1-L" && u.arm === "L" && u.dec === "dav1d" && u.e.name === "dbts_b1" && throttle === 4;

const flip = (h) => h && h.replace(/^./, (c) => (c === "0" ? "1" : "0"));
const tally = (got, want) => [got.filter((h, i) => h === (MUTATE === "hash" ? flip(want[i]) : want[i])).length, want.length];

/** Tallies [matched, expected]: exact frames against the fetch checksum, lossy ones against native dav1d, residuals
 *  against what streams.py wrote. A clock's frames are kept in the order it ran: the middle 16, then the series. */
function checks(u, got) {
  const mid = range(u.e.middle, u.e.middle + 16);
  const seen = got.clocks.series === undefined ? mid : [...mid, ...range(0, u.e.frames)];
  const lossy = (i) => u.c.lossy[i];
  const c = {};
  if (u.arm[0] !== "S") c.exact = tally(got.exact, seen.map((i) => u.e.truth[i]));
  if (u.arm === "R" || u.arm === "W") c.lossy = tally(got.lossy, seen.map(lossy));
  if (u.arm === "R") c.residuals = tally(got.residuals, seen.map((i) => u.c.residuals[i]));
  if (u.arm[0] === "S") {
    c.lossy = tally(got.lossy, mid.map(lossy));
    c.ask = tally(got.ask.map(([, h]) => h), got.ask.map(([k]) => lossy(k)));
    if (got.clocks.series !== undefined) c.series = tally(got.series, range(0, u.e.frames).map(lossy));
  }
  return c;
}

async function inChromium(throttle, round) {
  const server = await chromium.launchServer();
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/profiles/decode.html`);
  await page.waitForFunction(() => globalThis.ready);
  const stop = throttleTree(server.process().pid, throttle);
  const rows = [];
  let prev = null;
  for (const u of order(UNITS, round)) {
    const clocks = ["frame", ...(seriesClock(u, throttle) ? ["series"] : [])];
    const asks = u.arm[0] === "S" ? order(range(u.e.middle, u.e.middle + 16), round) : [];
    const o = { base: `/${WORK}/${u.e.name}`, arm: u.arm[0], decoder: u.dec, cell: u.c?.cell, g: u.g, frames: u.e.frames,
      middle: u.e.middle, offset: u.e.offset, shift: u.c?.shift ?? 0, residualOffset: u.c?.residual_offset,
      residualBits: u.c?.residual_bits, rate: RATE[u.link], clocks, asks, mutate: MUTATE };
    const t0 = Date.now();
    const got = await page.evaluate((x) => globalThis.cell(x), o);
    const row = { round, throttle, unit: u.name, prev, set: u.e.name, arm: u.arm, dec: u.dec, q: u.q, g: u.g, link: u.link,
      wall: (Date.now() - t0) / 1000, clocks: got.clocks, error: got.error,
      asks: got.ask?.map(([k, h, e]) => [k, k % u.g, h === (u.c?.lossy ?? [])[k], e ?? null]), checks: got.error ? {} : checks(u, got) };
    rows.push(row);
    prev = u.name;
    const bad = row.error || Object.values(row.checks).some(([ok, n]) => ok !== n);
    if (process.env.VERBOSE) console.error(`${u.name} ${row.wall.toFixed(1)} s ${JSON.stringify(row.checks)} ${row.error ?? ""}`);
    if (bad) console.error(`round ${round} ${throttle}x ${u.name}: ${JSON.stringify(row.checks)} ${row.error ?? ""}`);
  }
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const rows = OUT && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
const done = (round) => THROTTLES.every((t) => rows.some((r) => r.round === round && r.throttle === t));
let start = 0;
while (start < ROUNDS && done(start)) start++;
rows.splice(0, rows.length, ...rows.filter((r) => r.round < start));
const began = Date.now();
for (let round = start; round < ROUNDS; round++) {
  const t0 = Date.now();
  for (const throttle of order(THROTTLES, round)) {
    rows.push(...(await inChromium(throttle, round)));
    console.error(`round ${round} ${throttle}x done, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  const per = (Date.now() - began) / (round - start + 1);
  if (Date.now() - began + per > HOURS * 3600e3) {
    console.error(`stopping after round ${round}: another round would pass ${HOURS} h`);
    break;
  }
}
process.exit(0);
