// Time one build of the decoder against another, byte-exactness first. docs/decode/README.md
//
// usage: node build_arms.mjs --arms plain,lto FIXTURE_DIR [FIXTURE_DIR ...] [--rounds N]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { loadFixture, median, range, sha256 } from './decoder.mjs';

const require = createRequire(import.meta.url);
const armsDir = process.env.ARMS_DIR || path.join(process.cwd(), 'lab/.openjph-build/wasm');
const argv = process.argv.slice(2);
const pick = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i === -1 ? dflt : argv[i + 1];
};
const names = pick('--arms', 'plain,lto').split(',');
const ROUNDS = Number(pick('--rounds', 9));
const dirs = argv.filter((a, i) => !a.startsWith('--') && !['--arms', '--rounds'].includes(argv[i - 1]));

if (!dirs.length) {
  console.error('usage: node build_arms.mjs --arms plain,lto FIXTURE_DIR [...] [--rounds N]');
  process.exit(2);
}

async function load(name) {
  const M = await require(path.join(armsDir, `${name}.js`))();
  // These builds export no HEAPU8; a typed_memory_view is backed by the WASM memory itself.
  const heap = () => {
    const d = new M.HTJ2KDecoder();
    try { return d.getEncodedBuffer(1).buffer.byteLength; } finally { d.delete(); }
  };
  return {
    name,
    heap,
    wasmBytes: fs.statSync(path.join(armsDir, `${name}.wasm`)).size,
    decode(bytes) {
      const d = new M.HTJ2KDecoder();
      try {
        d.getEncodedBuffer(bytes.length).set(bytes);
        d.readHeader();
        d.decode();
        return d.getDecodedBuffer();
      } finally { d.delete(); }
    },
  };
}

const arms = {};
for (const n of names) arms[n] = await load(n);
console.log(`arms: ${names.map((n) => `${n} (${(arms[n].wasmBytes / 1024).toFixed(0)} KB wasm)`).join(', ')}`);
console.log(`${ROUNDS - 1} timed rounds, order rotated each round; the first arm is the baseline`);

const consume = (b) => b[0] + b[b.length - 1];

for (const dir of dirs) {
  const { frames, truth, meta, name } = loadFixture(dir);
  for (const n of names) {
    const wrong = frames.filter((f, i) => sha256(arms[n].decode(f).slice()) !== truth[i]).length;
    if (wrong) {
      console.error(`${name}/${n}: ${wrong}/${frames.length} frames differ from the encoder's input — not an arm`);
      process.exit(1);
    }
  }

  const got = Object.fromEntries(names.map((n) => [n, []]));
  for (let round = 0; round < ROUNDS; round++) {
    const order = names.map((_, i) => names[(i + round) % names.length]);
    const ms = {};
    for (const n of order) {
      const t0 = performance.now();
      let sink = 0;
      for (const f of frames) sink += consume(arms[n].decode(f));
      ms[n] = (performance.now() - t0) / frames.length;
      if (sink === Infinity) console.log('');
    }
    if (round) for (const n of names) got[n].push(ms[n]);
  }

  const bytes = meta.width * meta.height * meta.channels * (meta.maxValue > 255 ? 2 : 1);
  const base = median(got[names[0]]);
  console.log(`\n  ${name.replace('decode_', '')} — ${(bytes / 1024).toFixed(0)} KB decoded, ${frames.length} frames`);
  for (const n of names) {
    const [lo, hi] = range(got[n]);
    const m = median(got[n]);
    const better = n === names[0] ? '' :
      `  ${got[n].filter((v, i) => v < got[names[0]][i]).length}/${ROUNDS - 1} rounds faster`;
    const rel = n === names[0] ? 'baseline' : `${(((m - base) / base) * 100).toFixed(1)}%`;
    console.log(`    ${n.padEnd(8)} ${m.toFixed(3)} ms/frame [${lo.toFixed(3)}-${hi.toFixed(3)}]  ${rel.padStart(8)}  heap ${(arms[n].heap() / 1048576).toFixed(1)} MB${better}`);
  }
}
console.log('\n  container-measured: reported, not decided on. 5% with non-overlapping ranges is the bar.');
