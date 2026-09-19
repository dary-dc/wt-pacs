// Heap cost of decoding with N decoder instances. docs/decode/README.md says what it is for.
//
// usage: node decode_bench.mjs FIXTURE_DIR [rounds]
import { instance, loadFixture, MB, median, range, sha256 } from './decoder.mjs';

const fixtureDir = process.argv[2];
const ROUNDS = Number(process.argv[3] || 6); // round 0 warms up and is not counted
const WIDTHS = [1, 2, 3, 4];

if (!fixtureDir) {
  console.error('usage: node decode_bench.mjs FIXTURE_DIR [rounds]');
  process.exit(2);
}

const { frames, truth, meta, name } = loadFixture(fixtureDir);

/** `width` instances, frames dealt round-robin. Serial by design — the claim is memory. */
async function arm(width) {
  const pool = [];
  for (let i = 0; i < width; i++) pool.push(await instance());
  const floor = pool.map((p) => p.heap());
  const t0 = performance.now();
  let mismatch = 0;
  for (let f = 0; f < frames.length; f++) {
    const pixels = pool[f % width].decode(frames[f]);
    if (sha256(pixels) !== truth[f]) mismatch++;
  }
  const ms = (performance.now() - t0) / frames.length;
  const high = pool.map((p) => p.heap());
  return {
    ms,
    mismatch,
    floor: floor.reduce((a, b) => a + b, 0),
    high: high.reduce((a, b) => a + b, 0),
    each: high,
  };
}

const first = await instance();
const idle = first.heap();

const results = new Map(WIDTHS.map((w) => [w, []]));
for (let round = 0; round < ROUNDS; round++) {
  const shift = round % WIDTHS.length;
  for (const width of WIDTHS.slice(shift).concat(WIDTHS.slice(0, shift))) {
    const r = await arm(width);
    if (r.mismatch) {
      console.error(`width ${width}: ${r.mismatch}/${frames.length} frames differ from the encoder's input`);
      process.exit(1);
    }
    if (round) results.get(width).push(r);
  }
}

const n = ROUNDS - 1;
const decoded = meta.width ? meta.width * meta.height * meta.channels * (meta.maxValue > 255 ? 2 : 1) : 0;
console.log(
  `${name}: ${frames.length} frames` +
    (decoded ? `, ${meta.width}x${meta.height}x${meta.channels}, ${(decoded / 1024).toFixed(0)} KB decoded` : '') +
    `, ${n} timed rounds`
);
console.log(`  idle instance, no decode yet: ${MB(idle)} MB`);
console.log('  width   total heap   per instance   heap steady over rounds   ms/frame*');
for (const width of WIDTHS) {
  const rs = results.get(width);
  const highs = rs.map((r) => r.high);
  const [lo, hi] = range(highs);
  const steady = lo === hi && rs.every((r) => r.floor === r.high) ? `yes, all ${n}` : `NO ${MB(lo)}-${MB(hi)}`;
  const ms = rs.map((r) => r.ms);
  const [mlo, mhi] = range(ms);
  console.log(
    `  ${String(width).padStart(5)}   ${MB(median(highs)).padStart(6)} MB   ` +
      `${rs[0].each.map(MB).join(' + ').padEnd(12)}   ${steady.padEnd(23)}   ` +
      `${median(ms).toFixed(2)} [${mlo.toFixed(2)}-${mhi.toFixed(2)}]`
  );
}
console.log('  * container-measured, not a timing rig: not used for any decision.');
