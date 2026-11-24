/**
 * FIT's decoder worker, speaking client/decode/decoder.js's protocol: entry i < F, frame i's level prefix, is decoded
 * at the fit level, clamped, and checked against the lab's truth (`fit.levelDigests`, ll.py's); entry F + i, its rest,
 * is joined to the prefix and checked by the frame's digest. A level picture unequal to its truth fails the frame.
 * Workers share prefixes, since a rest may reach another. docs/client/evidence/delivery-comparison.md A2.2, A2.8
 */
import { decodePreview, decodeWhole, init } from "../av1/decode/resolution-level/codec.js";
import { hasher } from "../../client/decode/xxh3.js";

let fit = null;
let digests = null;
let xxh3 = null;
let toConsumer = null;
let queue = Promise.resolve();
const prefixes = new Map();
const waiting = new Map();
const shared = new BroadcastChannel("fit-prefixes");

const abs = () => performance.timeOrigin + performance.now();
const hash = (sab) => xxh3.init().update(new Uint8Array(sab)).digest("hex");
const keep = (i, bytes) => { prefixes.set(i, bytes); waiting.get(i)?.(bytes); waiting.delete(i); };
shared.onmessage = (e) => keep(e.data.i, e.data.bytes);
const prefix = (i) => prefixes.get(i) ?? new Promise((r) => waiting.set(i, r));

async function decodeEntry(bytes, index) {
  if (index < fit.frames) {
    const copy = bytes.slice();
    keep(index, copy);
    shared.postMessage({ i: index, bytes: copy });
    const r = decodePreview(bytes, fit.level, { clamp: fit.mutate !== "no-clamp" });
    if (fit.mutate === "flip-level" && index === 0) new Uint16Array(r.sab)[0] ^= 1;
    const got = hash(r.sab);
    if (got !== fit.levelDigests[index]) throw new Error(`level ${fit.level} picture of frame ${index} gave ${got}, not its truth ${fit.levelDigests[index]}`);
    return { ...r, route: "htj2k-level", exact: "unchecked", levelChecked: true };
  }
  const i = index - fit.frames;
  const head = await prefix(i);
  const whole = new Uint8Array(head.length + bytes.length);
  whole.set(head);
  whole.set(bytes, head.length);
  const r = await decodeWhole(whole);
  const got = hash(r.sab);
  return { ...r, exact: got === digests[i], ...(got !== digests[i] && { reason: `frame ${i} gave ${got}, not ${digests[i]}` }) };
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    ({ fit } = m.decoder);
    digests = m.digests;
    try {
      await init(m.decoder);
      xxh3 = await hasher();
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
    const { info, sab, byteCount, range, route, exact, reason, levelChecked } = await decodeEntry(m.bytes, m.index);
    stamps.decodeEnd = abs();
    toConsumer.postMessage({
      kind: "frame", index: m.index, gen: m.gen, pixels: sab, width: info.width, height: info.height,
      bits: info.bitsPerSample, components: info.componentCount, signed: info.isSigned, min: range.min, max: range.max,
      byteCount, route, exact, reason, levelChecked, wireBytes: m.bytes.length, stamps,
    });
    postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  } catch (err) {
    postMessage({ kind: "failed", index: m.index, gen: m.gen, reason: String(err?.message ?? err), buffer: m.bytes.buffer }, [m.bytes.buffer]);
  }
}
