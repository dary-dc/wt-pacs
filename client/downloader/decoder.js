/**
 * One decoder instance. Pixels are written once, into a SharedArrayBuffer, and go straight to the
 * consumer over the port the downloader handed out. docs/proposal-downloader.md §The decoders
 */
let M = null;
let dec = null;
let toConsumer = null;

const abs = () => performance.timeOrigin + performance.now();

/**
 * Sign-extend samples stored in fewer bits than they occupy, and take the range in the same pass.
 * No fixture proves this: docs/cloud-queue.md §Blocked — no signed HTJ2K fixture can be made here.
 */
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

async function init(m) {
  // A module worker has no importScripts and the glue is a classic script. Its factory is a
  // top-level `var`, which inside a Function body is local, so hand it back explicitly.
  const src = await (await fetch(m.decoder.glue)).text();
  const factory = new Function(
    `${src}\nreturn typeof Module !== "undefined" ? Module : OpenJPHModule;`,
  ).call(self);
  const wasmBinary = await (await fetch(m.decoder.wasm)).arrayBuffer();
  M = await factory({ wasmBinary, locateFile: (f) => m.decoder.dir + "/" + f });
  // One decoder object reused: parity.mjs is byte-identical on every fixture, so reuse is safe.
  dec = new M.HTJ2KDecoder();
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
    const bytes = new Uint8Array(m.bytes);
    dec.getEncodedBuffer(bytes.length).set(bytes);
    dec.readHeader();
    const info = dec.getFrameInfo();
    dec.decode();
    const out = dec.getDecodedBuffer();

    const wide = info.bitsPerSample > 8;
    const sab = new SharedArrayBuffer(out.length);
    const pixels = new Uint8Array(sab);
    pixels.set(out);
    const view = wide
      ? (info.isSigned ? new Int16Array(sab) : new Uint16Array(sab))
      : (info.isSigned ? new Int8Array(sab) : new Uint8Array(sab));
    const range = finish(view, info.bitsPerSample, info.isSigned);

    stamps.decodeEnd = abs();
    toConsumer.postMessage({
      kind: "frame",
      index: m.index,
      pixels: sab,
      width: info.width,
      height: info.height,
      bits: info.bitsPerSample,
      components: info.componentCount,
      signed: info.isSigned,
      min: range.min,
      max: range.max,
      byteCount: out.length,
      stamps,
    });
    postMessage({ kind: "done", index: m.index, byteCount: out.length });
  } catch (err) {
    postMessage({ kind: "failed", index: m.index, reason: String(err?.message ?? err) });
  }
};
