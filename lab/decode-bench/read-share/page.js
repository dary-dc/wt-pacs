/**
 * One series' frames through client/decode/av1.js on WebCodecs, in order, one at a time, as decoder.js takes them;
 * each frame's send, frame-out, return and digest check stamped. run.mjs
 */
const q = new URLSearchParams(location.search);
const G = Number(q.get("g"));
let frameOut = 0;
// The stamp sits on the browser's output callback, so client/decode/ is run unchanged.
const Native = globalThis.VideoDecoder;
globalThis.VideoDecoder = class extends Native {
  constructor(init) {
    super({ ...init, output: (f) => ((frameOut = performance.now()), init.output(f)) });
  }
};

try {
  const [{ hasher }, av1] = await Promise.all([import("/client/decode/xxh3.js"), import("/client/decode/av1.js")]);
  const xxh3 = await hasher();
  await av1.init({ codec: "av1", groupLength: G });
  const sbnd = new Uint8Array(await (await fetch(q.get("series"))).arrayBuffer());
  const dv = new DataView(sbnd.buffer);
  const n = dv.getUint32(12, true);
  const meta = JSON.parse(new TextDecoder().decode(sbnd.subarray(16 + 12 * n, 16 + 12 * n + dv.getUint32(8, true))));
  const digests = meta.digests?.algorithm === "xxh3-64" ? meta.digests.frames : null;
  await new Promise((r) => (globalThis.__go = r));
  const rows = [];
  for (let i = 0; i < n; i++) {
    const at = 16 + 12 * i;
    const off = Number(dv.getBigUint64(at, true));
    const bytes = sbnd.slice(off, off + dv.getUint32(at + 8, true));
    frameOut = 0;
    const t0 = performance.now();
    const r = await av1.decodeFrame(bytes, { key: i % G === 0, index: i, gen: 0 });
    const t1 = performance.now();
    const exact = xxh3.init().update(new Uint8Array(r.sab)).digest("hex") === digests?.[i];
    const t2 = performance.now();
    rows.push({ i, route: r.route, exact, toOut: frameOut - t0, outToReturn: t1 - frameOut, check: t2 - t1, total: t2 - t0 });
  }
  globalThis.__result = { rows, digested: Boolean(digests) };
} catch (e) {
  globalThis.__result = { error: String(e?.stack ?? e) };
}
