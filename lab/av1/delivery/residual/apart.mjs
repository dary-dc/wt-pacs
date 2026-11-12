/**
 * RESIDAPART's decode time: per (series, quality) the arms H, R, RA and P, each in a worker of its own, in a
 * Williams order inside every round, each (throttle, round) a fresh headless Chromium; every frame checked.
 * The protocol and the rule this prints: lab/av1/delivery/residual/README.md §Residual apart protocol.
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/delivery/residual/apart.mjs --frames DIR[,DIR] [--sets a,b]
 *     [--rounds N] [--throttles 1,4] [--first 16] [--mutate hash|offset] [--pilot] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { leadsByPredecessor, order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIRS = arg("--frames", "lab/.av1-work/apart").split(",");
const SETS = arg("--sets", null)?.split(",");
const ROUNDS = Number(arg("--rounds", 20));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const FIRST = Number(arg("--first", 16));
const MUTATE = arg("--mutate", "");
const PILOT = process.argv.includes("--pilot");
const OUT = arg("--out", null);
const ROOT = new URL("../../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

const read = (dir, f) => JSON.parse(readFileSync(`${ROOT}/${dir}/${f}`, "utf8"));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const CRF_SET = [8, 20, 32, 44];

/** Row 17's quality (the fewest preview + residual bytes over the series), then CRF 8 and 2 unless already chosen, then every shifted cell. */
function qualities(e) {
  const plain = e.cells.filter((c) => !c.cell.includes("-s"));
  const full = e.cells.filter((c) => c.cell.includes("-s")).map((c) => ["full depth", c]);
  if (!plain.length) return full;
  const row17 = plain.filter((c) => CRF_SET.includes(c.crf)).sort((a, b) => sum(a.preview) + sum(a.resid_htj2k) - sum(b.preview) - sum(b.resid_htj2k))[0];
  const higher = [8, 2].filter((q) => q !== row17.crf).map((q) => plain.find((c) => c.crf === q)).filter(Boolean);
  return [["row 17", row17], ...higher.map((c) => ["higher", c]), ...full];
}

const cells = [];
for (const dir of DIRS) {
  const truth = read(dir, "truth.json");
  for (const e of read(dir, "manifest.json")) {
    if (SETS && !SETS.includes(e.name)) continue;
    for (const [quality, c] of qualities(e)) cells.push({ dir, e, c, quality, truth: truth[e.name][c.cell] });
  }
}
if (SETS) cells.sort((a, b) => SETS.indexOf(a.e.name) - SETS.indexOf(b.e.name));

function arms({ dir, e, c, truth }) {
  const n = Math.min(FIRST, e.frames);
  const urls = (sub, ext) => Array.from({ length: n }, (_, i) => `/${dir}/${e.name}/${sub}${String(i).padStart(3, "0")}.${ext}`);
  const preview = c.preview_bits <= 10 ? "webcodecs" : "dav1d";
  const base = { width: e.width, height: e.height, channels: e.channels, bits: e.bits, signed: e.signed, offset: e.offset,
    grey: e.channels === 1, group: c.group, mutate: MUTATE, urls: urls(`${c.cell}/`, "av1") };
  const resid = { ...base, preview, previewShift: c.preview_shift, residOffset: c.resid_offset, residBits: c.resid_bits,
    residUrls: urls(`${c.cell}/r-htj2k/`, "htj2k") };
  const want = { frames: e.truth.slice(0, n), previews: c.preview_hashes.slice(0, n), residuals: truth.residuals.slice(0, n) };
  return [
    { arm: "H", o: { ...base, arm: "H", htj2kShift: e.htj2k_shift, urls: urls("", "htj2k") }, check: ["frames"] },
    { arm: "R", o: { ...resid, arm: "R" }, check: ["frames", "previews", "residuals"] },
    { arm: "RA", o: { ...resid, arm: "RA" }, check: ["frames", "previews"] },
    ...(c.preview_bits <= 10 ? ["webcodecs", "dav1d"] : ["dav1d"]).map((p) =>
      ({ arm: `P ${p}`, o: { ...base, arm: "P", preview: p }, check: ["previews"] })),
  ].map((a) => ({ ...a, want, n }));
}

const flip = (h) => h.replace(/^./, (c) => (c === "0" ? "1" : "0"));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/lab/av1/delivery/residual/apart.html`);
  await page.waitForFunction(() => globalThis.ready);
  const stop = throttleTree(server.process().pid, throttle);
  const rows = [];
  for (const cell of order(cells, round)) {
    let prev = null;
    for (const a of order(arms(cell), round)) {
      const got = await page.evaluate((o) => globalThis.arm(o), a.o);
      const checks = Object.fromEntries(a.check.map((k) => {
        const want = MUTATE === "hash" ? a.want[k].map(flip) : a.want[k];
        return [k, (got[k] ?? []).filter((h, i) => h === want[i]).length];
      }));
      rows.push({ round, throttle, set: cell.e.name, cell: cell.c.cell, quality: cell.quality, arm: a.arm, prev,
        frames: a.n, ms: got.ms, checks, error: got.error });
      prev = a.arm;
    }
  }
  stop();
  await browser.close();
  await server.close();
  return rows;
}

/** Rows are written after every round; a run given an --out that exists resumes after its last complete round. */
const rows = OUT && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
const done = (round) => THROTTLES.every((t) => rows.some((r) => r.round === round && r.throttle === t));
let start = 0;
while (start < ROUNDS && done(start)) start++;
rows.splice(0, rows.length, ...rows.filter((r) => r.round < start));
for (let round = start; round < ROUNDS; round++) {
  for (const throttle of order(THROTTLES, round)) {
    const got = await inChromium(throttle, round);
    rows.push(...got);
    for (const r of got.filter((r) => r.error || Object.values(r.checks).some((v) => v !== r.frames))) {
      console.error(`round ${round} ${throttle}x ${r.set} ${r.cell} ${r.arm}: ${JSON.stringify(r.checks)} ${r.error ?? ""}`);
    }
    console.error(`round ${round} ${throttle}x done`);
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(rows));
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f2 = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const sd = (a) => { const m = sum(a) / a.length; return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)); };

console.log("checks per arm over all rounds: frames exact / previews bit-identical to native dav1d / residuals as encode.py wrote them");
for (const throttle of THROTTLES) {
  for (const { e, c } of cells) {
    const rs = rows.filter((r) => r.throttle === throttle && r.set === e.name && r.cell === c.cell);
    const tally = [...new Set(rs.map((r) => r.arm))].map((arm) => {
      const a = rs.filter((r) => r.arm === arm);
      const keys = Object.keys(a[0].checks);
      return `${arm} ${keys.map((k) => `${sum(a.map((r) => r.checks[k]))}/${sum(a.map((r) => r.frames))}`).join(" ")}`;
    });
    console.log(`${throttle}x\t${e.name}\t${c.cell}\t${tally.join("\t")}`);
  }
}

console.log("\nms a frame, median [range] over rounds; RA ÷ H paired: median [range], RA slower in k/n; order effect; rule");
const verdict = (m, slower, n) => (m >= 1.05 && slower >= 0.9 * n ? "more" : m <= 0.95 && n - slower >= 0.9 * n ? "less"
  : m > 0.95 && m < 1.05 ? "the same" : "unresolved");
for (const throttle of THROTTLES) {
  for (const { e, c, quality } of cells) {
    const rs = rows.filter((r) => r.throttle === throttle && r.set === e.name && r.cell === c.cell);
    const at = (arm) => new Map(rs.filter((r) => r.arm === arm && Number.isFinite(r.ms)).map((r) => [r.round, r]));
    const H = at("H");
    const RA = at("RA");
    const R = at("R");
    const per = (m) => [...m.values()].map((r) => r.ms / r.frames);
    const ratio = [...RA].filter(([k]) => H.has(k)).map(([k, r]) => ({ k, v: r.ms / H.get(k).ms, prev: r.prev }));
    const v = ratio.map((x) => x.v);
    const m = med(v);
    const slower = v.filter((x) => x > 1).length;
    const byPrev = new Map();
    for (const x of ratio) byPrev.set(x.prev ?? "first", [...(byPrev.get(x.prev ?? "first") ?? []), x.v]);
    const effect = Math.max(...[...byPrev.values()].map((g) => Math.abs(med(g) / m - 1)));
    const failed = rs.some((r) => r.error || Object.values(r.checks).some((k) => k !== r.frames));
    const add = [...RA].filter(([k]) => R.has(k)).map(([k, r]) => (r.ms - R.get(k).ms) / r.frames);
    const p = ["P webcodecs", "P dav1d"].map((a) => (at(a).size ? `${a.slice(2)} ${f2(med(per(at(a))))}` : `${a.slice(2)} —`));
    const rule = failed ? "VOID (a check missed)" : effect > 0.1 ? `not read (order effect ${(effect * 100).toFixed(0)} %)` : verdict(m, slower, v.length);
    console.log(`${throttle}x\t${e.name}\t${c.cell} (${quality})\tH ${f2(med(per(H)))}\tR ${f2(med(per(R)))}\tRA ${f2(med(per(RA)))}`
      + `\tRA−R ${f2(med(add))}\t${p.join(" ")}\tRA÷H ${m.toFixed(3)} [${Math.min(...v).toFixed(3)}–${Math.max(...v).toFixed(3)}]`
      + `\tslower ${slower}/${v.length}\tR÷H ${med([...R].filter(([k]) => H.has(k)).map(([k, r]) => r.ms / H.get(k).ms)).toFixed(3)}`
      + `\torder ${(effect * 100).toFixed(1)} %\t${rule}`);
    if (PILOT) {
      const s = sd(v.map(Math.log));
      const n = Math.ceil((((1.96 + 0.84) * s) / Math.log(1.05)) ** 2);
      console.log(`\tpilot σ ${s.toFixed(4)} → n ${n}`);
    }
    const units = [...new Set(rs.map((r) => r.arm))];
    const lead = rs.map((r) => ({ round: r.round, unit: r.arm, prev: r.prev, v: r.ms / r.frames }));
    for (const line of leadsByPredecessor(lead, units, [["RA", "H"], ["R", "H"]], 2)) console.log(`\t${line}`);
  }
}
process.exit(0);
