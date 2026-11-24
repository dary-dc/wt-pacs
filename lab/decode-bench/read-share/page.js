/**
 * One series' frames through client/decode/av1.js on WebCodecs in order, each frame's send, frame-out, return and
 * digest stamped; `overlap=1` starts the next frame when the codec says, as decoder.js does. run.mjs
 */
const q = new URLSearchParams(location.search);
const G = Number(q.get("g"));
const overlap = q.get("overlap") === "1";
// Each decoder's frame-outs by the timestamp av1-webcodecs.js sent the unit with; client/decode/ is run unchanged.
const outs = [];
const Native = globalThis.VideoDecoder;
globalThis.VideoDecoder = class extends Native {
  constructor(init) {
    const mine = new Map();
    const sent = new Map();
    outs.push({ out: mine, sent });
    super({ ...init, output: (f) => (mine.set(f.timestamp, performance.now()), init.output(f)) });
    this.sent = sent;
  }
  decode(chunk) {
    this.sent.set(chunk.timestamp, performance.now());
    return super.decode(chunk);
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
  let queue = Promise.resolve();
  const t = performance.now();
  for (let i = 0; i < n; i++) {
    const at = 16 + 12 * i;
    const off = Number(dv.getBigUint64(at, true));
    const bytes = sbnd.slice(off, off + dv.getUint32(at + 8, true));
    queue = queue.then(() => new Promise((next) => {
      const row = { i, t0: performance.now() };
      rows.push(row);
      av1.decodeFrame(bytes, { key: i % G === 0, index: i, gen: 0 }, undefined, undefined, overlap ? next : undefined).then((r) => {
        row.t1 = performance.now();
        row.sum = xxh3.init().update(new Uint8Array(r.sab)).digest("hex");
        Object.assign(row, { route: r.route, exact: row.sum === digests?.[i], t2: performance.now() });
      }, (e) => (row.error = String(e?.message ?? e))).finally(next);
    }));
  }
  await queue;
  await new Promise((r) => setTimeout(r, 100));
  const wall = Math.max(...rows.map((x) => x.t2 ?? 0)) - t;
  const top = outs.at(-1);
  for (const x of rows) {
    const [out, sent] = [top.out.get(x.i + 1), top.sent.get(x.i + 1)];
    Object.assign(x, { sentAfter: sent - x.t0, decodeMs: out - sent, toOut: out - x.t0, outToReturn: x.t1 - out, check: x.t2 - x.t1, total: x.t2 - x.t0 });
  }
  globalThis.__result = { rows, wall, decoders: outs.length, digested: Boolean(digests) };
} catch (e) {
  globalThis.__result = { error: String(e?.stack ?? e) };
}
