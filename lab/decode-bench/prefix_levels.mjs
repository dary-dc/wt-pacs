// How much of a resolution-ordered codestream each level needs, and what each decoder does
// with that prefix. L19 — docs/decode/README.md §A prefix draws a smaller image.
//
//   node lab/decode-bench/prefix_levels.mjs [fixture ...]
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { instance, loadFixture, sha256, median } from './decoder.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = process.argv.slice(2);
if (!fixtures.length) fixtures.push('decode_c512', 'decode_g512');
const REPEATS = Number(process.env.REPEATS || 9);

/** One decode at `level`; null when the decoder refuses the bytes. */
function decodeAt(M, bytes, level, sub = true) {
  const d = new M.HTJ2KDecoder();
  try {
    d.getEncodedBuffer(bytes.length).set(bytes);
    d.readHeader();
    if (level === 0 || !sub) d.decode();
    else d.decodeSubResolution(level);
    return d.getDecodedBuffer().slice();
  } catch {
    return null;
  } finally {
    d.delete();
  }
}

const digest = (out) => (out === null ? null : sha256(out));

/**
 * Smallest prefix whose decode at `level` matches the whole codestream's. Binary search is
 * sound only if the property is monotone in length; the caller mutation-checks the boundary.
 */
function minimalPrefix(M, bytes, level, want) {
  let lo = 1;
  let hi = bytes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (digest(decodeAt(M, bytes.subarray(0, mid), level)) === want) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function timeDecode(M, bytes, level) {
  const t = process.hrtime.bigint();
  decodeAt(M, bytes, level);
  return Number(process.hrtime.bigint() - t) / 1000;
}

const M = (await instance()).module;
const require_ = createRequire(import.meta.url);
const armsDir = process.env.ARMS || path.join(here, '..', '.openjph-build', 'wasm');
let source = null;
try {
  source = await require_(path.join(armsDir, 'plain.js'))();
} catch {
  /* reported per fixture below */
}

for (const name of fixtures) {
  const fx = loadFixture(path.join(here, '..', 'fixtures', name));
  const probe = new M.HTJ2KDecoder();
  probe.getEncodedBuffer(fx.frames[0].length).set(fx.frames[0]);
  probe.readHeader();
  const levels = probe.getNumDecompositions();
  const order = probe.getProgressionOrder();
  probe.delete();
  const bytesPerSample = fx.meta.maxValue > 255 ? 2 : 1;

  console.log(`\n## ${name} — ${fx.meta.width}x${fx.meta.height}x${fx.meta.channels}, ` +
    `${bytesPerSample * 8}-bit, ${levels} decompositions, progression ${order}`);
  console.log('level  image      bytes needed   of full   decode us   full us   mutation   source build');

  for (let level = 0; level <= levels; level++) {
    const needed = [];
    const prefixUs = [];
    const fullUs = [];
    let mutationHeld = true;
    let outBytes = 0;

    for (const bytes of fx.frames) {
      const want = digest(decodeAt(M, bytes, level));
      if (want === null) { mutationHeld = false; continue; }
      const n = minimalPrefix(M, bytes, level, want);
      needed.push(n);
      outBytes = decodeAt(M, bytes, level).length;

      // The claim is that n is minimal: one byte short must not reproduce the same image.
      if (n > 1 && digest(decodeAt(M, bytes.subarray(0, n - 1), level)) === want) mutationHeld = false;

      for (let r = 0; r < REPEATS; r++) {
        // Interleaved, order reversed every repeat — CLAUDE.md#measurement.
        const prefix = () => prefixUs.push(timeDecode(M, bytes.subarray(0, n), level));
        const full = () => fullUs.push(timeDecode(M, bytes, 0));
        if (r % 2 === 0) { prefix(); full(); } else { full(); prefix(); }
      }
    }

    // What the other decoder makes of the same prefix, over every frame.
    let src = 'not built';
    if (source) {
      const outcomes = fx.frames.map((bytes, i) => {
        const out = decodeAt(source, bytes.subarray(0, needed[i] ?? bytes.length), level, false);
        return out === null ? 'threw' : `${out.length}`;
      });
      const uniq = [...new Set(outcomes)];
      src = uniq.length === 1 ? uniq[0] : `mixed (${uniq.join('/')})`;
      if (src !== 'threw') src = src === String(outBytes) ? `${src} B` : `${src} B (full size)`;
    }

    const px = Math.round(Math.sqrt(outBytes / (fx.meta.channels * bytesPerSample)));
    const med = median(needed);
    const frac = ((med / median(fx.frames.map((f) => f.length))) * 100).toFixed(1);
    console.log(
      `${String(level).padEnd(6)} ${String(px + 'x' + px).padEnd(10)} ` +
      `${String(med).padStart(12)} ${String(frac + '%').padStart(9)} ` +
      `${median(prefixUs).toFixed(0).padStart(10)} ${median(fullUs).toFixed(0).padStart(9)}   ` +
      `${(mutationHeld ? 'holds' : 'FAILED').padEnd(10)} ${src}`,
    );
  }
}

if (source) {
  const d = new source.HTJ2KDecoder();
  console.log(`\nsource build decodeSubResolution: ${typeof d.decodeSubResolution === 'function' ? 'present' : 'absent'}`);
  d.delete();
}

// The source build's own floor: the shortest prefix its decode() will return anything for.
// It is above the package's level-1 prefix, and what comes back is always full size.
if (source) {
  console.log('\nfixture      source-build floor   of full   vs package level-1 prefix');
  for (const name of fixtures) {
    const fx = loadFixture(path.join(here, '..', 'fixtures', name));
    const bytes = fx.frames[0];
    const ok = (n) => decodeAt(source, bytes.subarray(0, n), 0, false) !== null;
    let lo = 1;
    let hi = bytes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ok(mid)) hi = mid; else lo = mid + 1;
    }
    const want = digest(decodeAt(M, bytes, 1));
    const lvl1 = minimalPrefix(M, bytes, 1, want);
    const held = lo > 1 && !ok(lo - 1);
    console.log(
      `${name.padEnd(12)} ${String(lo).padStart(18)} ${((lo / bytes.length) * 100).toFixed(1).padStart(8)}% ` +
      `${('x' + (lo / lvl1).toFixed(2)).padStart(12)}   ${held ? 'floor holds' : 'NOT MONOTONE'}`,
    );
  }
}
