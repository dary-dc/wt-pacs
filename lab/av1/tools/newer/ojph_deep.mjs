/**
 * VERSIONS: OpenJPH 0.31.0's WASM UVLC mask (fixed in 0.32.0) against 16-bit frames built to reach the deepest
 * bitplanes — noise, a one-pixel checkerboard, 8×2 blocks — each encoded by the served profile and decoded by
 * every WASM build, compared with its source. lab/av1/tools/newer/README.md
 *
 *   node lab/av1/tools/newer/ojph_deep.mjs [BUILD] [--mutate]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

const ROOT = new URL("../../../..", import.meta.url).pathname;
const BUILD = process.argv[2]?.startsWith("--") ? `${ROOT}/lab/.av1-build` : process.argv[2] ?? `${ROOT}/lab/.av1-build`;
const MUTATE = process.argv.includes("--mutate");
const OJPH = `${BUILD}/ojph-0.31.0/install`;
const ARMS = ["0.31.0-3.1.74", "0.32.0-3.1.74", "0.31.0-6.0.11", "0.32.0-6.0.11"];
const W = 256, H = 256;

let seed = 57;
const random16 = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 16;
const FRAMES = {
  noise: () => random16(),
  checker: (x, y) => ((x ^ y) & 1) * 65535,
  blocks: (x, y) => (((x >> 3) ^ (y >> 1)) & 1) * 65535,
};

const dir = mkdtempSync(`${tmpdir()}/ojph-deep-`);
const truth = {};
for (const [name, f] of Object.entries(FRAMES)) {
  const px = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = f(x, y);
  const pgm = Buffer.alloc(W * H * 2);
  px.forEach((v, i) => pgm.writeUInt16BE(v, 2 * i));
  writeFileSync(`${dir}/${name}.pgm`, Buffer.concat([Buffer.from(`P5\n${W} ${H}\n65535\n`), pgm]));
  execFileSync(`${OJPH}/bin/ojph_compress`, ["-i", `${dir}/${name}.pgm`, "-o", `${dir}/${name}.j2c`,
    "-num_decomps", "5", "-block_size", "{64,64}", "-prog_order", "RPCL", "-reversible", "true"],
  { env: { LD_LIBRARY_PATH: `${OJPH}/lib` }, stdio: "ignore" });
  if (MUTATE) px[1000] ^= 1;
  truth[name] = px;
}

let failed = 0;
for (const arm of ARMS) {
  const M = await createRequire(import.meta.url)(`${BUILD}/ojph-wasm/${arm}.js`)();
  for (const name of Object.keys(FRAMES)) {
    const j2c = readFileSync(`${dir}/${name}.j2c`);
    const d = new M.HTJ2KDecoder();
    d.getEncodedBuffer(j2c.length).set(j2c);
    d.readHeader();
    d.decode();
    const got = new Uint16Array(d.getDecodedBuffer().slice().buffer);
    const bad = got.reduce((n, v, i) => n + (v !== truth[name][i]), 0);
    failed += bad > 0;
    console.log(`${arm} ${name}: ${bad ? `${bad} samples differ` : "exact"}, ${j2c.length} B`);
    d.delete();
  }
}
process.exit(failed ? 1 : 0);
