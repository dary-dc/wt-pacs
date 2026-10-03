// WebCodecs' AV1 decoder behind decoder.js's protocol and output: one chunk, flushed, copied out and
// interleaved R, G, B from planes G, B, R into a SharedArrayBuffer, as decode-av1.js returns it.
// 8-bit 4:4:4 only: the one shape here WebCodecs returns exactly (docs/decode/README.md §AV1).
let decoder = null;
let toConsumer = null;
let codec = null;
let pending = null;
// The downloader keeps two frames outstanding a decoder; one VideoDecoder takes them one at a time.
let queue = Promise.resolve();
const abs = () => performance.timeOrigin + performance.now();

function configure() {
  decoder = new VideoDecoder({ output: (f) => pending.resolve(f), error: (e) => pending.reject(e) });
  decoder.configure({ codec, hardwareAcceleration: "prefer-software" });
}

async function decodeFrame(bytes) {
  const out = new Promise((resolve, reject) => (pending = { resolve, reject }));
  decoder.decode(new EncodedVideoChunk({ type: "key", timestamp: 0, data: bytes }));
  await decoder.flush();
  const frame = await out;
  const { codedWidth: width, codedHeight: height } = frame;
  if (frame.format !== "I444") throw new Error(`undecodable: ${frame.format}`);
  const planar = new Uint8Array(frame.allocationSize());
  const layout = await frame.copyTo(planar);
  frame.close();
  const sab = new SharedArrayBuffer(width * height * 3);
  const px = new Uint8Array(sab);
  for (let c = 0; c < 3; c++) {
    const { offset, stride } = layout[(c + 2) % 3];
    for (let y = 0; y < height; y++) {
      let s = offset + y * stride;
      for (let o = y * width * 3 + c, x = 0; x < width; x++, s++, o += 3) px[o] = planar[s];
    }
  }
  return { sab, width, height };
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    // The downloader's own `codec` names the series' codec; the WebCodecs string rides beside it.
    codec = m.decoder.webcodecs ?? m.decoder.codec;
    configure();
    postMessage({ kind: "ready" });
    return;
  }
  queue = queue.then(() => decodeOne(m));
};

async function decodeOne(m) {
  const stamps = { ...m.stamps, decodeStart: abs() };
  try {
    const { sab, width, height } = await decodeFrame(m.bytes);
    stamps.decodeEnd = abs();
    toConsumer.postMessage({ kind: "frame", index: m.index, gen: m.gen, pixels: sab, width, height, stamps });
    postMessage({ kind: "done", index: m.index, gen: m.gen, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  } catch (err) {
    postMessage({ kind: "failed", index: m.index, gen: m.gen, reason: String(err?.message ?? err), buffer: m.bytes.buffer },
      [m.bytes.buffer]);
  }
}
