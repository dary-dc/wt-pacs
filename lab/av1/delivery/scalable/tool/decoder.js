/**
 * A decoder worker for a two-layer series, layer-major: entry i < F is frame i's base unit, decoded on dav1d-WASM and
 * posted as a preview; entry exactAt + i is frame i's exact payload — the shipped one beside an alone base, or the
 * whole scalable unit when the top is predicted — decoded by the product's av1.js. Entries in between pad the exact
 * layer to a group boundary and are never shown. client/decode/decoder.js's protocol.
 */
import { begin, end } from "/client/decode/av1-frame.js";
import * as payload from "/client/decode/av1.js";

let M = null;
let cfg = null;
let ptr = 0;
let cap = 0;
let last = null;
let toConsumer = null;
let queue = Promise.resolve();

const abs = () => performance.timeOrigin + performance.now();

async function init(d, groupLength) {
  cfg = { ...d, exactAt: d.exactAt ?? d.frames };
  const src = await (await fetch(d.glue)).text();
  const factory = new Function(`${src}\nreturn Dav1dModule;`).call(self);
  M = await factory({ locateFile: (f) => d.dir + "/" + f, wasmBinary: await (await fetch(d.wasm)).arrayBuffer() });
  const opened = M._av1_open(1);
  if (opened < 0) throw new Error(`dav1d_open: ${opened}`);
  await payload.init({ ...d, groupLength });
}

/** Frame i's base; a non-key base only right after the one before it, on this decoder. */
function decodeBase(bytes, unit) {
  const follows = last !== null && unit.gen === last.gen && unit.index === last.index + 1;
  if (!unit.key && !follows) throw new Error(`undecodable: base ${unit.index - 1} was not decoded before it here`);
  last = null;
  if (bytes.length > cap) {
    if (ptr) M._free(ptr);
    cap = bytes.length;
    ptr = M._malloc(cap);
  }
  M.HEAPU8.set(bytes, ptr);
  if (unit.key) M._av1_flush();
  const r = M._av1_decode(ptr, bytes.length);
  if (r < 0) throw new Error(`undecodable: dav1d ${r}`);
  if (M._av1_layer() !== 0) throw new Error(`undecodable: spatial layer ${M._av1_layer()} where the base was due`);
  last = { gen: unit.gen, index: unit.index };
  const bits = M._av1_bits();
  const heap = bits > 8 ? M.HEAPU16 : M.HEAPU8;
  const shift = bits > 8 ? 1 : 0;
  const pic = { width: M._av1_width(), height: M._av1_height(), bits,
    planes: [{ heap, offset: M._av1_plane(0) >> shift, stride: Number(M._av1_stride(0)) >> shift }] };
  return { ...end(begin(pic, { bits, depth: bits, split: 0, offset: 0, signed: false, rct: false })), preview: true };
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    try {
      await init(m.decoder, m.groupLength);
      postMessage({ kind: "ready" });
    } catch (err) {
      postMessage({ kind: "init-failed", reason: String(err?.message ?? err) });
    }
    return;
  }
  if (m.kind === "decode") queue = queue.then(() => decode(m));
};

async function decode(m) {
  if (m.index >= cfg.frames && m.index < cfg.exactAt) {
    postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount: 0, buffer: m.bytes.buffer }, [m.bytes.buffer]);
    return;
  }
  const stamps = { ...m.stamps, decodeStart: abs() };
  try {
    const r = m.index < cfg.frames ? decodeBase(m.bytes, m) : await payload.decodeFrame(m.bytes, m);
    stamps.decodeEnd = abs();
    const { info, sab, byteCount, range } = r;
    toConsumer.postMessage({
      kind: "frame", index: m.index, gen: m.gen, pixels: sab, width: info.width, height: info.height,
      bits: info.bitsPerSample, components: info.componentCount, signed: info.isSigned, min: range.min, max: range.max,
      byteCount, wireBytes: m.bytes.length, stamps, path: r.path, ...(r.preview && { preview: true }),
    });
    postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  } catch (err) {
    postMessage({ kind: "failed", index: m.index, gen: m.gen, reason: String(err?.message ?? err), buffer: m.bytes.buffer }, [m.bytes.buffer]);
  }
}
