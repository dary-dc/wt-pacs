/**
 * RESID's decode time: each set's first frames made exact in one worker per variant — OpenJPH alone, or
 * a preview (dav1d-WASM or WebCodecs) plus a residual (OpenJPH or dav1d-WASM) and the add — in headless
 * Chromium at each throttle. Every (throttle) cell is a fresh browser, in a Williams order every
 * round; variants rotate inside it the same way. lab/av1/delivery/residual/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/delivery/residual/time.mjs [--rounds 15] [--throttles 1,4]
 *     [--frames lab/.av1-work/resid] [--first 16] [--crf auto|N] [--mutate hash] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 15));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const FRAMES = arg("--frames", "lab/.av1-work/resid");
const FIRST = Number(arg("--first", 16));
const CRF = arg("--crf", "auto");
const MUTATE = arg("--mutate", "") === "hash";
const OUT = arg("--out", null);
const ROOT = new URL("../../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;

const manifest = JSON.parse(readFileSync(`${ROOT}/${FRAMES}/manifest.json`, "utf8"));
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

const total = (c) => c.preview.reduce((a, b) => a + b, 0) + c.resid_htj2k.reduce((a, b) => a + b, 0);
/** The cell timed per set: the CRF whose preview + HTJ2K residual is fewest bytes, unless --crf names one. */
const timedCell = (s) => (CRF === "auto" ? [...s.cells].sort((a, b) => total(a) - total(b))[0] : s.cells.find((c) => c.crf === Number(CRF)));

const variants = manifest.flatMap((s) => {
  const n = Math.min(FIRST, s.frames);
  const url = (dir, ext) => Array.from({ length: n }, (_, i) => `/${FRAMES}/${dir}/${String(i).padStart(3, "0")}.${ext}`);
  const c = timedCell(s);
  const common = { width: s.width, height: s.height, channels: s.channels, bits: s.bits, signed: s.signed,
    offset: s.offset, grey: s.channels === 1, want: s.truth.slice(0, n) };
  const resid = (preview, residual) => ({
    set: s.name, variant: `${preview}+${residual} ${c.cell}`, cell: c.cell, previewWant: c.preview_hashes.slice(0, n),
    o: { ...common, preview, residual, group: c.group, codec: c.webcodecs, greyShift: s.grey_shift,
      residOffset: c.resid_offset, residBits: c.resid_bits, urls: url(`${s.name}/${c.cell}`, "av1"),
      residUrls: url(`${s.name}/${c.cell}/r-${residual}`, residual === "htj2k" ? "htj2k" : "av1") },
  });
  return [
    { set: s.name, variant: "htj2k", o: { ...common, htj2kShift: s.htj2k_shift, urls: url(s.name, "htj2k") } },
    ...["dav1d", "webcodecs"].flatMap((p) => ["htj2k", ...(c.resid_av1 ? ["av1"] : [])].map((r) => resid(p, r))),
  ];
});

const flip = (h) => h.replace(/^./, (c) => (c === "0" ? "1" : "0"));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/delivery/residual/index.html`);
  await page.waitForFunction(() => globalThis.ready);
  const stop = throttleTree(server.process().pid, throttle);
  const rows = [];
  for (const a of order(variants, round)) {
    const got = await page.evaluate(({ want, ...o }) => globalThis.variant(o), a.o);
    const want = MUTATE ? a.o.want.map(flip) : a.o.want;
    const pwant = a.previewWant && (MUTATE ? a.previewWant.map(flip) : a.previewWant);
    const exact = got.hashes ? got.hashes.filter((h, i) => h === want[i]).length : 0;
    const previewExact = pwant ? (got.previewHashes ?? []).filter((h, i) => h === pwant[i]).length : null;
    rows.push({ round, throttle, set: a.set, variant: a.variant, frames: want.length, exact, previewExact, ms: got.ms, error: got.error });
  }
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const throttle of order(THROTTLES, round)) {
    const got = await inChromium(throttle, round);
    rows.push(...got);
    for (const r of got.filter((r) => r.error || r.exact !== r.frames || (r.previewExact !== null && r.previewExact !== r.frames))) {
      console.error(`round ${round} ${throttle}x ${r.set} ${r.variant}: ${r.exact}/${r.frames} preview ${r.previewExact} ${r.error ?? ""}`);
    }
    console.error(`round ${round} ${throttle}x done`);
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows));

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
console.log("ms a frame, the first frames made exact in one worker: median of rounds [min–max], n; exact frames; preview frames bit-identical to native dav1d");
for (const throttle of THROTTLES) {
  for (const { set, variant } of variants) {
    const rs = rows.filter((r) => r.throttle === throttle && r.set === set && r.variant === variant);
    const per = rs.filter((r) => r.ms !== undefined).map((r) => r.ms / r.frames);
    const exact = `${rs.reduce((n, r) => n + r.exact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
    const pv = rs[0]?.previewExact === null ? "" : `\tpreview ${rs.reduce((n, r) => n + r.previewExact, 0)}/${rs.reduce((n, r) => n + r.frames, 0)}`;
    const t = per.length ? `${med(per).toFixed(2)} [${Math.min(...per).toFixed(2)}–${Math.max(...per).toFixed(2)}] n=${per.length}` : `failed (${rs[0]?.error})`;
    console.log(`${throttle}x\t${set}\t${variant}\t${t}\texact ${exact}${pv}`);
  }
}
process.exit(0);
