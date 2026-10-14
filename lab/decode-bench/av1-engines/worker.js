// Every payload decoded by client/decode/av1.js on the product's dav1d build, as in an engine without WebCodecs.
delete self.VideoDecoder;
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const bytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());

onmessage = async ({ data: { payloads, mutate } }) => {
  try {
    const { built } = await import("/client/decode/wasm-glue.js");
    const av1 = await import("/client/decode/av1.js");
    await av1.init({ codec: "av1", ...(await built("dav1d")) });
    const rows = [];
    for (const p of payloads) {
      try {
        const f = await av1.decodeFrame(await bytes(`${p}.av1`));
        const out = new Uint8Array(f.sab).slice();
        if (mutate) out[out.length >> 1] ^= 1;
        const got = hex(await crypto.subtle.digest("SHA-256", out));
        const want = new TextDecoder().decode(await bytes(`${p}.sha256`)).trim();
        rows.push({ payload: p, exact: got === want, path: f.path });
      } catch (e) {
        rows.push({ payload: p, exact: false, error: String(e?.message ?? e) });
      }
    }
    postMessage({ rows });
  } catch (e) {
    postMessage({ error: String(e?.stack ?? e) });
  }
};
