/**
 * The broken copies the grey path protocol requires to fail, each a copy of client/decode served from
 * OUT/<name>/client/decode with one line replaced. README.md here
 *
 *   node lab/av1/decode/grey-path/products.mjs OUT
 */
import { cpSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const SRC = new URL("../../../../client/decode", import.meta.url).pathname;

function broken(out, name, file, find, replace) {
  const dst = path.join(out, name, "client/decode");
  rmSync(path.join(out, name), { recursive: true, force: true });
  cpSync(SRC, dst, { recursive: true, filter: (f) => f !== path.join(SRC, "wasm") });
  symlinkSync(path.join(SRC, "wasm"), path.join(dst, "wasm"));
  const at = path.join(dst, file);
  const text = readFileSync(at, "utf8");
  if (text.split(find).length !== 2) throw new Error(`${file}: "${find}" is not found exactly once`);
  writeFileSync(at, text.replace(find, replace));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const out = path.resolve(process.argv[2]);
  broken(out, "neutral-off-by-one", "av1-frame.js", "if (heap[s] !== mid) return false;", "if (heap[s] !== mid + 1) return false;");
  // A buffer copied into once is never copied into again: only R's kept buffer is handed out twice.
  broken(out, "R-copy-skipped", "av1-webcodecs.js", "const layout = await frame.copyTo(buf);",
    "const layout = buf.layout ?? (buf.layout = await frame.copyTo(buf));");
}
