/** An HTJ2K codestream through OpenJPH-WASM, one decoder object reused (lab/decode-bench/parity.mjs): docs/decode/README.md §A build of our own */
import { instantiate } from "./wasm-glue.js";

let M = null;
let dec = null;

/** Sign-extend narrow samples (JS shifts are 32-bit) and take the range in one pass — docs/decode/README.md §The range pass. */
export function finish(view, bits, signed) {
  const shift = signed && bits < 8 * view.BYTES_PER_ELEMENT ? 32 - bits : 0;
  let min = Infinity;
  let max = -Infinity;
  // Two loops, not one testing `shift` per sample: docs/decode/README.md §The range pass.
  if (shift) {
    for (let i = 0; i < view.length; i++) {
      const v = (view[i] << shift) >> shift;
      view[i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  } else {
    for (let i = 0; i < view.length; i++) {
      const v = view[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { min, max };
}

/** Nothing reads an 8-bit colour frame's range — its window comes from the tags — so no pass takes it. */
export const unranged = (info) => info.componentCount === 3 && info.bitsPerSample === 8 && !info.isSigned;

export async function init(d) {
  // A threaded build starts its helpers from the glue, not from this worker. docs/decode/README.md §Threads
  M = await instantiate(d, `typeof Module !== "undefined" ? Module : OpenJPHModule`, { mainScriptUrlOrBlob: d.glue });
  dec = new M.HTJ2KDecoder();
}

/** `avoid` set: a second decode, in a decoder object of its own, there being one HTJ2K decoder. */
export function decodeFrame(bytes, unit, preview, avoid) {
  if (!avoid) return decodeWith(dec, bytes);
  const fresh = new M.HTJ2KDecoder();
  try {
    return decodeWith(fresh, bytes);
  } finally {
    fresh.delete?.();
  }
}

function decodeWith(dec, bytes) {
  // Already a Uint8Array over the transferred buffer; wrapping it again is a copy. docs/decode/README.md §The range pass
  dec.getEncodedBuffer(bytes.length).set(bytes);
  dec.readHeader();
  const info = dec.getFrameInfo();
  dec.decode();
  const out = dec.getDecodedBuffer();
  const wide = info.bitsPerSample > 8;
  // The reused decoder leaves the previous frame's pixels here when a parse fails, so the header
  // is what says the frame is gone, not the length. docs/decode/README.md §A frame that did not decode
  const declared = info.width * info.height * info.componentCount * (wide ? 2 : 1);
  if (declared === 0 || out.length < declared) {
    throw new Error(`undecodable: ${out.length} bytes for a header declaring ${declared}`);
  }

  const sab = new SharedArrayBuffer(out.length);
  new Uint8Array(sab).set(out);
  const view = wide
    ? (info.isSigned ? new Int16Array(sab) : new Uint16Array(sab))
    : (info.isSigned ? new Int8Array(sab) : new Uint8Array(sab));
  // A build that takes the range as it packs has sign-extended already. docs/decode/README.md §The range in the pack
  const range = unranged(info)
    ? { min: 0, max: 255 }
    : dec.getRange ? dec.getRange() : finish(view, info.bitsPerSample, info.isSigned);
  return { info, sab, byteCount: out.length, range, path: "htj2k" };
}
