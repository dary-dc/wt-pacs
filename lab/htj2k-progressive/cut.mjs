/**
 * Stage 0–1 of the ladder: for every frame and level r of ladder.py's sets, the smallest prefix whose (r, r) decode is
 * byte-identical to the whole codestream's, through the lab decoder; each check against ladder.py's witness digests,
 * and every whole frame against the delivered build's.
 * Writes cuts.json beside ladder.json. lab/htj2k-progressive/README.md
 *
 *   node lab/htj2k-progressive/cut.mjs WORK [SET ...] [--mutate short|truth]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--mutate");
const [WORK, ...ONLY] = args;
const MUTATE = process.argv.includes("--mutate") ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const load = async (glue) => new (await createRequire(import.meta.url)(path.join(ROOT, glue))()).HTJ2KDecoder();
const dec = await load("lab/.openjph-build/wasm/levels.js");
/** The product's delivered build (client/decode/wasm/build): the lab decoder's whole frame must be its, range included. */
const delivered = await load("client/decode/wasm/built/openjph/openjph.js");

function parity(bytes) {
  const out = [dec, delivered].map((d) => {
    d.getEncodedBuffer(bytes.length).set(bytes);
    d.readHeader();
    d.decode();
    return sha256(d.getDecodedBuffer()) + JSON.stringify(d.getRange()) + JSON.stringify(d.getFrameInfo());
  });
  return out[0] === out[1];
}

/** The decode at (skipRead, skipRecon), or null where the decoder refuses the bytes. */
export function decode(bytes, read, recon) {
  try {
    dec.getEncodedBuffer(bytes.length).set(bytes);
    dec.readHeader();
    if (read) dec.decodeLevel(read, recon);
    else dec.decode();
    return dec.getDecodedBuffer().slice();
  } catch {
    return null;
  }
}

const matches = (bytes, r, recon, want) => { const px = decode(bytes, r, recon); return px !== null && sha256(px) === want; };

/** Binary search, sound only where a longer prefix never loses the level: the boundary is checked after. */
function smallest(bytes, r, want) {
  let lo = 1;
  let hi = bytes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches(bytes.subarray(0, mid), r, r, want)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

let failed = 0;
const sets = readdirSync(WORK).filter((d) => existsSync(path.join(WORK, d, "ladder.json")) && (!ONLY.length || ONLY.includes(d)));
for (const name of sets) {
  const dir = path.join(WORK, name);
  const set = JSON.parse(readFileSync(path.join(dir, "ladder.json"), "utf8"));
  const flip = (t) => (MUTATE === "truth" ? t.replace(/^./, (c) => (c === "0" ? "1" : "0")) : t);
  const out = [];
  for (let i = 0; i < set.frames; i++) {
    const cs = readFileSync(path.join(dir, `${String(i).padStart(3, "0")}.htj2k`));
    const whole = matches(cs, 0, 0, flip(set.truth[i])) && parity(cs);
    const levels = {};
    for (const r of set.levels) {
      const reduced = flip(set.witness[r].reduced[i]);
      const full = flip(set.witness[r].full[i]);
      let cut = smallest(cs, r, reduced);
      if (MUTATE === "short") cut -= 1;
      const checks = {
        whole: matches(cs, r, r, reduced) && matches(cs, r, 0, full),
        prefix: matches(cs.subarray(0, cut), r, r, reduced),
        prefixFull: matches(cs.subarray(0, cut), r, 0, full),
        short: !matches(cs.subarray(0, cut - 1), r, r, reduced) && !matches(cs.subarray(0, cut - 1), r, 0, full),
      };
      const bad = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
      if (bad.length) { failed++; console.error(`${name} ${i} level ${r}: not ${bad.join(", ")}`); }
      levels[r] = { prefix: cut, ok: !bad.length };
    }
    if (!whole) { failed++; console.error(`${name} ${i}: the whole frame is not its source`); }
    out.push({ whole: cs.length, exact: whole, levels });
  }
  writeFileSync(path.join(dir, MUTATE ? `cuts-${MUTATE}.json` : "cuts.json"), JSON.stringify(out));
  const share = (r) => out.map((f) => f.levels[r].prefix / f.whole);
  console.log(`${name}: ${set.frames} frames, ${out.filter((f) => f.exact).length} exact; prefix share by level ` +
    set.levels.map((r) => `${r} ${(100 * Math.min(...share(r))).toFixed(2)}–${(100 * Math.max(...share(r))).toFixed(2)} %`).join(", "));
}
if (failed) { console.error(`${failed} checks failed`); process.exit(1); }
