// node client/decode/xxh3.test.mjs — the frame check's hasher is xxHash's SIMD128 build, with hash-wasm's digests.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WASM = `${ROOT}client/decode/wasm/built/xxh3/xxh3.wasm`;
const HASH_WASM = `${ROOT}client/decode/wasm/vendor/hash-wasm/xxhash3.umd.min.js`;
globalThis.fetch = async (url) => new Response(readFileSync(String(url).replace(/^file:\/\//, "")));
const { hasher } = await import("./xxh3.js");

if (!existsSync(WASM) || !existsSync(HASH_WASM)) {
  console.log(`SKIPPED: the frame check's hasher — no ${WASM} or ${HASH_WASM} (client/decode/wasm/build/build.sh)`);
  process.exit(0);
}
let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};

const xxh3 = await hasher();
new Function(readFileSync(HASH_WASM, "utf8")).call(globalThis);
const reference = await globalThis.hashwasm.createXXHash3();

/** The decoder's default hasher is the manifest's xxHash build on its SIMD path, the one row 179 adopted. */
check(xxh3.vector === 4, `XXH_VECTOR is ${xxh3.vector}, not 4 (SIMD128)`);

/** Its digest is hash-wasm's on every length round XXH3's paths and the 16 KiB chunk, and on an empty input. */
const data = new Uint8Array(3 * 16384 + 4099);
for (let i = 0; i < data.length; i++) data[i] = (Math.imul(i, 2654435761) >>> 13) & 0xff;
for (const n of [0, 1, 3, 4, 8, 9, 16, 17, 128, 129, 240, 241, 1024, 16383, 16384, 16385, 2 * 16384 + 1, data.length]) {
  for (const at of [0, 1]) {
    const bytes = data.subarray(at, at + n);
    const want = reference.init().update(bytes).digest("hex");
    check(xxh3.init().update(bytes).digest("hex") === want, `${n} bytes at ${at}: not hash-wasm's ${want}`);
  }
}
/** The digest is XXH3-64's published one for no input, 16 hex digits. */
check(xxh3.init().digest("hex") === "2d06800538d394c2", "XXH3-64 of no input");
/** A frame over a SharedArrayBuffer hashes as its copy does. */
const shared = new Uint8Array(new SharedArrayBuffer(data.length));
shared.set(data);
check(xxh3.init().update(shared).digest("hex") === xxh3.init().update(data).digest("hex"), "shared samples");

console.log(failed ? `${failed} failed` : "the frame check's hasher: ok");
process.exit(failed ? 1 : 0);
