/**
 * page.js without the downloader: the same transport on the page, the same decoder workers fed from
 * the page by the same rule (fewest outstanding, two at most), so what differs from page.js is the
 * downloader worker and nothing else. docs/thread-hops.md §The downloader arm during a fill, against direct
 */
import { TransportSession } from "/client/transport-ts/dist/session.js";

const q = new URLSearchParams(location.search);
const FILL = Number(q.get("fill"));
const DECODERS = Number(q.get("decoders") || 3);
const PER_DECODER = 2;
const dir = q.get("decoderDir") || "/lab/decode-bench/vendor/openjph";
const decoder = { glue: `${dir}/${q.get("glue") || "openjphjs.js"}`, wasm: `${dir}/${q.get("wasm") || "openjphjs.wasm"}`, dir };
const abs = () => performance.timeOrigin + performance.now();

const frames = [];
let session = null;
let resolveAll;
const all = new Promise((r) => (resolveAll = r));
const workers = [];
const queue = [];
for (let i = 0; i < DECODERS; i++) {
  const worker = new Worker("/client/downloader/decoder.js", { type: "module" });
  const ch = new MessageChannel();
  const d = { worker, outstanding: 0, i };
  ch.port2.onmessage = (e) => {
    frames.push({ i: e.data.index, bytes: e.data.byteCount, ...e.data.stamps, received: abs() });
    if (frames.length === FILL) resolveAll();
  };
  const up = new Promise((r) => (worker.onmessage = (e) => {
    if (e.data.kind === "ready") return r();
    if (e.data.buffer) session?.releaseWireBuffer(e.data.buffer);
    if (e.data.kind === "done" || e.data.kind === "failed") d.outstanding -= 1;
    pump();
  }));
  worker.postMessage({ kind: "init", toConsumer: ch.port1, decoder }, [ch.port1]);
  workers.push({ d, up });
}
await Promise.all(workers.map((w) => w.up));

function pump() {
  for (;;) {
    const d = workers.map((w) => w.d).filter((x) => x.outstanding < PER_DECODER).sort((a, b) => a.outstanding - b.outstanding)[0];
    if (!d || !queue.length) return;
    const { index, bytes, stamps } = queue.shift();
    stamps.dispatched = abs();
    stamps.decoder = d.i;
    d.outstanding += 1;
    d.worker.postMessage({ kind: "decode", index, gen: 0, bytes, stamps }, [bytes.buffer]);
  }
}

session = await TransportSession.connect(q.get("wt"), q.get("hash"), { wireBuffers: DECODERS * PER_DECODER + 2 });
await new Promise((r) => setTimeout(r, 1500));
const askAt = abs();
session.fillFrames(0, FILL - 1, (f) => {
  queue.push({ index: f.frameIndex, bytes: f.bytes, stamps: { ask: askAt, lastByte: abs() } });
  pump();
});
await Promise.race([all, new Promise((r) => setTimeout(r, 60000))]);
session.close();
fetch(`http://127.0.0.1:${q.get("report")}/`, {
  method: "POST",
  body: JSON.stringify({ set: q.get("set"), arm: q.get("arm"), askAt, frames }),
  keepalive: true,
});
