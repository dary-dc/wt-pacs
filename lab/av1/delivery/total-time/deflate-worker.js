// The low-stream measurement's coding behind decoder.js's protocol: a frame is `[u32le top length][top unit][low]`, the
// top AV1 through WebCodecs, the low k bits packed MSB first and raw-deflated, inflated beside the top
// and merged by the product's own av1-frame.js. A lab variant, not the product. lab/av1/delivery/total-time/README.md
import { begin, end, units } from "/client/decode/av1-frame.js";

let cfg = null;
let toConsumer = null;
let vd = null;
let got = [];
let queue = Promise.resolve();
const abs = () => performance.timeOrigin + performance.now();

function open() {
  vd = new VideoDecoder({ output: (f) => got.push(f), error: () => {} });
  vd.configure({ codec: "av01.0.04M.10", hardwareAcceleration: "prefer-software", optimizeForLatency: true });
}

const FORMATS = { I420: 8, I420P10: 10 };

/** The top's luma as a picture; 4:0:0 comes back as 4:2:0 with neutral chroma. */
async function top(bytes) {
  vd.decode(new EncodedVideoChunk({ type: "key", timestamp: 0, data: bytes }));
  await vd.flush();
  const frame = got.shift();
  for (const f of got.splice(0)) f.close();
  if (!frame) throw new Error("undecodable: no frame");
  try {
    const bits = FORMATS[frame.format];
    if (!bits) throw new Error(`undecodable: ${frame.format}`);
    const buf = new ArrayBuffer(frame.allocationSize());
    const [{ offset, stride }] = await frame.copyTo(buf);
    const s = bits > 8 ? 1 : 0;
    const { width, height } = frame.visibleRect;
    return { width, height, bits, planes: [{ heap: s ? new Uint16Array(buf) : new Uint8Array(buf), offset: offset >> s, stride: stride >> s }] };
  } finally {
    frame.close();
  }
}

async function inflate(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
}

/** k-bit samples, MSB first, raster order: as lab/av1/bytes/low-stream/encx.py packs them. */
function unpack(bytes, k, width, height) {
  const n = width * height;
  if (bytes.length !== Math.ceil((n * k) / 8)) throw new Error(`undecodable: ${bytes.length} low bytes for ${n} ${k}-bit samples`);
  const heap = new Uint8Array(n);
  for (let i = 0, j = 0, acc = 0, have = 0; i < n; i++) {
    if (have < k) {
      acc = ((acc << 8) | bytes[j++]) & 0xffff;
      have += 8;
    }
    have -= k;
    heap[i] = (acc >> have) & ((1 << k) - 1);
  }
  return { width, height, planes: [{ heap, offset: 0, stride: width }] };
}

async function decodeFrame(bytes) {
  const [t, l] = units(bytes);
  const [pic, low] = await Promise.all([top(t), inflate(l)]);
  return end(begin(pic, cfg), unpack(low, cfg.split, pic.width, pic.height));
}

async function decode(m) {
  const stamps = { ...m.stamps, decodeStart: abs() };
  try {
    const { info, sab, byteCount, range } = await decodeFrame(m.bytes);
    stamps.decodeEnd = abs();
    toConsumer.postMessage({ kind: "frame", index: m.index, gen: m.gen, pixels: sab, width: info.width, height: info.height,
      bits: info.bitsPerSample, components: 1, signed: false, min: range.min, max: range.max, byteCount, wireBytes: m.bytes.length, stamps });
    postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  } catch (err) {
    if (vd.state === "closed") open();
    postMessage({ kind: "failed", index: m.index, gen: m.gen, reason: String(err?.message ?? err), buffer: m.bytes.buffer }, [m.bytes.buffer]);
  }
}

onmessage = (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    cfg = m.decoder;
    try {
      open();
      postMessage({ kind: "ready" });
    } catch (err) {
      postMessage({ kind: "init-failed", reason: String(err?.message ?? err) });
    }
    return;
  }
  if (m.kind === "decode") queue = queue.then(() => decode(m));
};
