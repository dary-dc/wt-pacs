// One decoder in a worker: OpenJPH (the reference, or the pool) decodes the whole frame, OpenHTJ2K any rectangle.
// An ask writes its rectangle at `at` samples into a shared buffer, and hashes it when asked to check.
let dec, frames;
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function load(glue) {
  importScripts(glue);
  const opts = { locateFile: (f) => glue.replace(/[^/]*$/, f), mainScriptUrlOrBlob: glue };
  if (self.OpenHTJ2KModule) {
    const M = await OpenHTJ2KModule(opts);
    let cs = 0, csCap = 0, out = 0, outCap = 0;
    const grow = (p, cap, n) => (n <= cap ? [p, cap] : (M._free(p), [M._malloc(n), n]));
    return (bytes, x0, y0, x1, y1) => {
      [cs, csCap] = grow(cs, csCap, bytes.length);
      M.HEAPU8.set(bytes, cs);
      const n = (x1 - x0) * (y1 - y0);
      [out, outCap] = grow(out, outCap, n * 2);
      const blockBytes = M._region_decode(cs, bytes.length, x0, y0, x1, y1, out);
      return { px: new Uint16Array(M.HEAPU16.buffer, out, n), blockBytes };
    };
  }
  const M = await OpenJPHModule(opts);
  const d = new M.HTJ2KDecoder();
  return (bytes) => {
    d.getEncodedBuffer(bytes.length).set(bytes);
    d.readHeader();
    d.decode();
    const b = d.getDecodedBuffer();
    return { px: new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2) };
  };
}

onmessage = async ({ data: m }) => {
  try {
    if (m.glue) {
      dec = await load(m.glue);
      postMessage({ ok: true });
    } else if (m.urls) {
      frames = await Promise.all(m.urls.map(async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer())));
      postMessage({ ok: true });
    } else {
      const { i, x0, y0, x1, y1, at, shared, check, mutate } = m;
      const t0 = performance.now();
      const { px, blockBytes } = dec(frames[i], x0, y0, x1, y1);
      new Uint16Array(shared, at * 2, px.length).set(px);
      const ms = performance.now() - t0;
      let hash;
      if (check) {
        const copy = px.slice();
        if (mutate) copy[copy.length >> 1] ^= 1;
        hash = hex(await crypto.subtle.digest("SHA-256", copy));
      }
      postMessage({ ms, hash, blockBytes });
    }
  } catch (e) {
    postMessage({ error: String(e) });
  }
};
