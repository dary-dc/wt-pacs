// One decoder build in a worker, as the product runs it: load a set, check every frame, time passes.
let d, frames;
const decode = (bytes) => { d.getEncodedBuffer(bytes.length).set(bytes); d.readHeader(); d.decode(); };
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

onmessage = async ({ data: { glue, urls, truth, passes, mutate } }) => {
  try {
    if (!d) {
      importScripts(glue);
      const M = await OpenJPHModule({ locateFile: (f) => glue.replace(/[^/]*$/, f), mainScriptUrlOrBlob: glue });
      d = new M.HTJ2KDecoder();
    }
    frames = await Promise.all(urls.map(async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer())));
    let exact = 0;
    for (let i = 0; i < frames.length; i++) {
      decode(frames[i]);
      const out = d.getDecodedBuffer().slice();
      if (mutate) out[out.length >> 1] ^= 1;
      if (hex(await crypto.subtle.digest("SHA-256", out)) === truth[i]) exact++;
    }
    const ms = [];
    for (let p = 0; p < passes; p++) for (const f of frames) {
      const t0 = performance.now(); decode(f); ms.push(performance.now() - t0);
    }
    postMessage({ exact, ms });
  } catch (e) { postMessage({ error: String(e) }); }
};
