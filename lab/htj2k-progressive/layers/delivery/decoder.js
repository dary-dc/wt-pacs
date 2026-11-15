/**
 * The quality shapes' decoder worker on the downloader's decoderWorker seam, speaking client/decode/decoder.js's
 * protocol: entry i < F is frame i's layer-1 prefix, posted as a preview; entry F + i its rest, joined to the prefix.
 * Both through the product's module over the layered lab build (decoder.sh), which the variant names. Workers share
 * prefixes, since a rest may reach another. layers/README.md, §Quality layers, measured
 */
import * as product from "/client/decode/htj2k.js";

let cfg = null;
let toConsumer = null;
let queue = Promise.resolve();
const prefixes = new Map();
const waiting = new Map();
const shared = new BroadcastChannel("layer-prefixes");

const abs = () => performance.timeOrigin + performance.now();
const keep = (i, bytes) => { prefixes.set(i, bytes); waiting.get(i)?.(bytes); waiting.delete(i); };
shared.onmessage = (e) => keep(e.data.i, e.data.bytes);
const prefix = (i) => prefixes.get(i) ?? new Promise((r) => waiting.set(i, r));

async function decodeEntry(bytes, index) {
  if (index < cfg.frames) {
    const copy = bytes.slice();
    keep(index, copy);
    shared.postMessage({ i: index, bytes: copy });
    return { ...product.decodeFrame(bytes), preview: true };
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
      await product.init(m.decoder);
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
