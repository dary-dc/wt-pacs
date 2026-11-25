/**
 * One visit: `decoders` product decoder workers of the tree `tree` (client/decode/decoder.js, as served), fed coded
 * units held in memory. `cell=fill`: whole groups, two outstanding a decoder, as the downloader's perDecoder and
 * claude/phone-run-2:lab/devices/bench.js; the span from the first hand-over to the last frame. `cell=ask&offset=k`:
 * one group warms decoder 0, then the group `askGroup` from its keyframe to offset k goes to it; the wait for frame k.
 */
const q = new URLSearchParams(location.search);
const [TREE, CELL, G, D, K] = [q.get("tree"), q.get("cell"), Number(q.get("g")), Number(q.get("decoders")), Number(q.get("offset") ?? 0)];
const ASK_GROUP = Number(q.get("askGroup") ?? 2);
const now = () => performance.timeOrigin + performance.now();

function start() {
  const worker = new Worker(`/${TREE}/client/decode/decoder.js`, { type: "module" });
  const ch = new MessageChannel();
  const w = { worker, port: ch.port2, waiting: new Map() };
  const settle = (i, x) => (w.waiting.get(i)?.(x), w.waiting.delete(i));
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.kind === "ready") return resolve(w);
      if (data.kind === "failed") return settle(data.index, { failed: data.reason });
      reject(new Error(`decoder did not start: ${data.reason}`));
    };
    worker.onerror = (e) => reject(new Error(`decoder did not start: ${e.message}`));
    ch.port2.onmessage = ({ data: f }) => f.preview || settle(f.index, { ...f, at: now() });
    worker.postMessage({ kind: "init", toConsumer: ch.port1, decoder: { codec: "av1", optimal: true }, groupLength: G }, [ch.port1]);
  });
}

/** Each frame of `indices` handed to `w` in order; resolves once the last is in, each frame or failure recorded. */
function feed(w, units, indices, frames, failures) {
  return Promise.all(indices.map((i) => {
    const got = new Promise((r) => w.waiting.set(i, r));
    w.worker.postMessage({ kind: "decode", index: i, gen: 0, key: i % G === 0, bytes: units[i].slice(), stamps: {} });
    return got.then((x) => (x.failed ? failures.push({ i, reason: x.failed }) : frames.push(x)));
  }));
}

async function hashes(frames) {
  const { hasher } = await import(`/${TREE}/client/decode/xxh3.js`);
  const x = await hasher();
  return Object.fromEntries(frames.map((f) => [f.index, x.init().update(new Uint8Array(f.pixels)).digest("hex")]));
}

try {
  const sbnd = new Uint8Array(await (await fetch(q.get("series"))).arrayBuffer());
  const dv = new DataView(sbnd.buffer);
  const n = dv.getUint32(12, true);
  const units = Array.from({ length: n }, (_, i) => {
    const off = Number(dv.getBigUint64(16 + 12 * i, true));
    return sbnd.slice(off, off + dv.getUint32(16 + 12 * i + 8, true));
  });
  const workers = await Promise.all(Array.from({ length: D }, start));
  await new Promise((r) => (globalThis.__go = r));
  const frames = [];
  const failures = [];
  let result;
  if (CELL === "fill") {
    const groups = [];
    for (let k = 0; k < n; k += G) groups.push([...Array(Math.min(G, n - k)).keys()].map((j) => k + j));
    let next = 0;
    const t0 = now();
    // Two groups outstanding a decoder: the next is handed over when one ends.
    const lane = async (w) => { for (let g; (g = groups[next++]); ) await feed(w, units, g, frames, failures); };
    await Promise.all(workers.flatMap((w) => [lane(w), lane(w)]));
    result = { spanMs: Math.max(...frames.map((f) => f.at)) - t0, frames: frames.length };
  } else {
    await feed(workers[0], units, [...Array(G).keys()], [], failures);
    const want = [...Array(K + 1).keys()].map((j) => ASK_GROUP * G + j);
    const t0 = now();
    await feed(workers[0], units, want, frames, failures);
    result = { waitMs: frames.find((f) => f.index === want.at(-1)).at - t0, frames: frames.length };
  }
  const routes = [...new Set(frames.map((f) => f.route))];
  const decodeMs = frames.map((f) => f.stamps.decodeEnd - f.stamps.decodeStart);
  globalThis.__result = { ...result, routes, failures, decodeMs, sums: await hashes(frames) };
  for (const w of workers) w.worker.terminate();
} catch (e) {
  globalThis.__result = { error: String(e?.stack ?? e) };
}
