// Does the build in wasm/ stand in for the prebuilt package? Same surface, same bytes.
// Every frame is checked against both the package and the encoder's input.
//
// usage: node parity.mjs FIXTURE_DIR [FIXTURE_DIR ...]
import { createRequire } from 'node:module';
import path from 'node:path';
import { instance, loadFixture, sha256 } from './decoder.mjs';

const require = createRequire(import.meta.url);
const armsDir = process.env.ARMS || path.join(process.cwd(), 'lab/.openjph-build/wasm');
const arm = process.env.ARM || 'plain';
const dirs = process.argv.slice(2);

if (!dirs.length) {
  console.error('usage: node parity.mjs FIXTURE_DIR [FIXTURE_DIR ...]');
  process.exit(2);
}

const HEADER_GETTERS = [
  'getIsHeaderValid',
  'getNumDecompositions',
  'getIsReversible',
  'getProgressionOrder',
  'getNumLayers',
  'getImageOffset',
  'getTileOffset',
  'getTileSize',
  'getBlockDimensions',
];

const plain = (v) => (typeof v === 'object' && v !== null ? JSON.stringify({ ...v }) : JSON.stringify(v));

/** Everything the surface exposes after readHeader(), as comparable text. */
function surface(d) {
  const out = { getFrameInfo: plain(d.getFrameInfo()) };
  for (const m of HEADER_GETTERS) out[m] = plain(d[m]());
  out.getDownSample = plain(d.getDownSample(0));
  out.getPrecinct = plain(d.getPrecinct(0));
  return out;
}

function decodeWith(M, bytes) {
  const d = new M.HTJ2KDecoder();
  try {
    d.getEncodedBuffer(bytes.length).set(bytes);
    d.readHeader();
    const s = surface(d);
    d.decode();
    return { surface: s, pixels: Buffer.from(d.getDecodedBuffer()) };
  } finally {
    d.delete();
  }
}

const ours = await require(path.join(armsDir, `${arm}.js`))();
const theirsInstance = await instance();
const theirs = theirsInstance.module;

console.log(`ours:   getVersion()=${ours.getVersion()} getSIMDLevel()=${ours.getSIMDLevel()}`);
console.log(`theirs: getVersion()=${theirs.getVersion()} getSIMDLevel()=${theirs.getSIMDLevel()}`);
let bad = 0;
if (ours.getVersion() !== theirs.getVersion()) {
  console.error('  version differs — these are not the same OpenJPH release');
  bad++;
}
if (ours.getSIMDLevel() !== 1) {
  console.error('  ours reports SIMD level 0 — the -msimd128 path was lost');
  bad++;
}

console.log('\n  fixture   frames   bytes vs package   bytes vs encoder   surface');
for (const dir of dirs) {
  const { frames, truth, name } = loadFixture(dir);
  let pixelDiff = 0, truthDiff = 0;
  const surfaceDiff = new Set();
  for (let i = 0; i < frames.length; i++) {
    const a = decodeWith(ours, frames[i]);
    const b = decodeWith(theirs, frames[i]);
    if (Buffer.compare(a.pixels, b.pixels) !== 0) pixelDiff++;
    if (sha256(a.pixels) !== truth[i]) truthDiff++;
    for (const k of Object.keys(b.surface)) if (a.surface[k] !== b.surface[k]) surfaceDiff.add(`${k}: ours ${a.surface[k]} theirs ${b.surface[k]}`);
  }
  const ok = (n) => (n === 0 ? `${frames.length}/${frames.length} identical` : `${n} DIFFER`);
  console.log(
    `  ${name.replace('decode_', '').padEnd(8)} ${String(frames.length).padStart(5)}   ` +
      `${ok(pixelDiff).padEnd(18)} ${ok(truthDiff).padEnd(18)} ` +
      `${surfaceDiff.size ? [...surfaceDiff].join('; ') : 'identical'}`
  );
  bad += pixelDiff + truthDiff + surfaceDiff.size;
}

console.log(bad ? `\nPARITY FAILED: ${bad} difference(s)` : '\nPARITY OK: same surface, same bytes, on every frame');
process.exit(bad ? 1 : 0);
