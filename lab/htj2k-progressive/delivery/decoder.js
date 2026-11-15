/**
 * The ladder's decoder worker on the downloader's decoderWorker seam, speaking client/decode/decoder.js's protocol:
 * entry i < F is frame i's prefix, decoded at (level, level) by the lab decoder and posted as a preview; entry F + i
 * is its rest, joined to the prefix and decoded whole by the product's module and build. Workers share prefixes, since
 * a rest may reach another. lab/htj2k-progressive/README.md §Stage 3
 */
import * as product from "/client/decode/htj2k.js";

const LAB = "/lab/.openjph-build/wasm/levels.js";
let cfg = null;
let lab = null;
let toConsumer = null;
let queue = Promise.resolve();
const prefixes = new Map();
const waiting = new Map();
const shared = new BroadcastChannel("ladder-prefixes");

const abs = () => performance.timeOrigin + performance.now();
const keep = (i, bytes) => { prefixes.set(i, bytes); waiting.get(i)?.(bytes); waiting.delete(i); };
shared.onmessage = (e) => keep(e.data.i, e.data.bytes);
const prefix = (i) => prefixes.get(i) ?? new Promise((r) => waiting.set(i, r));

async function init(d) {
  await product.init(d);
  const src = await (await fetch(LAB)).text();
  const factory = new Function(`${src}\nreturn OpenJPHModule;`).call(globalThis);
  const M = await factory({ locateFile: (f) => LAB.replace(/[^/]*$/, f), wasmBinary: await (await fetch(LAB.replace(/js$/, "wasm"))).arrayBuffer() });
  lab = new M.HTJ2KDecoder();
}

/** As the product's decodeFrame leaves a frame: in a SharedArrayBuffer, its range taken. */
function preview(bytes) {
  lab.getEncodedBuffer(bytes.length).set(bytes);
  lab.readHeader();
  lab.decodeLevel(cfg.level, cfg.level);
  const out = lab.getDecodedBuffer();
  const info = lab.getFrameInfo();
  const sab = new SharedArrayBuffer(out.length);
  new Uint8Array(sab).set(out);
  return { info, sab, byteCount: out.length, range: product.unranged(info) ? { min: 0, max: 255 } : lab.getRange(), preview: true };
}

async function decodeEntry(bytes, index) {
  if (index < cfg.frames) {
    const copy = bytes.slice();
    keep(index, copy);
    shared.postMessage({ i: index, bytes: copy });
    return preview(bytes);
  }
  const head = await prefix(index - cfg.frames);
  const whole = new Uint8Array(head.length + bytes.length);
  whole.set(head);
  whole.set(bytes, head.length);
  return product.decodeFrame(whole);
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    cfg = m.decoder;
    try {
      await init(m.decoder);
      postMessage({ kind: "ready" });
    } catch (err) {
      postMessage({ kind: "init-failed", reason: String(err?.message ?? err) });
    }
    return;
  }
  if (m.kind === "decode") queue = queue.then(() => decode(m));
};

async function decode(m) {
  const stamps = { ...m.stamps, decodeStart: abs() };
  try {
    const r = await decodeEntry(m.bytes, m.index);
    stamps.decodeEnd = abs();
    const { info, sab, byteCount, range } = r;
    toConsumer.postMessage({
      kind: "frame", index: m.index, gen: m.gen, pixels: sab, width: info.width, height: info.height,
      bits: info.bitsPerSample, components: info.componentCount, signed: info.isSigned, min: range.min, max: range.max,
      byteCount, wireBytes: m.bytes.length, stamps, ...(r.preview && { preview: true }),
    });
    postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  } catch (err) {
    postMessage({ kind: "failed", index: m.index, gen: m.gen, reason: String(err?.message ?? err), buffer: m.bytes.buffer }, [m.bytes.buffer]);
  }
}
