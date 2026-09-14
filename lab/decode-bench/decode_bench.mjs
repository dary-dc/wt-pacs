// Heap cost of decoding with N decoder instances, across frame sizes.
//
// Each instance is its own WASM module with its own linear memory. WASM memory only grows,
// so every instance holds its high-water mark for as long as it lives. The arms rotate order
// each round. docs/decode/README.md says what the numbers are for.
//
// usage: node decode_bench.mjs FIXTURE_DIR [rounds]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const decoderDir = path.join(here, 'vendor', 'openjph');
const fixtureDir = process.argv[2];
const ROUNDS = Number(process.argv[3] || 5); // round 0 warms up and checks pixels
const WIDTHS = [1, 2, 3, 4];

if (!fixtureDir) {
  console.error('usage: node decode_bench.mjs FIXTURE_DIR [rounds]');
  process.exit(2);
}

const frames = fs
  .readdirSync(fixtureDir)
  .filter((f) => f.endsWith('.j2c') || f.endsWith('.htj2k'))
  .sort()
  .map((f) => new Uint8Array(fs.readFileSync(path.join(fixtureDir, f))));
if (!frames.length) {
  console.error(`no codestreams in ${fixtureDir}`);
  process.exit(2);
}

// The glue is a classic script and takes `require` / `__dirname` from its scope in Node.
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = decoderDir;
vm.runInThisContext(fs.readFileSync(path.join(decoderDir, 'openjphjs.js'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(decoderDir, 'openjphjs.wasm'));

const now = () => performance.now();
const MB = (n) => (n / 1048576).toFixed(1);
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];

async function instance() {
  const M = await globalThis.Module({ locateFile: (f) => path.join(decoderDir, f), wasmBinary });
  return {
    heap: () => M.HEAPU8.length,
    decode(bytes) {
      const d = new M.HTJ2KDecoder();
      try {
        d.getEncodedBuffer(bytes.length).set(bytes);
        d.readHeader();
        d.decode();
        return d.getDecodedBuffer().slice();
      } finally {
        d.delete();
      }
    },
  };
}

/** One arm: `width` instances, frames dealt round-robin. Serial by design — the claim is memory. */
async function arm(width, reference) {
  const pool = [];
  for (let i = 0; i < width; i++) pool.push(await instance());
  const t0 = now();
  let mismatch = 0;
  for (let f = 0; f < frames.length; f++) {
    const pixels = pool[f % width].decode(frames[f]);
    if (reference && !Buffer.from(pixels).equals(Buffer.from(reference[f]))) mismatch++;
  }
  const ms = (now() - t0) / frames.length;
  const heaps = pool.map((p) => p.heap());
  return { ms, mismatch, total: heaps.reduce((a, b) => a + b, 0), each: heaps };
}

const first = await instance();
const oracle = frames.map((f) => first.decode(f));

const results = new Map(WIDTHS.map((w) => [w, []]));
for (let round = 0; round < ROUNDS; round++) {
  const order = WIDTHS.slice(round % WIDTHS.length).concat(WIDTHS.slice(0, round % WIDTHS.length));
  for (const width of order) {
    const r = await arm(width, oracle);
    if (r.mismatch) {
      console.error(`width ${width}: ${r.mismatch}/${frames.length} frames differ from the oracle`);
      process.exit(1);
    }
    if (round) results.get(width).push(r);
  }
}

console.log(`${frames.length} frames from ${path.basename(fixtureDir)}, ${ROUNDS - 1} timed rounds`);
console.log('  width  total heap   per instance   ms/frame (serial)');
for (const width of WIDTHS) {
  const rs = results.get(width);
  const each = rs[0].each.map(MB).join(' + ');
  console.log(
    `  ${String(width).padStart(5)}  ${MB(median(rs.map((r) => r.total))).padStart(7)} MB` +
      `   ${each.padEnd(13)}  ${median(rs.map((r) => r.ms)).toFixed(2)}`
  );
}
console.log(`  reference instance after the oracle pass: ${MB(first.heap())} MB`);
