// Every file run.py wrote, decoded by the client's delivered OpenJPH build (client/decode/wasm/build): a layered
// codestream must be refused, each single-layer rewrite must give its picture's sha256, each mutant must not.
//
//   node lab/htj2k-progressive/layers/check.mjs WORK/<set> [--mutate truth]
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = new URL("../../..", import.meta.url).pathname;
const glue = path.join(ROOT, "client/decode/wasm/built/openjph/openjph.js");
const load = async () => new (await createRequire(import.meta.url)(glue)()).HTJ2KDecoder();
let dec = await load();
const [dir, flag, how] = process.argv.slice(2);
const truth = flag === "--mutate" && how === "truth";

// A decode that throws leaves the module unusable ("null function or function signature mismatch"): reload it.
async function decode(bytes) {
  if (!bytes.length) return { error: "empty" };
  try {
    dec.getEncodedBuffer(bytes.length).set(bytes);
    dec.readHeader();
    dec.decode();
    return { sha: createHash("sha256").update(dec.getDecodedBuffer()).digest("hex") };
  } catch (e) {
    dec = await load();
    return { error: String(e?.message ?? e).slice(0, 120) };
  }
}

const tally = { pass: 0, fail: 0, caught: 0, missed: 0 };
const misses = [];
for (const f of readdirSync(dir).filter((d) => /^\d{3}$/.test(d)).sort()) {
  const list = path.join(dir, f, "items.json");
  if (!existsSync(list)) continue;
  for (const it of JSON.parse(readFileSync(list, "utf8"))) {
    const got = await decode(readFileSync(path.join(dir, it.file)));
    let want = it.want;
    if (truth && want !== "refused") want = want.replace(/^./, (c) => (c === "0" ? "1" : "0"));
    const ok = want === "refused" ? got.error !== undefined : got.sha === want;
    if (want === "refused" && !tally.refusal) tally.refusal = got.error;
    if (it.mutant) ok ? (tally.missed++, misses.push(it.file)) : tally.caught++;
    else ok ? tally.pass++ : (tally.fail++, misses.push(`${it.file} ${got.error ?? ""}`));
  }
}
console.log(JSON.stringify({ dir, truth, ...tally, first: misses.slice(0, 8) }));
process.exitCode = tally.fail || tally.missed ? 1 : 0;
