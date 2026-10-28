// The frames both options paint: today's downloader filling the whole series, as the product page connects it.
import { DownloaderClient } from "/client/transport/consumer.js";
import { built } from "/client/decode/wasm-glue.js";

export async function open() {
  const q = new URLSearchParams(location.search);
  const [meta, transport] = await Promise.all([globalThis.viewerMetadata, globalThis.viewerTransport]);
  const n = meta.frameCount;
  const frames = new Map();
  const waiting = new Map();
  const errors = [];
  let filled;
  const done = new Promise((r) => (filled = r));
  const client = await DownloaderClient.connect(transport.wt_url, transport.cert_sha256, {
    transport: transport.module,
    fill: [...Array(n).keys()],
    digests: meta.digests?.algorithm === "xxh3-64" ? meta.digests.frames : undefined,
    decoder: await built("openjph"),
    ...(q.get("mutate") === "sample" && { decoderWorker: new URL("/lab/viewer-spike/mutants/decoder.js", location).href }),
    onFrame: ({ frameIndex: i, info }) => {
      if (frames.has(i)) return;
      frames.set(i, info);
      waiting.get(i)?.(info);
      if (frames.size === n) filled();
    },
    onError: ({ frameIndex, reason }) => errors.push(`frame ${frameIndex}: ${reason}`),
  });
  const frame = (i) => frames.get(i) ?? new Promise((r) => waiting.set(i, r));
  const summary = done.then(() => ({
    n, errors, exact: [...frames.values()].filter((f) => f.exact === true).length,
    decodedBytes: [...frames.values()].reduce((s, f) => s + f.pixels.byteLength, 0),
  }));
  return { q, meta, n, frame, frames, summary, client };
}

/** The image's first window, or one spanning every stored code ("identity"). */
export function windowOf(meta, info, which) {
  const bits = meta.bitsStored ?? info.bits;
  if (which === "identity") return { center: 2 ** (bits - 1), width: 2 ** bits, function: "LINEAR" };
  const w = meta.window;
  return { center: w.center[0], width: w.width[0], function: w.function ?? "LINEAR" };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
