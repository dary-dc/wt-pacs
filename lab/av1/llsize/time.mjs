/**
 * LLSIZE's decode time: dav1d-WASM `simd` in Node on each named coding of a set, one decoder a plane
 * stream, every frame decoded alone, merged and hashed against the truth. Each throttle is a fresh
 * process each round, throttles in a Williams order (lab/order.mjs), sets and codings rotating inside.
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/llsize/time.mjs --codings set:rep.variant,... [--rounds 10]
 *     [--throttles 1,4] [--mutate sample] [--out rows.json] [--work DIR]
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createDecoder, ivfFrames } from "../dav1d-wasm/dav1d.mjs";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const require = createRequire(import.meta.url);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = new URL("../../..", import.meta.url).pathname;
const WORK = arg("--work", `${ROOT}lab/.av1-work/llsize`);
const CODINGS = arg("--codings", "").split(",").filter(Boolean);

/** Decoded planes, in the order coded, back to the samples as stored (interleaved, offset removed). */
function merge(rep, meta, streams) {
  const { width: w, height: h, channels: ch, bitsStored, signed, min } = meta;
  const offset = min < 0 ? -min : 0;
  const out = bitsStored <= 8 ? new Uint8Array(w * h * ch) : signed ? new Int16Array(w * h * ch) : new Uint16Array(w * h * ch);
  const at = (f, c, x, y) => f.planes[c][y * f.width + x];
  const k = rep.startsWith("low") ? Number(rep.slice(3)) : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const [f, g] = streams;
      if (ch === 1) out[i] = (k ? (at(f, 0, x, y) << k) | at(g, 0, x, y) : at(f, 0, x, y)) - offset;
      else if (rep === "gbr") [out[i], out[i + 1], out[i + 2]] = [at(f, 2, x, y), at(f, 0, x, y), at(f, 1, x, y)];
      else if (rep === "rct") {
        const cb = at(f, 1, x, y) - 256, cr = at(f, 2, x, y) - 256;
        const gg = at(f, 0, x, y) - ((cb + cr) >> 2);
        [out[i], out[i + 1], out[i + 2]] = [cr + gg, gg, cb + gg];
      } else {
        const co = at(f, 1, x, y) - 256, cg = at(f, 2, x, y) - 256;
        const t = at(f, 0, x, y) - (cg >> 1);
        const b = t - (co >> 1);
        [out[i], out[i + 1], out[i + 2]] = [b + co, cg + t, b];
      }
    }
  }
  return new Uint8Array(out.buffer);
}

function load(coding) {
  const [set, name] = coding.split(":");
  const [rep, variant] = name.split(".");
  const meta = JSON.parse(readFileSync(`${ROOT}lab/av1/data/${set}/metadata.json`));
  const cell = `${WORK}/${set}.${rep}.${variant}`;
  const streams = [];
  for (let j = 0; existsSync(`${cell}/${j}.ivf`); j++) streams.push([...ivfFrames(new Uint8Array(readFileSync(`${cell}/${j}.ivf`)))]);
  const truth = streams[0].map((_, i) => readFileSync(`${ROOT}lab/av1/data/${set}/${String(i).padStart(3, "0")}.sha256`, "utf8").trim());
  return { coding, set, rep, meta, streams, truth };
}

async function child({ r, mutate }) {
  const factory = require(`${ROOT}lab/.av1-build/out/simd.js`);
  const codings = CODINGS.map(load);
  const rows = [];
  for (const c of order(codings, r)) {
    const decoders = await Promise.all(c.streams.map(() => createDecoder(factory)));
    for (const [j, s] of c.streams.entries()) decoders[j].decode(s[0]);
    let ms = 0;
    let exact = 0;
    for (let i = 0; i < c.truth.length; i++) {
      const t0 = performance.now();
      const frames = c.streams.map((s, j) => decoders[j].decode(s[i]));
      const bytes = merge(c.rep, c.meta, frames);
      ms += performance.now() - t0;
      if (mutate === "sample") bytes[0] ^= 1;
      exact += createHash("sha256").update(bytes).digest("hex") === c.truth[i];
    }
    decoders.forEach((d) => d.close());
    rows.push({ coding: c.coding, round: r, ms: ms / c.truth.length, frames: c.truth.length, exact });
  }
  return rows;
}

if (arg("--child")) {
  process.stdout.write(JSON.stringify(await child(JSON.parse(arg("--child")))));
  process.exit(0);
}

const ROUNDS = Number(arg("--rounds", 10));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", null);
const rows = [];
for (let r = 0; r < ROUNDS; r++) {
  for (const throttle of order(THROTTLES, r)) {
    const proc = spawn(process.execPath, [new URL(import.meta.url).pathname, "--codings", CODINGS.join(","), "--work", WORK,
      "--child", JSON.stringify({ r, mutate: MUTATE })], { stdio: ["ignore", "pipe", "inherit"] });
    const stop = throttleTree(proc.pid, throttle);
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    await new Promise((ok) => proc.once("exit", ok));
    stop();
    rows.push(...JSON.parse(out).map((row) => ({ throttle, ...row })));
    if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  }
  process.stderr.write(`round ${r} done\n`);
}

const median = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const groups = new Map();
for (const row of rows) groups.set(`${row.throttle} ${row.coding}`, [...(groups.get(`${row.throttle} ${row.coding}`) ?? []), row]);
for (const [k, g] of groups) {
  const ms = g.map((x) => x.ms);
  console.log(`${k}\t${median(ms).toFixed(2)} [${Math.min(...ms).toFixed(2)}–${Math.max(...ms).toFixed(2)}] ms/frame\tn=${g.length}\t${g.reduce((n, x) => n + x.exact, 0)}/${g.reduce((n, x) => n + x.frames, 0)}`);
}
process.exit(0);
