/**
 * The decoder directories the arms that are not the product load, each a copy of client/decode served from
 * OUT/<name>/client/decode: S (its two files and kernel), and the broken copies that must read 0 exact. README.md here
 *
 *   node lab/av1/decode/merge-free/products.mjs OUT KERNEL   (KERNEL: s/build.sh's OUT)
 */
import { copyFileSync, cpSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const SRC = new URL("../../../../client/decode", import.meta.url).pathname;
const S = new URL("./s", import.meta.url).pathname;

function copyOf(out, name) {
  const dst = path.join(out, name, "client/decode");
  rmSync(path.join(out, name), { recursive: true, force: true });
  cpSync(SRC, dst, { recursive: true, filter: (f) => f !== path.join(SRC, "wasm") });
  symlinkSync(path.join(SRC, "wasm"), path.join(dst, "wasm"));
  return dst;
}

function s(out, name, wasm) {
  const dst = copyOf(out, name);
  for (const f of ["av1-frame.js", "av1-webcodecs.js"]) copyFileSync(path.join(S, f), path.join(dst, f));
  copyFileSync(wasm, path.join(dst, "merge.wasm"));
}

/** R with its copy buffer never grown: a frame larger than the one before cannot be copied into it. */
function rNeverGrown(out) {
  const file = path.join(copyOf(out, "R-never-grown"), "av1-webcodecs.js");
  const find = "kept?.byteLength >= size ? kept : (kept = new ArrayBuffer(size))";
  const text = readFileSync(file, "utf8");
  if (text.split(find).length !== 2) throw new Error("av1-webcodecs.js: R's buffer is not found exactly once");
  writeFileSync(file, text.replace(find, "(kept ??= new ArrayBuffer(size))"));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [out, kernel] = process.argv.slice(2).map((p) => path.resolve(p));
  s(out, "S", path.join(kernel, "merge.wasm"));
  s(out, "S-shift-short", path.join(kernel, "broken/merge.wasm"));
  rNeverGrown(out);
}
