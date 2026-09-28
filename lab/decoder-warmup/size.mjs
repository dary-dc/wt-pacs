/**
 * WU2: what a warm-up costs one decoder and what it saves on that decoder's first frames, per
 * warm-up frame, so the idle window it needs can be read off per transport. A fresh browser context
 * per sample, the decoder compiled from a buffer as decoder.js does. docs/decode/README.md §Sizing the warm-up
 *
 *   NODE_PATH=$(npm root -g) node lab/decoder-warmup/size.mjs [--rounds 12] [--throttles 1,4]
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { leadsByPredecessor, order } from "../order.mjs";
import { loadFixture, median, range } from "../decode-bench/decoder.mjs";
import { throttleTree } from "../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const ROUNDS = Number(arg("--rounds", 12));
const THROTTLES = arg("--throttles", "1").split(",").map(Number);
const DECODER = arg("--decoder", "lab/decode-bench/vendor/openjph/openjphjs");
const FRAMES = 6;
const OWN = "086.j2c";

// The series' own frame is its last, never one of the frames timed.
const SETS = {
  cine512: { none: null, w160: "client/downloader/warmup/colour-8.j2c", own: `lab/fixtures/decode_cine512/${OWN}` },
  ct512: {
    none: null,
    w160: "client/downloader/warmup/grey-16.j2c",
    w512: "lab/fixtures/decode_warmup_g512/000.j2c",
    own: `lab/fixtures/decode_ct512/${OWN}`,
  },
};

const port = 23000 + ((Math.random() * 8000) | 0);
const host = spawn("python3", [path.join(ROOT, "server/dev-server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => host.kill());
await new Promise((r) => setTimeout(r, 1200));
const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || undefined });
const browser = await chromium.connect(server.wsEndpoint());

async function visit(set, warmup, truth, throttle) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/lab/decoder-warmup/README.md`);
  const stop = throttleTree(server.process().pid, throttle);
  const r = await page.evaluate(async ({ set, warmup, decoder, frames, truth }) => {
    const get = async (u) => new Uint8Array(await (await fetch(`/${u}`)).arrayBuffer());
    const src = await (await fetch(`/${decoder}.js`)).text();
    const wasmBinary = (await get(`${decoder}.wasm`)).buffer;
    const warm = warmup ? await get(warmup) : null;
    const series = [];
    for (let i = 0; i < frames; i++) series.push(await get(`lab/fixtures/decode_${set}/${String(i).padStart(3, "0")}.j2c`));
    const decode = (d, b) => {
      d.getEncodedBuffer(b.length).set(b);
      d.readHeader();
      d.decode();
      return d.getDecodedBuffer();
    };

    const t0 = performance.now();
    const factory = new Function(`${src}\nreturn typeof Module !== "undefined" ? Module : OpenJPHModule;`)();
    const M = await factory({ wasmBinary });
    const d = new M.HTJ2KDecoder();
    const compiled = performance.now();
    if (warm) decode(d, warm);
    const ready = performance.now();
    const ms = [];
    const outs = [];
    for (const f of series) {
      const t = performance.now();
      outs.push(decode(d, f).slice());
      ms.push(performance.now() - t);
    }
    let wrong = 0;
    for (let i = 0; i < outs.length; i++) {
      const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", outs[i]))].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (h !== truth[i]) wrong++;
    }
    return { compileMs: compiled - t0, warmMs: ready - compiled, ms, wrong };
  }, { set, warmup, decoder: DECODER, frames: FRAMES, truth });
  stop();
  await ctx.close();
  return r;
}

const rows = [];
for (const [set, arms] of Object.entries(SETS)) {
  const truth = loadFixture(path.join(ROOT, `lab/fixtures/decode_${set}`)).truth.slice(0, FRAMES);
  const names = Object.keys(arms);
  const cells = THROTTLES.flatMap((t) => names.map((a) => [t, a]));
  for (let round = 0; round < ROUNDS; round++) {
    let prev = null;
    for (const [throttle, arm] of order(cells, round)) {
      const r = await visit(set, arms[arm], truth, throttle);
      if (r.wrong) {
        console.error(`${set} ${arm}: ${r.wrong} frames differ from the encoder's input`);
        process.exit(1);
      }
      rows.push({ set, arm, throttle, round, prev, ...r });
      prev = `${arm}@${throttle}x`;
    }
  }
}

const f = (v) => v.toFixed(1);
const med = (v) => `${f(median(v))} [${range(v).map(f).join("-")}]`;
console.log(`${ROUNDS} rounds, arms and throttles in a Williams order (lab/order.mjs); one decoder, fresh context per sample; ms, medians [range]`);
console.log("w: the warm-up decode. s1, s2: what it saves on the decoder's first and second frame against none.");
console.log("pays: the idle window before the first byte at which frame 0 (s1) or the decoder's two frames (s1+s2) break even.");
for (const set of Object.keys(SETS)) {
  for (const throttle of THROTTLES) {
    const of = (arm) => rows.filter((r) => r.set === set && r.arm === arm && r.throttle === throttle);
    const none = of("none");
    const at = (arm, i) => median(of(arm).map((r) => r.ms[i]));
    console.log(`\n  ${set} at ${throttle}x`);
    for (const arm of Object.keys(SETS[set])) {
      const rs = of(arm);
      const frames = [0, 1, 2, 3, 4, 5].map((i) => f(at(arm, i))).join(" / ");
      const w = median(rs.map((r) => r.warmMs));
      const s1 = at("none", 0) - at(arm, 0);
      const s2 = at("none", 1) - at(arm, 1);
      const wins = rs.filter((r, i) => r.ms[0] + r.ms[1] < none[i].ms[0] + none[i].ms[1]).length;
      console.log(
        `    ${arm.padEnd(5)} compile ${med(rs.map((r) => r.compileMs)).padEnd(18)} w ${med(rs.map((r) => r.warmMs)).padEnd(18)} frames 0-5 ${frames}` +
          (arm === "none" ? "" : `\n          s1 ${f(s1)}  s2 ${f(s2)}  frames 0+1 faster ${wins}/${rs.length}  pays: frame 0 at ${f(w - s1)} ms, both at ${f(w - s1 - s2)} ms; hidden at ${f(w)} ms`),
      );
    }
  }
  const units = THROTTLES.flatMap((t) => Object.keys(SETS[set]).map((a) => `${a}@${t}x`));
  const byUnit = rows.filter((r) => r.set === set).map((r) => ({ round: r.round, unit: `${r.arm}@${r.throttle}x`, prev: r.prev, v: r.ms[0] + r.ms[1] }));
  const pairs = THROTTLES.flatMap((t) => Object.keys(SETS[set]).filter((a) => a !== "none").map((a) => [`${a}@${t}x`, `none@${t}x`]));
  console.log(`  ${set}, frames 0+1, ms: each lead by the predecessor it ran after, rounds in brackets`);
  for (const line of leadsByPredecessor(byUnit, units, pairs, 1)) console.log(`  ${line}`);
}
await browser.close();
await server.close();
process.exit(0);
