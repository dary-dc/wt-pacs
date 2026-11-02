/**
 * A decoder worker for a layered series, layer-major: entry i < F is frame i's base unit and, with three layers, entry
 * middleAt + i its base-and-middle unit, both decoded on dav1d-WASM and posted as previews; entry exactAt + i is frame
 * i's exact payload — the shipped one beside an alone base, or the whole scalable unit when the top is predicted —
 * decoded by the product's av1.js. Entries in between pad a layer to a group boundary and are never shown.
 * client/decode/decoder.js's protocol. `mutate` (lab checks only): "middle-exact" posts a middle unmarked;
 * "keep-base" and "keep-middle" cut each exact top to that layer, a decoder returning a lower layer as the chunk's frame.
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
  cfg = { ...d, exactAt: d.exactAt ?? d.frames, middleAt: d.middleAt ?? Infinity };
  const src = await (await fetch(d.glue)).text();
  const factory = new Function(`${src}\nreturn Dav1dModule;`).call(self);
  M = await factory({ locateFile: (f) => d.dir + "/" + f, wasmBinary: await (await fetch(d.wasm)).arrayBuffer() });
  const opened = M._av1_open(1);
  if (opened < 0) throw new Error(`dav1d_open: ${opened}`);
  // A slow exact frame flushed mid-group ends its group: waited for as long as the downloader waits (README §The failed visit).
  await payload.init({ ...d, groupLength, stallMs: d.stallMs ?? 10_000 });
}

/** Frame i's base, or its middle (layer 1); a non-key unit only right after the one before it, on this decoder. */
function decodeLower(bytes, unit, layer) {
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
  // dav1d outputs every layer of a unit here, the base first.
  while (M._av1_layer() < layer) if (M._av1_next() !== 0) throw new Error(`undecodable: no spatial layer ${layer} in the unit`);
  if (M._av1_layer() !== layer) throw new Error(`undecodable: spatial layer ${M._av1_layer()} where layer ${layer} was due`);
  last = { gen: unit.gen, index: unit.index };
  const bits = M._av1_bits();
  const heap = bits > 8 ? M.HEAPU16 : M.HEAPU8;
  const shift = bits > 8 ? 1 : 0;
  const pic = { width: M._av1_width(), height: M._av1_height(), bits,
    planes: [{ heap, offset: M._av1_plane(0) >> shift, stride: Number(M._av1_stride(0)) >> shift }] };
  const preview = !(layer === 1 && cfg.mutate === "middle-exact");
  return { ...end(begin(pic, { bits, depth: bits, split: 0, offset: 0, signed: false, rct: false })), preview, layer: layer ? "middle" : "base" };
}

/** A lower layer taken as an exact chunk's frame: the scalable top cut above `keep` (lab mutation, docs/av1 §10). */
function cut(bytes, keep) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const split = bytes[3];
  const at = split ? 24 : 20;
  const top = bytes.subarray(at, at + (split ? view.getUint32(20, true) : view.getUint32(16, true)));
  const kept = [];
  for (let pos = 0; pos < top.length;) {
    const ext = (top[pos] >> 2) & 1;
    let size = 0, k = 0, b;
    do { b = top[pos + 1 + ext + k]; size += (b & 127) * 2 ** (7 * k); k++; } while (b & 128);
    const end = pos + 1 + ext + k + size;
    if (!(ext && ((top[pos + 1] >> 3) & 3) > keep)) kept.push(top.subarray(pos, end));
    pos = end;
  }
  const unit = new Uint8Array(kept.reduce((n, o) => n + o.length, 0));
  kept.reduce((n, o) => (unit.set(o, n), n + o.length), 0);
  const low = split ? bytes.subarray(at + top.length) : new Uint8Array(0);
  const out = new Uint8Array(at + unit.length + low.length);
  out.set(bytes.subarray(0, at));
  const w = new DataView(out.buffer);
  if (split) w.setUint32(20, unit.length, true);
  w.setUint32(16, unit.length + low.length + (split ? 4 : 0), true);
  out.set(unit, at);
  out.set(low, at + unit.length);
  return out;
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
  const filler = (i) => (i >= cfg.frames && i < Math.min(cfg.middleAt, cfg.exactAt)) || (i >= cfg.middleAt + cfg.frames && i < cfg.exactAt);
  if (filler(m.index)) {
    postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount: 0, buffer: m.bytes.buffer }, [m.bytes.buffer]);
    return;
  }
  const stamps = { ...m.stamps, decodeStart: abs() };
  try {
    const keep = { "keep-base": 0, "keep-middle": 1 }[cfg.mutate];
    const r = m.index < cfg.frames ? decodeLower(m.bytes, m, 0)
      : m.index >= cfg.middleAt && m.index < cfg.exactAt ? decodeLower(m.bytes, m, 1)
        : await payload.decodeFrame(keep === undefined ? m.bytes : cut(m.bytes, keep), m);
    stamps.decodeEnd = abs();
    const { info, sab, byteCount, range } = r;
    toConsumer.postMessage({
      kind: "frame", index: m.index, gen: m.gen, pixels: sab, width: info.width, height: info.height,
      bits: info.bitsPerSample, components: info.componentCount, signed: info.isSigned, min: range.min, max: range.max,
      byteCount, wireBytes: m.bytes.length, stamps, path: r.path, ...(r.preview && { preview: true }), ...(r.layer && { layer: r.layer }),
    });
    postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  } catch (err) {
    postMessage({ kind: "failed", index: m.index, gen: m.gen, reason: String(err?.message ?? err), buffer: m.bytes.buffer }, [m.bytes.buffer]);
  }
}
