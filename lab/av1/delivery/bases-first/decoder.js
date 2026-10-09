/**
 * A decoder worker for a layer-major scalable series, beside client/decode/decoder.js and speaking
 * its protocol: entry i < F decodes to frame i's base, posted as a preview; entry F + i is the whole
 * unit, posted as the exact frame. dav1d-WASM, one decoder a group. docs/av1/adr-unit.md §5
 */
import { begin, end } from "/client/decode/av1-frame.js";

let M = null;
let cfg = null;
let ptr = 0;
let cap = 0;
let last = null;
let toConsumer = null;
let queue = Promise.resolve();

const abs = () => performance.timeOrigin + performance.now();

async function init(d) {
  cfg = d;
  const src = await (await fetch(d.glue)).text();
  const factory = new Function(`${src}\nreturn Dav1dModule;`).call(self);
  M = await factory({ locateFile: (f) => d.dir + "/" + f, wasmBinary: await (await fetch(d.wasm)).arrayBuffer() });
  const opened = M._av1_open(1);
  if (opened < 0) throw new Error(`dav1d_open: ${opened}`);
}

/** Frame i's base for entry i < F, its exact frame for entry F + i; a non-key entry only after the one before it. */
function decodeEntry(bytes, unit) {
  const follows = last !== null && unit.gen === last.gen && unit.index === last.index + 1;
  if (!unit.key && !follows) throw new Error(`undecodable: entry ${unit.index - 1} was not decoded before it here`);
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
  const base = unit.index < cfg.frames;
  const want = base ? 0 : M._av1_top_layer();
  // The whole unit's base comes out first and is skipped uncopied: the base entry showed it.
  for (let layer; (layer = M._av1_layer()) < want; ) {
    const next = M._av1_next();
    if (next < 0) throw new Error(`undecodable: spatial layer ${layer} of ${want} is the unit's last (dav1d ${next})`);
  }
  if (M._av1_layer() !== want) throw new Error(`undecodable: spatial layer ${M._av1_layer()} where ${want} was due`);
  last = { gen: unit.gen, index: unit.index };
  return { ...end(begin(held(), cfg)), preview: base };
}

function held() {
  const layout = M._av1_layout();
  if (layout !== 0 && !(layout === 3 && M._av1_matrix() === 0)) {
    throw new Error(`undecodable: layout ${layout}, matrix ${M._av1_matrix()} is neither grey nor RGB`);
  }
  const bits = M._av1_bits();
  const shift = bits > 8 ? 1 : 0;
  const heap = shift ? M.HEAPU16 : M.HEAPU8;
  const planes = (layout === 0 ? [0] : [0, 1, 2]).map((p) => ({
    heap, offset: M._av1_plane(p) >> shift, stride: Number(M._av1_stride(p)) >> shift,
  }));
  return { width: M._av1_width(), height: M._av1_height(), bits, planes };
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
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

function decode(m) {
  const stamps = { ...m.stamps, decodeStart: abs() };
  try {
    const r = decodeEntry(m.bytes, m);
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
