// What it costs to create and delete a decoder object per frame, against reusing one.
// Not a build flag, and the lane's candidate for the largest lever. docs/decode/README.md
//
// usage: node reuse_cost.mjs FIXTURE_DIR [FIXTURE_DIR ...] [--rounds N]
import { instance, loadFixture, median, range, sha256 } from './decoder.mjs';

const args = process.argv.slice(2);
const r = args.indexOf('--rounds');
const ROUNDS = r === -1 ? 9 : Number(args[r + 1]);
const dirs = (r === -1 ? args : args.slice(0, r)).filter(Boolean);

if (!dirs.length) {
  console.error('usage: node reuse_cost.mjs FIXTURE_DIR [FIXTURE_DIR ...] [--rounds N]');
  process.exit(2);
}

const consume = (b) => b[0] + b[b.length - 1];

function decodeWith(d, bytes) {
  d.getEncodedBuffer(bytes.length).set(bytes);
  d.readHeader();
  d.decode();
  return d.getDecodedBuffer();
}

/** Both arms decode the same frames and read the same two samples; only the object's life differs. */
function pass(M, frames, arm) {
  const t0 = performance.now();
  let sink = 0;
  if (arm === 'reused') {
    const d = new M.HTJ2KDecoder();
    for (const f of frames) sink += consume(decodeWith(d, f));
    d.delete();
  } else {
    for (const f of frames) {
      const d = new M.HTJ2KDecoder();
      sink += consume(decodeWith(d, f));
      d.delete();
    }
  }
  return { ms: (performance.now() - t0) / frames.length, sink };
}

console.log(`a decoder per frame vs one reused, ${ROUNDS - 1} timed rounds, interleaved and rotated`);
console.log('  fixture      decoded    per-frame ms*        reused ms*           saved*    reused faster in');
for (const dir of dirs) {
  const { frames, truth, meta, name } = loadFixture(dir);
  const inst = await instance();
  const M = inst.module;

  // Both arms must be byte-exact against the encoder's input before either is timed.
  for (const arm of ['fresh', 'reused']) {
    const out = [];
    if (arm === 'reused') {
      const d = new M.HTJ2KDecoder();
      for (const f of frames) out.push(sha256(decodeWith(d, f).slice()));
      d.delete();
    } else {
      for (const f of frames) {
        const d = new M.HTJ2KDecoder();
        out.push(sha256(decodeWith(d, f).slice()));
        d.delete();
      }
    }
    const wrong = out.filter((h, i) => h !== truth[i]).length;
    if (wrong) {
      console.error(`${name}/${arm}: ${wrong}/${frames.length} frames differ from the encoder's input`);
      process.exit(1);
    }
  }

  const bytes = meta.width * meta.height * meta.channels * (meta.maxValue > 255 ? 2 : 1);
  const got = { fresh: [], reused: [] };
  for (let round = 0; round < ROUNDS; round++) {
    const order = round % 2 ? ['reused', 'fresh'] : ['fresh', 'reused'];
    const ms = {};
    for (const arm of order) ms[arm] = pass(M, frames, arm).ms;
    if (round) for (const arm of order) got[arm].push(ms[arm]);
  }

  const n = ROUNDS - 1;
  const faster = got.reused.filter((v, i) => v < got.fresh[i]).length;
  const [fl, fh] = range(got.fresh);
  const [rl, rh] = range(got.reused);
  const delta = median(got.fresh) - median(got.reused);
  console.log(
    `  ${name.replace('decode_', '').padEnd(10)} ${String((bytes / 1024).toFixed(0) + ' KB').padStart(8)}` +
      `   ${median(got.fresh).toFixed(3)} [${fl.toFixed(3)}-${fh.toFixed(3)}]` +
      `   ${median(got.reused).toFixed(3)} [${rl.toFixed(3)}-${rh.toFixed(3)}]` +
      `   ${delta.toFixed(3).padStart(7)} ms   ${faster}/${n}`
  );
}
console.log('  * container-measured, not a timing rig: reported, not used for any decision.');
