// The check's XXH3-64 timed alone: over the decoder's shared samples, and over a copy as a cache read hands it back.
// lab/av1/exact/checkcost/README.md
const src = await (await fetch("/client/decode/wasm/vendor/hash-wasm/xxhash3.umd.min.js")).text();
new Function(src).call(globalThis);
const xxh3 = await globalThis.hashwasm.createXXHash3();
const hash = (buf) => xxh3.init().update(new Uint8Array(buf)).digest("hex");

onmessage = ({ data: { sab, copy, want, passes } }) => {
  const ms = { check: [], recheck: [] };
  let ok = 0;
  for (let p = 0; p < passes; p++) {
    for (const [arm, buf] of p % 2 ? [["recheck", copy], ["check", sab]] : [["check", sab], ["recheck", copy]]) {
      const t = performance.now();
      const got = hash(buf);
      ms[arm].push(performance.now() - t);
      if (got === want) ok++;
    }
  }
  postMessage({ ms, ok, of: 2 * passes });
};
postMessage("ready");
