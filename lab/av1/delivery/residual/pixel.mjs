/**
 * PIXELWORK: per set, one worker running every arm on the same frames; each (throttle, round) a fresh headless
 * Chromium, the sets in a Williams order inside it, 1× and 4× interleaved. The protocol, the checks and the rule
 * pixel-report.mjs applies: lab/av1/delivery/residual/README.md §Lossy pixel work protocol, pre-registered.
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/delivery/residual/pixel.mjs --frames DIR --sets a,b --arms L,LR,…
 *     [--throttles 1,4] [--rounds 152,40] [--mutate hash|offset|reuse|kernel] [--gpu] [--chromium-args=a,b] [--out rows.json]
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => {
  const eq = process.argv.find((a) => a.startsWith(`${k}=`));
  if (eq) return eq.slice(k.length + 1);
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const DIR = arg("--frames", "lab/.av1-work/pixel");
const SETS = arg("--sets", "dbts_a1,dbts_b1,dbts_c1,mr_ispy1").split(",");
const ARMS = arg("--arms", "L,LR,LS,A2,A1,A1′,AS,H").split(",");
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const ROUNDS = arg("--rounds", "152,40").split(",").map(Number);
const MUTATE = arg("--mutate", "");
const GPU = process.argv.includes("--gpu");
const CHROMIUM_ARGS = arg("--chromium-args", "").split(",").filter(Boolean);
const OUT = arg("--out", null);
const FIRST = 16;
const ROOT = new URL("../../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);

if (!GPU && ARMS.some((a) => a.startsWith("G"))) throw new Error("the G arms need --gpu and a hardware GPU");

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

/** busy.sh's line, a second at a time while this runs: epoch s, busy and total jiffies over every CPU. */
const BUSY = OUT ? `${OUT}.busy` : null;
const busy = setInterval(() => {
  const [, u, n, s, i, w, q, sq, st] = readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).map(Number);
  if (BUSY) appendFileSync(BUSY, `${Date.now() / 1000} ${u + n + s + q + sq + st} ${u + n + s + i + w + q + sq + st}\n`);
}, 1000);

const read = (p) => JSON.parse(readFileSync(`${ROOT}/${p}`, "utf8"));
const sets = SETS.map((name) => {
  const e = read(`${DIR}/${name}/manifest.json`).find((m) => m.name === name);
  const plain = e.cells.filter((c) => !c.cell.includes("-s"));
  if (plain.length !== 1) throw new Error(`${name}: ${plain.length} cells; the protocol encodes one`);
  const c = plain[0];
  const n = Math.min(FIRST, e.frames);
  const urls = (sub, ext) => Array.from({ length: n }, (_, i) => `/${DIR}/${name}/${name}/${sub}${String(i).padStart(3, "0")}.${ext}`);
  const truth = read(`${DIR}/${name}/truth.json`)[name][c.cell];
  return {
    name, crf: c.crf, n,
    want: { frames: e.truth.slice(0, n), previews: c.preview_hashes.slice(0, n), residuals: truth.residuals.slice(0, n) },
    o: { set: name, width: e.width, height: e.height, bits: e.bits, signed: e.signed, offset: e.offset, shift: c.preview_shift,
      residOffset: c.resid_offset, residBits: c.resid_bits, group: c.group, mutate: MUTATE, arms: ARMS,
      htj2kShift: e.htj2k_shift, units: urls(`${c.cell}/`, "av1"), residUrls: urls(`${c.cell}/r-htj2k/`, "htj2k"),
      wholeUrls: urls("", "htj2k"),
      kernel: `/${DIR}/simd/${MUTATE === "kernel" ? "broken/" : ""}add.wasm` },
  };
});

/** 1× and 4× alternating: a 4× round after every fourth 1× round, then any 4× rounds still owed. */
function schedule() {
  const [n1, n4] = [ROUNDS[0], ROUNDS[1] ?? ROUNDS[0]];
  if (THROTTLES.length === 1) return Array.from({ length: n1 }, (_, r) => [THROTTLES[0], r]);
  const out = [];
  let r4 = 0;
  for (let r1 = 0; r1 < n1; r1++) {
    out.push([1, r1]);
    if ((r1 + 1) % 4 === 0 && r4 < n4) out.push([4, r4++]);
  }
  while (r4 < n4) out.push([4, r4++]);
  return out;
}

const flip = (h) => h.replace(/^./, (c) => (c === "0" ? "1" : "0"));

function checked(s, got) {
  const want = (k, i) => (MUTATE === "hash" ? flip(s.want[k][i]) : s.want[k][i]);
  const digests = new Map();
  for (const r of got.rows) {
    if (r.sha) r.exact = r.sha === want("frames", r.frame);
    if (r.previewSha) r.previewExact = r.previewSha === want("previews", r.frame);
    if (/^A|^H/.test(r.arm)) digests.set(r.frame, [...(digests.get(r.frame) ?? []), r.digest]);
  }
  for (const r of got.rows) {
    if (digests.has(r.frame) && /^A|^H/.test(r.arm)) r.digestsAgree = new Set(digests.get(r.frame)).size === 1;
    delete r.sha;
    delete r.previewSha;
    delete r.digest;
  }
  return got.rows;
}

async function inChromium(throttle, round) {
  const args = GPU ? CHROMIUM_ARGS : [];
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args });
  const browser = await chromium.connect(server.wsEndpoint());
  const version = browser.version();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/delivery/residual/pixel.html`);
  await page.waitForFunction(() => globalThis.ready);
  const renderer = await page.evaluate(() => globalThis.renderer());
  if (ARMS.some((a) => a.startsWith("G")) && /SwiftShader/i.test(renderer)) throw new Error(`the G arms refused on ${renderer}`);
  const stop = throttleTree(server.process().pid, throttle);
  const rows = [];
  try {
    for (const s of order(sets, round)) {
      const got = await page.evaluate((o) => globalThis.set(o), { ...s.o, round });
      const at = { round, throttle, set: s.name, chromium: version, renderer };
      if (got.error) rows.push({ ...at, error: got.error });
      else rows.push({ ...at, groups: got.groups, refused: got.refused, xxh3Vector: got.xxh3Vector, frames: checked(s, got) });
    }
  } finally {
    stop();
    await browser.close();
    await server.close();
  }
  return rows;
}

/** Rows are written after every (throttle, round); a run given an --out that exists resumes after the last one written. */
const rows = OUT && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
const done = new Set(rows.map((r) => `${r.throttle}|${r.round}`));
for (const [throttle, round] of schedule()) {
  if (done.has(`${throttle}|${round}`)) continue;
  const t0 = Date.now();
  const got = await inChromium(throttle, round);
  rows.push(...got);
  for (const r of got) {
    if (r.error) { console.error(`round ${round} ${throttle}x ${r.set}: ${r.error}`); continue; }
    const miss = r.frames.filter((f) => f.exact === false || f.previewExact === false || f.equalL === false
      || f.equalPrep === false || f.digestsAgree === false);
    if (miss.length) console.error(`round ${round} ${throttle}x ${r.set}: ${miss.length} checks missed (${[...new Set(miss.map((f) => f.arm))].join(",")})`);
  }
  console.error(`round ${round} ${throttle}x done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (OUT) writeFileSync(OUT, JSON.stringify(rows));
}
clearInterval(busy);
process.exit(0);
