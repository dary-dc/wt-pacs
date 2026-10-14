// The frame check's XXH3-64 by four arms, each over one frame's samples, the arms in a Williams order per pass.
// lab/av1/exact/hashfast/README.md
import { order } from "/lab/order.mjs";

const CHUNK = 16384;
const ARMS = ["A", "B", "C", "C0"];

/** xxHash's build behind hash-wasm's `createXXHash3()` shape: 16 KiB chunks copied into the module's memory. */
async function xxhash(arm) {
  const { instance } = await WebAssembly.instantiateStreaming(fetch(`/lab/.av1-work/hashfast-wasm/xxh3-${arm}.wasm`), {
    wasi_snapshot_preview1: { proc_exit: () => {}, fd_close: () => 0, fd_write: () => 0, fd_seek: () => 0 },
  });
  const x = instance.exports;
  const at = x.buffer();
  const h = {
    vector: x.vector(),
    init() { x.init(); return h; },
    update(u8) {
      const mem = new Uint8Array(x.memory.buffer, at, CHUNK);
      for (let o = 0; o < u8.length; o += CHUNK) {
        const part = u8.subarray(o, o + CHUNK);
        mem.set(part);
        x.update(part.length);
      }
      return h;
    },
    digest: () => BigInt.asUintN(64, x.digest()).toString(16).padStart(16, "0"),
  };
  return h;
}

const src = await (await fetch("/client/decode/wasm/vendor/hash-wasm/xxhash3.umd.min.js")).text();
new Function(src).call(globalThis);
const hashwasm = await globalThis.hashwasm.createXXHash3();
const hashers = { A: hashwasm, B: hashwasm, C: await xxhash("c"), C0: await xxhash("c0") };

onmessage = ({ data: { sab, want, passes, seed } }) => {
  // B hashes the samples before they reach the shared buffer: an unshared copy stands for the decoder's own output.
  const own = new Uint8Array(sab.byteLength);
  own.set(new Uint8Array(sab));
  const input = { A: new Uint8Array(sab), B: own, C: new Uint8Array(sab), C0: new Uint8Array(sab) };
  const ms = Object.fromEntries(ARMS.map((a) => [a, []]));
  const ok = Object.fromEntries(ARMS.map((a) => [a, 0]));
  for (const arm of ARMS) hashers[arm].init().update(input[arm]).digest("hex");
  for (let p = 0; p < passes; p++) {
    for (const arm of order(ARMS, seed + p)) {
      const t = performance.now();
      const got = hashers[arm].init().update(input[arm]).digest("hex");
      ms[arm].push(performance.now() - t);
      if (got === want) ok[arm]++;
    }
  }
  postMessage({ ms, ok, of: passes });
};
postMessage({ ready: true, vector: { C: hashers.C.vector, C0: hashers.C0.vector } });
