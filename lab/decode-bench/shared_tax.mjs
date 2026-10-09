// What a shared heap costs, and what decoding actually demands when the heap is not
// preallocated. Both variants are lab/decode-bench/wasm/build.sh output: one source, one
// toolchain, differing only in -pthread. docs/decode/README.md says what it decides.
//
// usage: node shared_tax.mjs FIXTURE_DIR [FIXTURE_DIR ...] [--rounds N]
import { createRequire } from 'node:module';
import path from 'node:path';
import { leadsByPredecessor, order } from '../order.mjs';
import { loadFixture, MB, median, range, sha256 } from './decoder.mjs';

const require = createRequire(import.meta.url);
const variantsDir = process.env.VARIANTS || path.join(process.cwd(), 'lab/.openjph-build/wasm');
const args = process.argv.slice(2);
const r = args.indexOf('--rounds');
const ROUNDS = r === -1 ? 7 : Number(args[r + 1]);
const dirs = (r === -1 ? args : args.slice(0, r)).filter(Boolean);

if (!dirs.length) {
  console.error('usage: node shared_tax.mjs FIXTURE_DIR [FIXTURE_DIR ...] [--rounds N]');
  process.exit(2);
}

async function variant(name) {
  const M = await require(path.join(variantsDir, `${name}.js`))();
  return {
    name,
    shared: M.HEAPU8.buffer instanceof SharedArrayBuffer,
    heap: () => M.HEAPU8.length,
    decode(bytes) {
      const d = new M.HTJ2KDecoder();
      try {
        d.getEncodedBuffer(bytes.length).set(bytes);
        d.decode();
        return d.getDecodedBuffer();
      } finally {
        d.delete();
      }
    },
  };
}

const variants = { plain: await variant('plain'), shared: await variant('shared') };
for (const a of Object.values(variants)) {
  console.log(`${a.name}: heap ${MB(a.heap())} MB at load, SharedArrayBuffer=${a.shared}`);
}
if (variants.plain.shared || !variants.shared.shared) {
  console.error('the two variants do not differ in how their heap is shared — rebuild');
  process.exit(1);
}

console.log(`\n${ROUNDS - 1} timed rounds, variants in a Williams order (lab/order.mjs)`);
console.log('  fixture     decoded    plain heap   shared heap   plain ms/frame*     shared ms/frame*    tax*      slower in');
for (const dir of dirs) {
  const { frames, truth, meta, name } = loadFixture(dir);
  const bytes = meta.width * meta.height * meta.channels * (meta.maxValue > 255 ? 2 : 1);

  for (const a of Object.values(variants)) {
    const wrong = frames.filter((f, i) => sha256(a.decode(f)) !== truth[i]).length;
    if (wrong) {
      console.error(`${name}/${a.name}: ${wrong}/${frames.length} frames differ from the encoder's input`);
      process.exit(1);
    }
  }

  const got = { plain: [], shared: [] };
  const rows = [];
  for (let round = 0; round < ROUNDS; round++) {
    const seq = order(['plain', 'shared'], round);
    const ms = {};
    for (const k of seq) {
      const t0 = performance.now();
      for (const f of frames) variants[k].decode(f);
      ms[k] = (performance.now() - t0) / frames.length;
    }
    if (round) for (const k of seq) got[k].push(ms[k]);
    if (round) seq.forEach((u, i) => rows.push({ round, unit: u, prev: seq[i - 1] ?? null, v: ms[u] }));
  }

  const n = ROUNDS - 1;
  const slower = got.shared.filter((s, i) => s > got.plain[i]).length;
  const [pl, ph] = range(got.plain);
  const [sl, sh] = range(got.shared);
  const tax = (median(got.shared) / median(got.plain) - 1) * 100;
  console.log(
    `  ${name.replace('decode_', '').padEnd(9)} ${String((bytes / 1024).toFixed(0) + ' KB').padStart(8)}` +
      `   ${MB(variants.plain.heap()).padStart(6)} MB   ${MB(variants.shared.heap()).padStart(6)} MB` +
      `   ${median(got.plain).toFixed(2)} [${pl.toFixed(2)}-${ph.toFixed(2)}]` +
      `   ${median(got.shared).toFixed(2)} [${sl.toFixed(2)}-${sh.toFixed(2)}]` +
      `   ${tax >= 0 ? '+' : ''}${tax.toFixed(1)}%   ${slower}/${n}`
  );
  for (const line of leadsByPredecessor(rows, ['plain', 'shared'], [['shared', 'plain']], 2)) console.log(`  ${line}`);
}
console.log('  * container-measured, not a timing rig: reported, not used for any decision.');
console.log('  Heap columns are the high-water after this fixture, cumulative across the row above.');
