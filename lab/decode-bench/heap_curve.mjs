// Heap high-water and decode time across a ladder of INITIAL_MEMORY builds, so the choice is
// a curve rather than a guess. The builds are interleaved in a Williams order: measuring them one
// after another is the sequential shape this project has already been wrong with.
// Driven by wasm/heap_curve.sh; docs/decode/README.md holds the numbers.
//
// usage: node heap_curve.mjs FIXTURE_DIR --variants LABEL=DIR [LABEL=DIR ...] [--rounds N]
import { createRequire } from 'node:module';
import path from 'node:path';
import { order } from '../order.mjs';
import { loadFixture, MB, median, range, sha256 } from './decoder.mjs';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const a = argv.indexOf('--variants');
const r = argv.indexOf('--rounds');
const ROUNDS = r === -1 ? 7 : Number(argv[r + 1]);
const dirs = argv.slice(0, a === -1 ? undefined : a).filter((x) => !x.startsWith('--'));
const variantSpecs = (a === -1 ? [] : argv.slice(a + 1, r === -1 ? undefined : r)).filter(Boolean);

if (!dirs.length || !variantSpecs.length) {
  console.error('usage: node heap_curve.mjs FIXTURE_DIR --variants LABEL=DIR [...] [--rounds N]');
  process.exit(2);
}

const variants = [];
for (const spec of variantSpecs) {
  const [label, dir] = spec.split('=');
  const M = await require(path.join(dir, 'plain.js'))();
  // One decoder object for every frame, which is what the product holds — client/decode/decoder.js.
  variants.push({ label, M, d: new M.HTJ2KDecoder(), atLoad: M.HEAPU8.length });
}

const decode = (d, b) => {
  d.getEncodedBuffer(b.length).set(b);
  d.readHeader();
  d.decode();
  return Buffer.from(d.getDecodedBuffer());
};

for (const dir of dirs) {
  const { frames, truth, meta, name } = loadFixture(dir);
  const bytes = meta.width * meta.height * meta.channels * (meta.maxValue > 255 ? 2 : 1);
  console.log(`\n${name.replace('decode_', '')}: ${(bytes / 1024).toFixed(0)} KB decoded, ${frames.length} frames, ${ROUNDS - 1} timed rounds`);

  const ms = new Map(variants.map((x) => [x.label, []]));
  const wrong = new Map(variants.map((x) => [x.label, 0]));
  for (let round = 0; round < ROUNDS; round++) {
    for (const x of order(variants, round)) {
      const t0 = performance.now();
      let bad = 0;
      for (let i = 0; i < frames.length; i++) if (sha256(decode(x.d, frames[i])) !== truth[i]) bad++;
      if (round) {
        ms.get(x.label).push((performance.now() - t0) / frames.length);
        wrong.set(x.label, wrong.get(x.label) + bad);
      }
    }
  }

  const best = Math.min(...variants.map((x) => median(ms.get(x.label))));
  console.log('  initial   at load   high-water   ms/frame*              vs best   correctness');
  for (const x of variants) {
    const [lo, hi] = range(ms.get(x.label));
    const med = median(ms.get(x.label));
    console.log(
      `  ${x.label.padStart(6)}   ${MB(x.atLoad).padStart(6)} MB   ${MB(x.M.HEAPU8.length).padStart(6)} MB` +
        `   ${med.toFixed(2)} [${lo.toFixed(2)}-${hi.toFixed(2)}]` +
        `   ${(((med / best - 1) * 100).toFixed(1) + '%').padStart(7)}   ${wrong.get(x.label) ? `${wrong.get(x.label)} WRONG` : 'verified'}`
    );
  }
}
console.log('\n  * container-measured, not a timing rig: reported, not used for any decision.');
