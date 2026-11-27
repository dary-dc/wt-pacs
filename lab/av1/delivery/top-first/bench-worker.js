/** bench.js's worker: one payload through the product's av1.js, timed; a top-only picture shifted up by k after. */
import * as payload from "/client/decode/av1.js";

const mutate = new URLSearchParams(location.search).get("mutate");

async function sha256(u8) {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  if (mutate === "sample") copy[copy.length >> 1] ^= 1;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copy)), (b) => b.toString(16).padStart(2, "0")).join("");
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    await payload.init(m.decoder);
    return postMessage({});
  }
  try {
    const t0 = performance.now();
    const r = await payload.decodeFrame(m.bytes, { key: true });
    const ms = performance.now() - t0;
    let px = new Uint8Array(r.sab);
    if (m.which === "T") {
      const src = r.info.bitsPerSample > 8 ? new Uint16Array(r.sab) : new Uint8Array(r.sab);
      const out = new Uint16Array(src.length);
      for (let j = 0; j < src.length; j++) out[j] = src[j] << m.split;
      px = new Uint8Array(out.buffer);
    }
    postMessage({ ms, path: r.path, sha: await sha256(px) });
  } catch (err) {
    postMessage({ error: String(err?.message ?? err) });
  }
};
