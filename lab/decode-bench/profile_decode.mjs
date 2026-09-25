// Where one frame's WASM decode goes, by function: a build with names kept, sampled by V8's
// profiler. docs/decode/README.md §The decode tail on a slow CPU
//
// usage: EMSDK=~/emsdk ARMS=prof EXTRA_FLAGS=--profiling-funcs lab/decode-bench/wasm/build.sh
//        node lab/decode-bench/profile_decode.mjs FIXTURE_DIR [--arm prof] [--passes 20]
import { createRequire } from 'node:module';
import inspector from 'node:inspector/promises';
import path from 'node:path';
import { loadFixture } from './decoder.mjs';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const pick = (flag, dflt) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : dflt);
const arm = pick('--arm', 'prof');
const PASSES = Number(pick('--passes', 20));
const dir = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));

const M = await require(path.join(process.cwd(), 'lab/.openjph-build/wasm', `${arm}.js`))();
const d = new M.HTJ2KDecoder();
const { frames } = loadFixture(dir);
const decode = (bytes) => {
  d.getEncodedBuffer(bytes.length).set(bytes);
  d.readHeader();
  d.decode();
};
// Tiered up first: the question is the steady state, not the first frames.
for (const f of frames) decode(f);

/** Each function's self time lands in the first group whose pattern its name matches. */
const GROUPS = [
  ['code-block decode (HT), per block', /ojph_decode_codeblock|rev_fetch|frwd_fetch|mel_|vlc/],
  ['code-block to line, per block', /tx_from_cb/],
  ['inverse wavelet', /horz_syn|vert_step|horz_ana|vert_ana/],
  ['colour transform', /rct_backward|ict_backward/],
  ['the wrapper: clamp, narrow, interleave', /HTJ2KDecoder::decode\(\)/],
  ['line plumbing', /pull_line|pull\(|rev_convert|memset|memcpy|line_buf/],
  ['codestream set-up', /create|restart|read_headers|recreate|alloc|finalize/],
];

const s = new inspector.Session();
s.connect();
await s.post('Profiler.enable');
await s.post('Profiler.setSamplingInterval', { interval: 50 });
await s.post('Profiler.start');
const t0 = performance.now();
for (let p = 0; p < PASSES; p++) for (const f of frames) decode(f);
const perFrame = (performance.now() - t0) / (PASSES * frames.length);
const { profile } = await s.post('Profiler.stop');

const self = new Map();
const dt = new Map();
profile.samples.forEach((id, k) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[k] ?? 0)));
for (const n of profile.nodes) {
  const name = n.callFrame.functionName || '(anonymous)';
  self.set(name, (self.get(name) ?? 0) + (dt.get(n.id) ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const inGroup = new Map(GROUPS.map(([g]) => [g, 0]));
let other = 0;
for (const [name, us] of self) {
  const g = GROUPS.find(([, re]) => re.test(name));
  if (g) inGroup.set(g[0], inGroup.get(g[0]) + us);
  else other += us;
}
console.log(`${path.basename(dir)} on ${arm}: ${perFrame.toFixed(2)} ms a frame, ${PASSES} passes of ${frames.length}`);
for (const [g, us] of [...inGroup, ['everything else', other]]) {
  console.log(`  ${(100 * us / total).toFixed(1).padStart(5)} %  ${g}`);
}
console.log('  top functions by self time:');
for (const [name, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`  ${(100 * us / total).toFixed(1).padStart(5)} %  ${name}`);
}
