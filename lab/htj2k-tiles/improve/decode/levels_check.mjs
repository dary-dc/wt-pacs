/**
 * Stage 0's lab-binding check: on one decoder per volume, every strip's TLM prefix at every level NL..1, then the strip
 * whole, against the witness's sha256 (stage2_prep.py's frames.json). lab/htj2k-tiles/improve/README.md §Stage 0
 *
 *   node lab/htj2k-tiles/improve/decode/levels_check.mjs [--build lab/.openjph-build/wasm/levels.js] [--mutate]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = new URL("../../../..", import.meta.url).pathname;
const WORK = `${ROOT}lab/.av1-work/htj2k-improve`;
const M = await createRequire(import.meta.url)(`${ROOT}${arg("--build", "lab/.openjph-build/wasm/levels.js")}`)();
const mutate = process.argv.includes("--mutate");
const sha = (b) => { const c = Buffer.from(b); if (mutate) c[c.length >> 1] ^= 1; return createHash("sha256").update(c).digest("hex"); };

let pictures = 0, exact = 0;
for (const vol of ["dbts_a1", "dbts_b1", "dbts_c1"]) {
  const meta = JSON.parse(readFileSync(`${WORK}/${vol}/frames.json`, "utf8"));
  const dec = new M.HTJ2KDecoder();
  for (const f of meta.frames) {
    for (const [k, s] of f.strips.entries()) {
      const cs = readFileSync(`${WORK}/${vol}/${String(f.frame).padStart(3, "0")}.s${k}.j2c`);
      for (let lv = meta.NL; lv >= 0; lv--) {
        const input = lv ? Buffer.concat([cs.subarray(0, s.prefix[lv]), Buffer.from([0xff, 0xd9])]) : cs;
        dec.getEncodedBuffer(input.length).set(input);
        dec.readHeader();
        if (lv) dec.decodeLevel(lv, lv);
        else dec.decode();
        pictures++;
        if (sha(dec.getDecodedBuffer()) === s.truth[lv]) exact++;
        else console.error(`${vol} frame ${f.frame} strip ${k} level ${lv}: not exact`);
      }
    }
  }
}
console.log(`levels_check: exact ${exact}/${pictures}`);
process.exit(exact === pictures ? 0 : 1);
