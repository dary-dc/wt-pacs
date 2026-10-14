import { builtWasm } from "./wasm-glue.js";

const CHUNK = 16384;

/** The frame check's XXH3-64: xxHash's SIMD128 build (row 179). docs/adr/exactness-in-production.md §10 */
export const hasher = async () => xxhash(await builtWasm("xxh3"));

/** wasm/xxh3 in hash-wasm's `init().update(bytes).digest("hex")` shape. */
async function xxhash(wasm) {
  const { instance } = await WebAssembly.instantiate(wasm);
  const x = instance.exports;
  const at = x.buffer();
  const h = {
    /** `XXH_VECTOR`: 4 is the SIMD128 path (xxHash's NEON code), 0 scalar. */
    vector: x.vector(),
    init() {
      x.init();
      return h;
    },
    update(bytes) {
      for (let o = 0; o < bytes.length; o += CHUNK) {
        const part = bytes.subarray(o, o + CHUNK);
        new Uint8Array(x.memory.buffer, at, CHUNK).set(part);
        x.update(part.length);
      }
      return h;
    },
    digest: () => BigInt.asUintN(64, x.digest()).toString(16).padStart(16, "0"),
  };
  return h;
}
