// Cells D and E (docs/decode/mobile/htj2k-lossy.md §4): the client's HTJ2K and dav1d WASM builds in node, three arms
// interleaved by rotation, each frame timed alone; the lossy frames' samples hashed against the native decoder's.
//
//   node lab/av1/htj2k-lossy/bench.mjs STREAMS_DIR [ROUNDS] > rows.json
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

globalThis.require = createRequire(import.meta.url);
globalThis.fetch = async (url) => new Response(readFileSync(String(url).replace(/^file:\/\//, "")));
const ROOT = new URL("../../../", import.meta.url).pathname;
const { built } = await import(`${ROOT}client/decode/wasm-glue.js`);
const htj2k = await import(`${ROOT}client/decode/htj2k.js`);
const dav1d = await import(`${ROOT}client/decode/av1-dav1d.js`);

const dir = process.argv[2];
const rounds = Number(process.argv[3] ?? 10);
const meta = JSON.parse(readFileSync(`${dir}/streams.json`, "utf8"));
const files = (prefix) => readdirSync(dir).filter((f) => f.startsWith(prefix)).sort().map((f) => new Uint8Array(readFileSync(`${dir}/${f}`)));
const coded = { lossless: files("lossless-"), lossy: files("lossy-"), av1: files("av1-") };

for (const [name, mod] of [["openjph", htj2k], ["dav1d", dav1d]]) {
  const d = await built(name);
  globalThis.__dirname = d.dir;
  await mod.init(d);
}

const sha = (u8) => createHash("sha256").update(u8).digest("hex");
const lossyHashes = coded.lossy.map((b) => {
  const f = htj2k.decodeFrame(b);
  return sha(new Uint8Array(f.sab, 0, f.byteCount));
});

const decode = {
  lossless: (b) => htj2k.decodeFrame(b),
  lossy: (b) => htj2k.decodeFrame(b),
  av1: (b, i) => dav1d.picture(b, { key: i % meta.g === 0, gen: 0, index: i }),
};
const arms = ["lossless", "lossy", "av1"];
const times = Object.fromEntries(arms.map((a) => [a, []]));
for (let r = 0; r <= rounds; r++) {
  for (let k = 0; k < arms.length; k++) {
    const arm = arms[(k + r) % arms.length];
    coded[arm].forEach((b, i) => {
      const t0 = performance.now();
      decode[arm](b, i);
      const ms = performance.now() - t0;
      if (r > 0) times[arm].push({ round: r, frame: i, ms });
    });
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const ms = Object.fromEntries(arms.map((a) => [a, median(times[a].map((t) => t.ms))]));
const bytes = Object.fromEntries(arms.map((a) => [a, coded[a].reduce((n, b) => n + b.length, 0)]));
console.log(JSON.stringify({
  set: meta.set, delta: meta.delta, frames: meta.frames, rounds, node: process.version, ms, bytes,
  lossy_over_lossless: ms.lossy / ms.lossless, lossy_over_av1: ms.lossy / ms.av1,
  wasm_equals_native: lossyHashes.map((h, i) => h === meta.native_sha256[i]), wasm_sha256: lossyHashes, times,
}));
