/**
 * The `res` variant's decoder worker, beside client/decode/decoder.js and speaking its protocol: entry i < F is
 * frame i's prefix, posted as a preview at the series' level; entry F + i is the rest, joined to the prefix and
 * posted as the exact frame. Workers share prefixes, since the rest may reach another. lab/av1/decode/resolution-level/README.md
 */
import { decodePreview, decodeWhole, init } from "./codec.js";

let cfg = null;
let toConsumer = null;
let queue = Promise.resolve();
const prefixes = new Map();
const waiting = new Map();
const shared = new BroadcastChannel("reslevel-prefixes");

const abs = () => performance.timeOrigin + performance.now();
const keep = (i, bytes) => { prefixes.set(i, bytes); waiting.get(i)?.(bytes); waiting.delete(i); };
shared.onmessage = (e) => keep(e.data.i, e.data.bytes);
const prefix = (i) => prefixes.get(i) ?? new Promise((r) => waiting.set(i, r));

async function decodeEntry(bytes, index) {
  if (index < cfg.frames) {
    const copy = bytes.slice();
    keep(index, copy);
    shared.postMessage({ i: index, bytes: copy });
    return { ...decodePreview(bytes, cfg.level), preview: true };
  }
  const head = await prefix(index - cfg.frames);
  const whole = new Uint8Array(head.length + bytes.length);
  whole.set(head);
  whole.set(bytes, head.length);
  return decodeWhole(whole);
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
