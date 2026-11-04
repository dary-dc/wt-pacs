// Stage 0 for the quality shapes: every codestream stage1.py wrote, decoded by the layered lab decoder (decoder.sh's
// WASM). The whole must give the source's sha256 and its layer-1 prefix layer 1's; the smallest prefix giving layer 1 is
// found by binary search; each mutant must fail. today.j2c must decode as the delivered build decodes it.
// Writes WORK/<set>/stage0.jsonl.
//
//   node lab/htj2k-progressive/layers/stage0.mjs WORK/<set> [--mutate truth]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;
const EXPAND = path.join(ROOT, "lab/.openjph-build/layered-native/src/apps/ojph_expand/ojph_expand");
const load = async (glue) => new (await createRequire(import.meta.url)(path.join(ROOT, glue))()).HTJ2KDecoder();
const LAB = "lab/.openjph-build/wasm/layered.js";
const DELIVERED = "client/decode/wasm/built/openjph/openjph.js";
let lab = await load(LAB);
const delivered = await load(DELIVERED);
const [dir, flag, how] = process.argv.slice(2);
const truth = flag === "--mutate" && how === "truth";
const EOC = Uint8Array.of(0xff, 0xd9);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const join = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

// A decode that throws leaves the module unusable ("null function or function signature mismatch"): reload it.
async function decode(d, bytes) {
  try {
    d.getEncodedBuffer(bytes.length).set(bytes);
    d.readHeader();
    d.decode();
    const px = d.getDecodedBuffer();
    if (truth) px[px.length >> 1] ^= 1;
    return { sha: sha(px), range: JSON.stringify(d.getRange()), info: JSON.stringify(d.getFrameInfo()) };
  } catch (e) {
    if (d === lab) lab = await load(LAB);
    return { error: String(e?.message ?? e).slice(0, 80) };
  }
}

/** The smallest prefix whose decode is layer 1's; sound where a longer prefix never loses it, so the boundary is checked. */
async function smallest(cs, lo, hi, want) {
  const ok = async (n) => (await decode(lab, cs.subarray(0, n))).sha === want;
  if (!(await ok(hi))) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (await ok(mid)) hi = mid; else lo = mid + 1;
  }
  return { n: hi, shortFails: !(await ok(hi - 1)) };
}

/** S_skip dropped: the native lab decoder with its mutant switch, the whole frame's sha256 or null. */
function noSkip(file) {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "skip-")), "o.pgm");
  const r = spawnSync(EXPAND, ["-i", file, "-o", out], { env: { ...process.env, OJPH_LAB_MUTATE_SKIP: "1" } });
  if (r.status) return null;
  const pgm = readFileSync(out);
  let pos = 0;
  for (let fields = 0; fields < 4; pos++) if (/\s/.test(String.fromCharCode(pgm[pos])) && !/\s/.test(String.fromCharCode(pgm[pos - 1]))) fields++;
  const max = Number(pgm.subarray(0, pos).toString().trim().split(/\s+/)[3]);
  const px = pgm.subarray(pos);
  if (max < 256) return sha(px);
  const le = Buffer.alloc(px.length);
  for (let i = 0; i < px.length; i += 2) { le[i] = px[i + 1]; le[i + 1] = px[i]; }
  return sha(le);
}

const items = JSON.parse(readFileSync(path.join(dir, "items.json"), "utf8"));
const rows = [];
const tally = { whole: 0, layer1: 0, parity: 0, mutants: 0, caught: 0, fail: 0 };
const seen = new Set();
for (const it of items) {
  const file = path.join(dir, it.file);
  const cs = new Uint8Array(readFileSync(file));
  const frame = path.dirname(it.file);
  if (!seen.has(frame)) {
    seen.add(frame);
    const today = new Uint8Array(readFileSync(path.join(dir, frame, "today.j2c")));
    const [a, b] = [await decode(lab, today), await decode(delivered, today)];
    const same = !a.error && a.sha === b.sha && a.range === b.range && a.info === b.info && a.sha === it.source;
    tally.parity += same;
    if (!same) tally.fail++;
  }
  const end1 = it.header + it.layer1;
  const whole = await decode(lab, cs);
  const layer1 = await decode(lab, join(cs.subarray(0, end1), EOC));
  const cut = await smallest(cs, it.header, end1, it.want1);
  tally.whole += whole.sha === it.source;
  tally.layer1 += layer1.sha === it.want1;
  if (whole.sha !== it.source || layer1.sha !== it.want1) tally.fail++;
  const flipped = cs.slice();
  flipped[end1 + ((cs.length - end1) >> 1)] ^= 0xa5;
  const mutants = {
    flip: (await decode(lab, flipped)).sha !== it.source,
    short: (await decode(lab, join(cs.subarray(0, end1 - 3), EOC))).sha !== it.want1,
  };
  if (it.shape.startsWith("twosets")) mutants.skip = noSkip(file) !== it.source;
  for (const v of Object.values(mutants)) { tally.mutants++; tally.caught += v; }
  rows.push({ file: it.file, shape: it.shape, whole: whole.sha === it.source, layer1: layer1.sha === it.want1,
    smallest: cut?.n ?? null, layerEnd: end1, shortFails: cut?.shortFails ?? null, mutants });
}
writeFileSync(path.join(dir, truth ? "stage0-truth.jsonl" : "stage0.jsonl"), rows.map((r) => JSON.stringify(r) + "\n").join(""));
console.log(`${path.basename(dir)}: ${items.length} codings; whole exact ${tally.whole}, layer 1 ${tally.layer1}, ` +
  `today as delivered ${tally.parity}/${seen.size}; fail ${tally.fail}; mutants caught ${tally.caught}/${tally.mutants}`);
