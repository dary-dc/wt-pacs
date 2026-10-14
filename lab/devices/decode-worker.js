// D1: one arm decodes a set's frames, already in memory, one at a time; each checked against the store's digest.
import { built } from "/client/decode/wasm-glue.js";
import { hasher } from "/client/decode/xxh3.js";

const AVOID = { dav1d: "av1-webcodecs", webcodecs: "av1-dav1d" };

onmessage = async ({ data: { arm, meta, frames, mutate } }) => {
  try {
    const av1 = meta.codec === "av1";
    if (av1 === (arm === "htj2k")) throw new Error(`arm ${arm} does not decode a ${meta.codec ?? "htj2k"} set`);
    const codec = await import(av1 ? "/client/decode/av1.js" : "/client/decode/htj2k.js");
    await codec.init(av1 ? { codec: "av1", ...(await built("dav1d")) } : await built("openjph"));
    const xxh3 = await hasher();
    const want = meta.digests?.frames ?? [];
    const rows = [];
    for (let i = 0; i < frames.length; i++) {
      const bytes = new Uint8Array(frames[i]);
      const t0 = performance.now();
      const f = await codec.decodeFrame(bytes, { key: true }, null, AVOID[arm]);
      const ms = performance.now() - t0;
      const out = new Uint8Array(f.sab);
      if (mutate) out[out.length >> 1] ^= 1;
      const got = xxh3.init().update(out).digest("hex");
      rows.push({ i, ms, path: f.path, exact: want[i] ? got === want[i] : "unchecked" });
    }
    postMessage({ rows });
  } catch (e) {
    postMessage({ error: String(e?.message ?? e) });
  }
};
