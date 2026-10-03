/**
 * AV1 through dav1d-WASM behind decoder.js's contract: a keyframe decodes alone, any other frame only
 * after its predecessor, here. Build: lab/av1/dav1d-wasm; seam: docs/av1/adr-unit.md §2–3.
 */
import { begin, end, units } from "./av1-frame.js";

let M = null;
let cfg = null;
let ptr = 0;
let cap = 0;
/** The frame this decoder decoded last, `{ gen, index }`: what a frame of a group decodes against. */
let last = null;

export async function init(d) {
  cfg = d;
  // The glue is a classic script, as OpenJPH's is: decoder.js says why it is evaluated this way.
  const src = await (await fetch(d.glue)).text();
  const factory = new Function(`${src}\nreturn Dav1dModule;`).call(self);
  const opts = { locateFile: (f) => d.dir + "/" + f, mainScriptUrlOrBlob: d.glue };
  if (!d.streaming) opts.wasmBinary = await (await fetch(d.wasm)).arrayBuffer();
  M = await factory(opts);
  const opened = M._av1_open(d.threads ?? 1);
  if (opened < 0) throw new Error(`dav1d_open: ${opened}`);
}

/** A split frame's low unit replaces the top's picture, so it goes second; a split series is G = 1. */
export function decodeFrame(bytes, unit = { key: true }) {
  const follows = last !== null && unit.gen === last.gen && unit.index === last.index + 1;
  if (!unit.key && !follows) throw new Error(`undecodable: frame ${unit.index - 1} was not decoded before it here`);
  last = null;
  if (!cfg.split) {
    const f = end(begin(picture(bytes, unit.key), cfg));
    last = { gen: unit.gen, index: unit.index };
    return f;
  }
  const [top, low] = units(bytes);
  const f = begin(picture(top, true), cfg);
  return end(f, picture(low, true));
}

/** A view of dav1d's picture, valid until its next decode. */
function picture(bytes, key) {
  if (bytes.length > cap) {
    if (ptr) M._free(ptr);
    cap = bytes.length;
    ptr = M._malloc(cap);
  }
  M.HEAPU8.set(bytes, ptr);
  // A frame of a group sent as a keyframe then fails, not decodes against the previous frame's references.
  if (key) M._av1_flush();
  const r = M._av1_decode(ptr, bytes.length);
  if (r < 0) throw new Error(`undecodable: dav1d ${r}`);

  const layout = M._av1_layout();
  // Grey is 4:0:0; colour is lossless only as 4:4:4 with the identity matrix (0), planes G, B, R.
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
