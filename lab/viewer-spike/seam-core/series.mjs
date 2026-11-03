// The spike's series: synthetic 16-bit slices encoded HTJ2K by OpenJPH, each frame's XXH3-64 in the metadata, packed
// by the core's pack-series. README.md here.
//   node series.mjs --core DIR --ojph DIR/install --out DIR
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { W, H, SLICES, SPACING, MARK, sample } from "./shape.mjs";

const arg = (k) => { const i = process.argv.indexOf(k); if (i < 0) throw new Error(`${k} is required`); return process.argv[i + 1]; };
const core = arg("--core"), ojph = arg("--ojph"), out = arg("--out");
mkdirSync(join(out, "frames"), { recursive: true });

new Function(readFileSync(join(core, "client/decode/wasm/vendor/hash-wasm/xxhash3.umd.min.js"), "utf8")).call(globalThis);
const digests = [];
for (let k = 0; k < SLICES; k++) {
  const samples = new Uint16Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) samples[i + j * W] = sample(i, j, k);
  // PGM wants big-endian samples; the digest is over the decoded samples as the page holds them, little-endian.
  const be = Buffer.alloc(W * H * 2);
  samples.forEach((s, n) => be.writeUInt16BE(s, 2 * n));
  const pgm = join(out, `${k}.pgm`);
  writeFileSync(pgm, Buffer.concat([Buffer.from(`P5\n${W} ${H}\n65535\n`), be]));
  const name = String(k).padStart(3, "0");
  execFileSync(join(ojph, "bin/ojph_compress"), ["-i", pgm, "-o", join(out, "frames", `${name}.htj2k`), "-num_decomps", "5",
    "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"], { env: { ...process.env, LD_LIBRARY_PATH: join(ojph, "lib") }, stdio: "ignore" });
  digests.push(await globalThis.hashwasm.xxhash3(new Uint8Array(samples.buffer)));
}
const metadata = {
  frameCount: SLICES, width: W, height: H, codec: "htj2k", photometric: "MONOCHROME2", modality: "OT", pixelSpacing: SPACING, mark: MARK,
  window: { center: [16000], width: [28000], function: "LINEAR" },
  digests: { algorithm: "xxh3-64", frames: digests },
};
writeFileSync(join(out, "metadata.json"), JSON.stringify(metadata));
execFileSync(join(core, "target/release/pack-series"), ["--metadata", join(out, "metadata.json"), "--frames", join(out, "frames"), "--output", join(out, "series.sbnd")], { stdio: "ignore" });
console.log(join(out, "series.sbnd"));
