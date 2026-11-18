/** Cell 1's in-memory decode bench and arm C2's exact fill, each a downloader beside the viewer's: lab/devices/README.md §The round */
import { built } from "../../client/decode/wasm-glue.js";
import { DownloaderClient } from "../../client/transport/consumer.js";
import { pairOf } from "../../client/viewer/pair.js";

const epochMs = () => performance.timeOrigin + performance.now();

/** As the viewer configures it: the view through WebCodecs first, HTJ2K through OpenJPH. */
const decoderOf = async (meta) => (meta.codec === "av1" ? { codec: "av1", optimal: meta.lossy !== undefined, ...(await built("dav1d")) } : built("openjph"));
const groupOf = (meta) => (meta.lossy?.g > 1 ? { groupLength: meta.lossy.g, frameCount: meta.frameCount } : {});
const digestsOf = (meta) => (meta.digests?.algorithm === "xxh3-64" ? meta.digests.frames : undefined);

/** Every frame of `indices` handed to `take`, or the first refusal; the downloader closed either way. */
async function fill(url, certHash, opts, indices, take) {
  const left = new Set(indices);
  let settle;
  const all = new Promise((resolve, reject) => (settle = { resolve, reject }));
  const client = await DownloaderClient.connect(url, certHash, {
    ...opts,
    fill: indices,
    onFrame: (f) => left.delete(f.frameIndex) && (take(f), left.size || settle.resolve()),
    onError: ({ frameIndex, reason }) => settle.reject(new Error(`frame ${frameIndex}: ${reason}`)),
  });
  try {
    await all;
  } finally {
    client.close();
  }
}

/** The first `count` frames decoded from memory by `decoders` decoder workers, each frame timed where the product times it. */
export async function bench({ meta, transport, count, decoders }) {
  const n = Math.min(count, meta.frameCount);
  const indices = [...Array(n).keys()];
  const coded = new Map();
  await fill(transport.wt_url, transport.cert_sha256, { transport: transport.module, decode: false, ...groupOf(meta) }, indices, (f) => coded.set(f.frameIndex, f.bytes));
  const g = meta.lossy?.g ?? 1;
  const decoder = await decoderOf(meta);
  const workers = await Promise.all(Array.from({ length: decoders }, () => start({ decoder, groupLength: g, digests: digestsOf(meta) })));
  try {
    return { codec: meta.codec ?? "htj2k", decoders, cores: navigator.hardwareConcurrency, ...(await timed(workers, indices, g, coded)) };
  } finally {
    for (const w of workers) w.worker.terminate();
  }
}

/** One product decoder worker, initialised as the downloader initialises its own. */
function start(init) {
  const worker = new Worker(new URL("../../client/decode/decoder.js", import.meta.url), { type: "module" });
  const ch = new MessageChannel();
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => (data.kind === "ready" ? resolve({ worker, port: ch.port2 }) : reject(new Error(`a decoder did not start: ${data.reason}`)));
    worker.onerror = (e) => reject(new Error(`a decoder did not start: ${e.message}`));
    worker.postMessage({ kind: "init", toConsumer: ch.port1, ...init }, [ch.port1]);
  });
}

/** Whole groups to the decoders, two outstanding each as the downloader's `perDecoder`; the span from the first hand-over to the last frame. */
function timed(workers, indices, g, coded) {
  const groups = [];
  for (let k = 0; k < indices.length; k += g) groups.push(indices.slice(k, k + g));
  const frames = [];
  const failures = [];
  let next = 0;
  return new Promise((resolve) => {
    const finish = () => frames.length + failures.length === indices.length && resolve(summary(t0, frames, failures));
    const give = (w) => {
      const group = groups[next++];
      if (!group) return;
      for (const i of group) w.worker.postMessage({ kind: "decode", index: i, gen: 0, key: i % g === 0, bytes: coded.get(i), stamps: {} }, [coded.get(i).buffer]);
    };
    const ends = (i) => i % g === g - 1 || i === indices.length - 1;
    workers.forEach((w) => {
      w.port.onmessage = ({ data: f }) => {
        if (f.preview) return;
        frames.push({ i: f.index, decoder: workers.indexOf(w), ms: f.stamps.decodeEnd - f.stamps.decodeStart, start: f.stamps.decodeStart, end: f.stamps.decodeEnd, route: f.route, exact: f.exact });
        if (ends(f.index)) give(w);
        finish();
      };
      w.worker.onmessage = ({ data }) => {
        if (data.kind !== "failed") return;
        failures.push({ i: data.index, reason: data.reason });
        if (ends(data.index)) give(w);
        finish();
      };
    });
    const t0 = epochMs();
    for (let round = 0; round < 2; round++) workers.forEach((w) => give(w));
  });
}

function summary(t0, frames, failures) {
  const spanMs = Math.max(...frames.map((f) => f.end)) - t0;
  // As the product: a frame without a digest is `unchecked`, a mismatch fails.
  const wrong = frames.find((f) => f.exact === false);
  const failure = failures[0] ? `frame ${failures[0].i}: ${failures[0].reason}` : wrong ? `frame ${wrong.i} decoded not exact` : null;
  return { frames: frames.sort((a, b) => a.i - b.i), t0, spanMs, effectiveMs: spanMs / (frames.length + failures.length), failures, failure };
}

/** Arm C2: the whole exact series on its own downloader once the view has filled, every frame checked by its digest. */
export async function exactFill(meta, transport, decoders) {
  const p = pairOf(meta);
  if (!p) return { failure: "exactFill: the series has no exact series" };
  const [exact, t] = await Promise.all([p.metadata, p.transport].map((u) => fetch(u).then((r) => r.json())));
  const frames = [];
  const issuedAt = epochMs();
  const opts = { transport: transport.module, transportFile: new URL(p.transport, location).href, digests: exact.digests.frames, decoder: await built("openjph"), ...(decoders && { decoders }) };
  try {
    await fill(t.wt_url, t.cert_sha256, opts, [...Array(exact.frameCount).keys()], (f) => frames.push({ i: f.frameIndex, at: epochMs(), exact: f.info.exact, route: f.info.route,
      kb: +(f.info.wireBytes / 1024).toFixed(1), decodeMs: f.info.stamps.decodeEnd - f.info.stamps.decodeStart }));
  } catch (e) {
    return { issuedAt, frames, failure: `exactFill: ${e.message}` };
  }
  const notExact = frames.find((f) => f.exact !== true);
  return { issuedAt, spanMs: Math.max(...frames.map((f) => f.at)) - issuedAt, frames, failure: notExact ? `exactFill: frame ${notExact.i} decoded ${notExact.exact}, not exact` : null };
}
