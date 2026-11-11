/**
 * A copy of the product's decoder with merge()'s shift one short, served from OUT/client/decode: W2 must read 0 exact
 * through it, which also shows merge() is on W2's path. README.md here
 *
 *   node lab/av1/decode/passes/broken.mjs lab/.av1-work/passes/broken
 */
import { cpSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const SRC = new URL("../../../../client/decode", import.meta.url).pathname;
const FIND = "(((t.heap[s] << k) & mask) | b.heap[q])";

export function build(out) {
  const dst = path.join(out, "client/decode");
  rmSync(out, { recursive: true, force: true });
  cpSync(SRC, dst, { recursive: true, filter: (f) => f !== path.join(SRC, "wasm") });
  symlinkSync(path.join(SRC, "wasm"), path.join(dst, "wasm"));
  const file = path.join(dst, "av1-frame.js");
  const text = readFileSync(file, "utf8");
  if (text.split(FIND).length !== 2) throw new Error(`av1-frame.js: merge()'s shift is not found exactly once`);
  writeFileSync(file, text.replace(FIND, "(((t.heap[s] << (k - 1)) & mask) | b.heap[q])"));
  return dst;
}

if (process.argv[1] === new URL(import.meta.url).pathname) console.log(build(path.resolve(process.argv[2])));
