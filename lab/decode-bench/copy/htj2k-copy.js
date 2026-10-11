/** P-COPY's codec module: client/decode/htj2k.js on the `copy` build, each frame a view on the shared heap the page keeps. */
import { instantiate } from "/client/decode/wasm-glue.js";
import { unranged } from "/client/decode/htj2k.js";

let M = null;
let dec = null;

export async function init(d) {
  M = await instantiate(d, `typeof Module !== "undefined" ? Module : OpenJPHModule`, { mainScriptUrlOrBlob: d.glue });
  dec = new M.HTJ2KDecoder();
}

export function decodeFrame(bytes) {
  dec.getEncodedBuffer(bytes.length).set(bytes);
  dec.readHeader();
  const info = dec.getFrameInfo();
  dec.decode();
  const byteCount = info.width * info.height * info.componentCount * (info.bitsPerSample > 8 ? 2 : 1);
  if (byteCount === 0) throw new Error("undecodable: a header declaring 0 bytes");
  // Never released here: the frame is the page's for as long as it keeps it.
  const view = new Uint8Array(M.HEAPU8.buffer, dec.takeFrame(), byteCount);
  const range = unranged(info) ? { min: 0, max: 255 } : dec.getRange();
  return { info, sab: view, byteCount, range, path: "htj2k-copy" };
}
