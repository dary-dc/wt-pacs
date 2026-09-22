/**
 * One decoder instance. Pixels are written once, into a SharedArrayBuffer, and go straight to the
 * consumer over the port the downloader handed out. docs/proposal-downloader.md §The decoders
 */
let M = null;
let dec = null;
let toConsumer = null;

const abs = () => performance.timeOrigin + performance.now();

/** Sign-extend narrow samples and take the range in one pass — docs/decode/README.md §The range pass. */
function finish(view, bits, signed) {
  let min = Infinity;
  let max = -Infinity;
  const shift = 16 - bits;
  for (let i = 0; i < view.length; i++) {
    let v = view[i];
    if (signed && shift > 0) {
      v = (v << shift) >> shift;
      view[i] = v;
    }
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

function decodeFrame(bytes) {
  // Already a Uint8Array over the transferred buffer; re-wrapping copied it for nothing (S14).
  dec.getEncodedBuffer(bytes.length).set(bytes);
  dec.readHeader();
  const info = dec.getFrameInfo();
  dec.decode();
  const out = dec.getDecodedBuffer();
  const wide = info.bitsPerSample > 8;
  // The reused decoder leaves the previous frame's pixels here when a parse fails, so the header
  // is what says the frame is gone, not the length. docs/decode/README.md §A frame that did not decode
  const declared = info.width * info.height * info.componentCount * (wide ? 2 : 1);
  if (declared === 0 || out.length < declared) {
    throw new Error(`undecodable: ${out.length} bytes for a header declaring ${declared}`);
  }

  const sab = new SharedArrayBuffer(out.length);
  new Uint8Array(sab).set(out);
  const view = wide
    ? (info.isSigned ? new Int16Array(sab) : new Uint16Array(sab))
    : (info.isSigned ? new Int8Array(sab) : new Uint8Array(sab));
  return { info, sab, byteCount: out.length, range: finish(view, info.bitsPerSample, info.isSigned) };
}

/** The warm-up's bytes, or none: an optimisation must never reject a decoder's init. */
const warmupBytes = (url) =>
  fetch(url).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b), () => null);

async function init(m) {
  // Fetched beside the compile: it has to fit the idle window — docs/decode/README.md §Warming.
  const warmup = m.warmup ? warmupBytes(m.warmup) : null;
  // A module worker has no importScripts and the glue is a classic script. Its factory is a
  // top-level `var`, which inside a Function body is local, so hand it back explicitly.
  const src = await (await fetch(m.decoder.glue)).text();
  const factory = new Function(
    `${src}\nreturn typeof Module !== "undefined" ? Module : OpenJPHModule;`,
  ).call(self);
  // No binary and the glue streams its own fetch — docs/decode/README.md §The first frame.
  const opts = { locateFile: (f) => m.decoder.dir + "/" + f };
  if (!m.decoder.streaming) opts.wasmBinary = await (await fetch(m.decoder.wasm)).arrayBuffer();
  M = await factory(opts);
  // One decoder object reused: parity.mjs is byte-identical on every fixture, so reuse is safe.
  dec = new M.HTJ2KDecoder();
  const w = warmup && (await warmup);
  if (w) {
    try {
      decodeFrame(w);
    } catch {
      /* a decoder that cannot warm is still a decoder */
    }
  }
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    try {
      await init(m);
      postMessage({ kind: "ready" });
    } catch (err) {
      postMessage({ kind: "init-failed", reason: String(err?.message ?? err) });
    }
    return;
  }
  if (m.kind !== "decode") return;
  const stamps = { ...m.stamps, decodeStart: abs() };
  try {
    const { info, sab, byteCount, range } = decodeFrame(m.bytes);
    stamps.decodeEnd = abs();
    toConsumer.postMessage({
      kind: "frame",
      index: m.index,
      gen: m.gen,
      pixels: sab,
      width: info.width,
      height: info.height,
      bits: info.bitsPerSample,
      components: info.componentCount,
      signed: info.isSigned,
      min: range.min,
      max: range.max,
      byteCount,
      wireBytes: m.bytes.length,
      stamps,
    });
    postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount });
  } catch (err) {
    postMessage({ kind: "failed", index: m.index, gen: m.gen, reason: String(err?.message ?? err) });
  }
};
