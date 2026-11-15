/**
 * Row SPLITPREVIEWB's decode block (split-preview-b.md §Stage 3): rounds 0 … N − 1, each throttle in a fresh headless
 * Chromium, the (series, anchor) in that round's Williams row, and in each worker its units in that round's Williams
 * row. Rows written every two rounds and resumed from them.
 *
 *   NODE_PATH=… node lab/av1/profiles/split_preview_block.mjs --out rows.json --streams lab/.av1-work/split/streams
 *     --partners partners.json [--rounds N] [--until UNIX_S] [--throttles 1,4] [--no-s16] [--crossover-only-at 4]
 *     [--mutate hash|shift0]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { createRequire } from "node:module";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const STREAMS = arg("--streams", "lab/.av1-work/split/streams");
const ROUNDS = Number(arg("--rounds", 100));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const CROSSOVER_ONLY_AT = arg("--crossover-only-at", "4").split(",").map(Number);
const UNTIL = Number(arg("--until", Infinity)) * 1000;
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", null);
const NO_S16 = process.argv.includes("--no-s16");
const ONLY = new RegExp(arg("--only", ""));
const PARTNERS = JSON.parse(readFileSync(arg("--partners"), "utf8"));
const ROOT = new URL("../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const CROSSOVER = (set) => (set === "dbts_b2" ? 16 : 32);

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

const read = (p) => JSON.parse(readFileSync(`${ROOT}/${STREAMS}/${p}`, "utf8"));

/** Every (series, anchor), its five units, and the streams and reference hashes they read. */
function blocks() {
  return PARTNERS.filter((p) => ONLY.test(`${p.set}|Q${p.anchor}`)).map((p) => {
    const dirs = { "10bit/1": `10bit-q${p.anchor}-g1`, "10bit/16": `10bit-q${p.anchor}-g16`,
      "top8/1": `top8-q${p.partner}-g1`, "top8/16": `top8-q${p.partner}-g16` };
    const ref = Object.fromEntries(Object.entries(dirs).map(([k, d]) => [k, read(`${p.set}/${d}/frames.json`)]));
    const unit = (name, form, g) => ({ name, stream: `${form}/${g}`, g, shift: form === "top8" && MUTATE !== "shift0" ? 2 : 0 });
    const units = [unit("10bit S1", "10bit", 1), unit("10bit S1′", "10bit", 1), unit("top8 S1", "top8", 1)];
    if (!NO_S16) units.push(unit("10bit S16", "10bit", 16), unit("top8 S16", "top8", 16));
    return { ...p, name: `${p.set}|Q${p.anchor}`, dirs, ref, units };
  });
}
const BLOCKS = blocks();

const flip = (h) => h.replace(/^./, (c) => (c === "0" ? "1" : "0"));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer();
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/profiles/decode.html`);
  await page.waitForFunction(() => globalThis.ready);
  const version = browser.version();
  const stop = throttleTree(server.process().pid, throttle);
  const rows = [];
  const here = BLOCKS.filter((b) => !CROSSOVER_ONLY_AT.includes(throttle) || b.anchor === CROSSOVER(b.set));
  for (const b of order(here, round)) {
    const units = order(b.units, round);
    const o = { worker: "./split_preview_block.js", base: `/${STREAMS}/${b.set}`, middle: b.middle, streams: b.dirs, units };
    const t0 = Date.now();
    const got = await page.evaluate((x) => globalThis.cell(x), o);
    const wall = (Date.now() - t0) / 1000;
    if (got.error) {
      rows.push({ round, throttle, set: b.set, q: b.anchor, partner: b.partner, unit: null, wall, error: got.error });
      console.error(`round ${round} ${throttle}x ${b.name}: ${got.error}`);
      continue;
    }
    let prev = null;
    for (const [n, u] of units.entries()) {
      const r = got.units[n];
      const want = b.ref[u.stream].hashes;
      const h = new Map(r.hashes);
      const mid = Array.from({ length: 16 }, (_, k) => b.middle + k);
      const ok = mid.filter((i) => h.get(i) === (MUTATE === "hash" ? flip(want[i]) : want[i])).length;
      const us = (t) => Math.round(t * 1000) / 1000;
      rows.push({ round, throttle, set: b.set, q: b.anchor, partner: b.partner, unit: u.name, prev, wall, browser: version,
        frames: r.frames.map(([i, h0, w]) => [i, us(h0), us(w)]), error: r.error ?? null, checks: { frames: [ok, 16] } });
      if (r.error || ok !== 16) console.error(`round ${round} ${throttle}x ${b.name} ${u.name}: ${ok}/16 ${r.error ?? ""}`);
      prev = u.name;
    }
  }
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const rows = OUT && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
if (!rows.length) rows.push({ host: { cpu: cpus()[0].model, cores: cpus().length, gb: Math.round(totalmem() / 2 ** 30) } });
const done = (round) => THROTTLES.every((t) => rows.some((r) => r.round === round && r.throttle === t));
let start = 0;
while (start < ROUNDS && done(start)) start++;
rows.splice(0, rows.length, ...rows.filter((r) => r.host || r.round < start));
let per = 0;
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
  per = Date.now() - t0;
  rows.push({ round, round_s: per / 1000 });
  if (OUT && (round % 2 === 1 || Date.now() + per > UNTIL)) writeFileSync(OUT, JSON.stringify(rows));
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows));
process.exit(0);
