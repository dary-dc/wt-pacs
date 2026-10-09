/**
 * Where a lossless frame's decode time goes: the product's decode-av1.js on dav1d-WASM built with
 * function names (`simd-prof`), every frame of a set decoded REPEAT times under V8's sampling profiler,
 * self time summed per function and per stage. Every frame is checked against its truth checksum.
 * lab/av1/decode/settings/README.md
 *
 *   node lab/av1/decode/settings/profile.mjs [--frames lab/.av1-work/decspeed] [--ext av1] [--repeat 3] [--top 25]
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Session } from "node:inspector/promises";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FRAMES = arg("--frames", "lab/.av1-work/decspeed");
const EXT = arg("--ext", "av1");
const REPEAT = Number(arg("--repeat", 3));
const TOP = Number(arg("--top", 25));
const MUTATE = arg("--mutate", "");
const ROOT = new URL("../../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;

globalThis.self = globalThis;
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = "/";
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

/** dav1d's functions by the stage they serve; the first pattern that matches a name wins. */
const STAGES = [
  ["entropy decoding", /msac|decode_coefs|read_|_cdf|^decode_b|decode_sb|decode_partition|get_.*ctx|dav1d_decode_tile|bitfn|setctx|splat_|reset_context/],
  ["inverse transform", /itx|inv_txfm|wht|_add_c$/],
  ["intra prediction", /ipred|intra|cfl|pal_|filter_edge|upsample_edge|smooth|paeth/],
  ["contract: copy-out, offset, range (JS)", /^place$|^begin$|^end$|^picture$|^decodeFrame$/],
  ["frame setup, copies, memory", /memcpy|memset|malloc|free|alloc|picture|refmvs|dav1d_submit|dav1d_parse|obu|flush|cdf_thread|init|thread/],
];
const stage = (name) => STAGES.find(([, re]) => re.test(name))?.[0] ?? "other";

const manifest = JSON.parse(readFileSync(`${ROOT}/${FRAMES}/manifest.json`, "utf8"));
const session = new Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.setSamplingInterval", { interval: 100 });

for (const set of manifest) {
  const av1 = await import(`../../../../client/downloader/decode-av1.js?${set.name}`);
  const out = `${BASE}/lab/.av1-build/out`;
  await av1.init({ codec: "av1", glue: `${out}/simd-prof.js`, wasm: `${out}/simd-prof.wasm`, dir: out });
  const bytes = set.frames.map((_, i) => readFileSync(`${ROOT}/${FRAMES}/${set.name}/${String(i).padStart(3, "0")}.${EXT}`));
  let exact = 0;
  for (const [i, b] of bytes.entries()) {
    const { sab } = av1.decodeFrame(new Uint8Array(b));
    const px = new Uint8Array(sab).slice();
    if (MUTATE === "sample") px[px.length >> 1] ^= 1;
    if (createHash("sha256").update(px).digest("hex") === set.frames[i].truth) exact++;
  }
  await session.post("Profiler.start");
  const t0 = performance.now();
  for (let k = 0; k < REPEAT; k++) for (const b of bytes) av1.decodeFrame(new Uint8Array(b));
  const wall = performance.now() - t0;
  const { profile } = await session.post("Profiler.stop");

  const self = new Map();
  const dt = new Map(profile.nodes.map((n) => [n.id, 0]));
  profile.samples.forEach((id, k) => dt.set(id, dt.get(id) + (profile.timeDeltas[k + 1] ?? 0)));
  for (const n of profile.nodes) {
    const name = n.callFrame.functionName || "(anonymous)";
    if (/^\((idle|program|garbage collector|root)\)$/.test(name)) continue;
    self.set(name, (self.get(name) ?? 0) + dt.get(n.id) / 1000);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const byStage = new Map();
  for (const [name, ms] of self) byStage.set(stage(name), (byStage.get(stage(name)) ?? 0) + ms);
  const n = bytes.length * REPEAT;
  console.log(`\n${set.name} ${EXT}: ${(wall / n).toFixed(1)} ms a frame (${n} decodes), ${(total / n).toFixed(1)} ms sampled; exact ${exact}/${bytes.length}`);
  for (const [s, ms] of [...byStage].sort((a, b) => b[1] - a[1])) console.log(`  ${(100 * ms / total).toFixed(1).padStart(5)} %  ${s}`);
  console.log(`  top functions, % of sampled self time:`);
  for (const [name, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
    console.log(`  ${(100 * ms / total).toFixed(1).padStart(5)} %  ${name}  [${stage(name)}]`);
  }
}
process.exit(0);
