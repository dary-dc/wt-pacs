// What it costs to copy a decoded frame out of the WASM heap, against decoded frame size.
// Handing back a view instead needs a shared heap; docs/decode/README.md says why that pairing
// is one decision rather than two.
//
// usage: node copy_cost.mjs FIXTURE_DIR [FIXTURE_DIR ...] [--rounds N]
import { instance, loadFixture, median, range, sha256 } from './decoder.mjs';

const args = process.argv.slice(2);
const r = args.indexOf('--rounds');
const ROUNDS = r === -1 ? 7 : Number(args[r + 1]);
const dirs = (r === -1 ? args : args.slice(0, r)).filter(Boolean);

if (!dirs.length) {
  console.error('usage: node copy_cost.mjs FIXTURE_DIR [FIXTURE_DIR ...] [--rounds N]');
  process.exit(2);
}

// Both arms read the same two samples, so the only difference left is the copy itself.
const consume = (b) => b[0] + b[b.length - 1];
const ARMS = {
  copy: (inst, bytes) => consume(inst.decodeInPlace(bytes).slice()),
  view: (inst, bytes) => consume(inst.decodeInPlace(bytes)),
};

function pass(inst, frames, arm) {
  const t0 = performance.now();
  let sink = 0;
  for (const f of frames) sink += ARMS[arm](inst, f);
  return { ms: (performance.now() - t0) / frames.length, sink };
}

console.log(`copy vs view, ${ROUNDS - 1} timed rounds, arms interleaved and rotated each round`);
console.log('  fixture      decoded    copy ms/frame*      view ms/frame*      copy cost*   slower in');
for (const dir of dirs) {
  const { frames, truth, meta, name } = loadFixture(dir);
  const inst = await instance();

  const bytes = meta.width * meta.height * meta.channels * (meta.maxValue > 255 ? 2 : 1);
  const wrong = frames.filter((f, i) => sha256(inst.decodeInPlace(f)) !== truth[i]).length;
  if (wrong) {
    console.error(`${name}: ${wrong}/${frames.length} frames differ from the encoder's input`);
    process.exit(1);
  }

  const got = { copy: [], view: [] };
  for (let round = 0; round < ROUNDS; round++) {
    const order = round % 2 ? ['view', 'copy'] : ['copy', 'view'];
    const ms = {};
    for (const arm of order) ms[arm] = pass(inst, frames, arm).ms;
    if (round) for (const arm of order) got[arm].push(ms[arm]);
  }

  const n = ROUNDS - 1;
  const slower = got.copy.filter((c, i) => c > got.view[i]).length;
  const [cl, ch] = range(got.copy);
  const [vl, vh] = range(got.view);
  const delta = median(got.copy) - median(got.view);
  console.log(
    `  ${name.replace('decode_', '').padEnd(10)} ${String((bytes / 1024).toFixed(0) + ' KB').padStart(8)}` +
      `   ${median(got.copy).toFixed(3)} [${cl.toFixed(3)}-${ch.toFixed(3)}]` +
      `   ${median(got.view).toFixed(3)} [${vl.toFixed(3)}-${vh.toFixed(3)}]` +
      `   ${delta.toFixed(3).padStart(7)} ms   ${slower}/${n}`
  );
}
console.log('  * container-measured, not a timing rig: reported, not used for any decision.');
