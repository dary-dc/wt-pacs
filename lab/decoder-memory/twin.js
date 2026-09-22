/**
 * `client/downloader/decoder.js` with one knob per candidate mechanism, so an arm differs from the
 * product by one line: `reuse` (one decoder object for the worker's life, or one per frame) and
 * `module` (a WebAssembly.Module compiled once on the page and shared, or this worker's own
 * compile of a wasmBinary). docs/decode/README.md §What a decoder worker costs, resident
 */
let M = null;
let dec = null;
let toConsumer = null;
let reuse = true;
let ballast = null;

const abs = () => performance.timeOrigin + performance.now();

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
  const d = reuse ? dec : new M.HTJ2KDecoder();
  d.getEncodedBuffer(bytes.length).set(bytes);
  d.readHeader();
  const info = d.getFrameInfo();
  d.decode();
  const out = d.getDecodedBuffer();
  const wide = info.bitsPerSample > 8;
  const declared = info.width * info.height * info.componentCount * (wide ? 2 : 1);
  if (declared === 0 || out.length < declared) {
    throw new Error(`undecodable: ${out.length} bytes for a header declaring ${declared}`);
  }
  const sab = new SharedArrayBuffer(out.length);
  new Uint8Array(sab).set(out);
  // The decoded buffer is a view into the WASM heap: the copy above has to precede the delete.
  if (!reuse) d.delete();
  const view = wide
    ? (info.isSigned ? new Int16Array(sab) : new Uint16Array(sab))
    : (info.isSigned ? new Int8Array(sab) : new Uint8Array(sab));
  return { info, sab, byteCount: out.length, range: finish(view, info.bitsPerSample, info.isSigned) };
}

async function init(m) {
  reuse = m.reuse !== false;
  const src = await (await fetch(m.decoder.glue)).text();
  const factory = new Function(
    `${src}\nreturn typeof Module !== "undefined" ? Module : OpenJPHModule;`,
  ).call(self);
  const opts = { locateFile: (f) => m.decoder.dir + "/" + f };
  if (m.module) {
    opts.instantiateWasm = (imports, ready) => {
      WebAssembly.instantiate(m.module, imports).then((instance) => ready(instance, m.module));
      return {};
    };
  } else {
    opts.wasmBinary = await (await fetch(m.decoder.wasm)).arrayBuffer();
  }
  M = await factory(opts);
  if (reuse) dec = new M.HTJ2KDecoder();
  // The instrument's calibration: N MB per worker, touched, so the slope has a known answer.
  if (m.ballastMb) ballast = new Uint8Array(m.ballastMb * 1048576).fill(1);
}

/** The source build exports no HEAPU8, and a typed_memory_view is backed by the memory itself. */
function heapBytes() {
  const d = reuse ? dec : new M.HTJ2KDecoder();
  const bytes = d.getEncodedBuffer(1).buffer.byteLength;
  if (!reuse) d.delete();
  return bytes;
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "heap") return void postMessage({ kind: "heap", bytes: heapBytes() });
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    try {
      await init(m);
      postMessage({ kind: "ready", ballast: ballast?.length ?? 0 });
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
