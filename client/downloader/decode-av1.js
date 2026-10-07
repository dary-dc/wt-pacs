/**
 * One AV1 stream's unit through dav1d-WASM, as a picture av1-frame.js merges: a keyframe decodes alone,
 * any other unit only after its predecessor, here. Build: lab/av1/dav1d-wasm; seam: docs/av1/adr-unit.md §2–3.
 */
import { continues } from "./av1-item.js";
import { instantiate } from "./wasm-glue.js";

let M = null;
let ptr = 0;
let cap = 0;
/** The unit this decoder decoded last, `{ gen, index }`: what a unit of a group decodes against. */
let last = null;

export async function init(d) {
  M = await instantiate(d, "Dav1dModule", { mainScriptUrlOrBlob: d.glue });
  const opened = M._av1_open(d.threads ?? 1);
  if (opened < 0) throw new Error(`dav1d_open: ${opened}`);
}

/** A view of the unit's top layer, valid until the next decode; layers under it go to `preview` (adr-unit.md §6). */
export function picture(bytes, unit = { key: true }, preview) {
  continues(last, unit);
  last = null;
  if (bytes.length > cap) {
    if (ptr) M._free(ptr);
    cap = bytes.length;
    ptr = M._malloc(cap);
  }
  M.HEAPU8.set(bytes, ptr);
  // A unit of a group sent as a keyframe then fails, not decodes against the previous unit's references.
  if (unit.key) M._av1_flush();
  const r = M._av1_decode(ptr, bytes.length);
  if (r < 0) throw new Error(`undecodable: dav1d ${r}`);
  for (let layer, top = M._av1_top_layer(); (layer = M._av1_layer()) < top; ) {
    preview?.(held());
    const next = M._av1_next();
    if (next < 0) throw new Error(`undecodable: spatial layer ${layer} of ${top} is the unit's last (dav1d ${next})`);
  }
  const p = held();
  if (unit.gen !== undefined) last = { gen: unit.gen, index: unit.index };
  return p;
}

function held() {
  const layout = M._av1_layout();
  // Grey is 4:0:0; colour is lossless only as 4:4:4 with the identity matrix (0).
  if (layout !== 0 && !(layout === 3 && M._av1_matrix() === 0)) {
    throw new Error(`undecodable: layout ${layout}, matrix ${M._av1_matrix()} is neither grey nor 4:4:4 identity`);
  }
  const bits = M._av1_bits();
  const shift = bits > 8 ? 1 : 0;
  const heap = shift ? M.HEAPU16 : M.HEAPU8;
  const planes = (layout === 0 ? [0] : [0, 1, 2]).map((p) => ({
    heap, offset: M._av1_plane(p) >> shift, stride: Number(M._av1_stride(p)) >> shift,
  }));
  return { width: M._av1_width(), height: M._av1_height(), bits, planes };
}
