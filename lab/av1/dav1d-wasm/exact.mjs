// Every frame of every stream through each WASM arm, against the encoder's input and two native
// decoders. Exit 1 when the WASM differs from either native decoder or the two ground truths
// disagree; a stream all three decode alike but not to the input is the encoder's, reported as such.
//
//   node lab/av1/dav1d-wasm/exact.mjs [arm ...]      MUTATE=sample|order to watch it fail
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDecoder, ivfFrames } from "./dav1d.mjs";

const BUILD = process.env.BUILD ?? join(dirname(fileURLToPath(import.meta.url)), "../../.av1-build");
const STREAMS = join(BUILD, "streams");
const arms = process.argv.slice(2).length ? process.argv.slice(2) : ["plain", "simd", "simd-mt"];
const require = createRequire(import.meta.url);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const bytesOf = (p) => new Uint8Array(p.buffer, p.byteOffset, p.byteLength);
const FMT = { g8: "gray", g10: "gray10le", g12: "gray12le", c8: "gbrp", c10: "gbrp10le", c12: "gbrp12le" };

/** The generator's sample order: interleaved R, G, B for colour, from planes coded G, B, R. */
function interleaved(planes) {
  if (planes.length === 1) return bytesOf(planes[0]);
  const [g, b, r] = process.env.MUTATE === "order" ? [planes[0], planes[2], planes[1]] : planes;
  const out = new g.constructor(g.length * 3);
  for (let i = 0; i < g.length; i++) {
    out[3 * i] = r[i];
    out[3 * i + 1] = g[i];
    out[3 * i + 2] = b[i];
  }
  return bytesOf(out);
}

function frameHashes(file, frameBytes) {
  const all = readFileSync(file);
  const out = [];
  for (let at = 0; at < all.length; at += frameBytes) out.push(sha(all.subarray(at, at + frameBytes)));
  return out;
}

function references(cell, stream, frameBytes) {
  const dir = join(STREAMS, cell);
  const native = join(dir, `${stream}.dav1d.yuv`);
  if (!existsSync(native)) {
    execFileSync(join(BUILD, "native/tools/dav1d"),
      ["-q", "--threads", "1", "-i", join(dir, `${stream}.ivf`), "--muxer", "yuv", "-o", native]);
  }
  const ff = join(dir, `${stream}.ffmpeg.raw`);
  if (!existsSync(ff)) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-c:v", "libdav1d", "-i", join(dir, `${stream}.ivf`),
      "-f", "rawvideo", "-pix_fmt", FMT[cell], ff]);
  }
  return {
    input: frameHashes(join(dir, "input.raw"), frameBytes),
    dav1d: frameHashes(native, frameBytes),
    ffmpeg: frameHashes(ff, frameBytes),
  };
}

let failures = 0;
for (const arm of arms) {
  const factory = require(join(BUILD, "out", `${arm}.js`));
  for (const cell of readdirSync(STREAMS).sort()) {
    const truth = readFileSync(join(STREAMS, cell, "input.sha256"), "utf8").trim().split("\n");
    for (const stream of ["g1", "g8"]) {
      const dec = await createDecoder(factory, { threads: arm.endsWith("-mt") ? 4 : 1 });
      const tally = { generator: 0, input: 0, dav1d: 0, ffmpeg: 0 };
      let refs = null;
      let n = 0;
      let split = 0;
      let shape = "";
      for (const tu of ivfFrames(readFileSync(join(STREAMS, cell, `${stream}.ivf`)))) {
        const f = dec.decode(tu);
        if (process.env.MUTATE === "sample") f.planes[0][n % f.planes[0].length] ^= 1;
        const planar = Buffer.concat(f.planes.map(bytesOf));
        refs ??= references(cell, stream, planar.length);
        shape = `${f.width}x${f.height} ${f.bits}-bit layout ${f.layout} matrix ${f.matrix}`;
        const generator = sha(interleaved(f.planes)) === truth[n];
        if (generator) tally.generator++;
        for (const k of ["input", "dav1d", "ffmpeg"]) if (sha(planar) === refs[k][n]) tally[k]++;
        // The two ground truths are one input in two orders: a frame matching one and not the other
        // is this check's bug, never the encoder's.
        if (generator !== (sha(planar) === refs.input[n])) split++;
        n++;
      }
      dec.close();
      const native = n === truth.length && tally.dav1d === n && tally.ffmpeg === n && !split;
      const status = !native ? "FAIL   " : tally.generator === n && tally.input === n ? "exact  " : "encoder";
      if (!native) failures++;
      const cols = Object.entries(tally).map(([k, v]) => `${k} ${v}/${n}`).join("  ");
      console.log(`${status}  ${arm.padEnd(7)} ${cell} ${stream.padEnd(2)}  ${shape}  ${cols}`);
    }
  }
}
process.exit(failures ? 1 : 0);
