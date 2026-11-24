/** The product's HTJ2K module for the whole frame, beside a frame at a resolution level from the same package. lab/av1/decode/resolution-level/README.md */
import * as product from "/client/decode/htj2k.js";
import { decodeLevel } from "./level.js";

let dec = null;

/** `d.levelPackage`, where the whole frame's build lacks `decodeSubResolution`: the package that decodes the level. */
export async function init(d) {
  await product.init(d);
  const p = d.levelPackage ?? d;
  const src = await (await fetch(p.glue)).text();
  const factory = new Function(`${src}\nreturn typeof Module !== "undefined" ? Module : OpenJPHModule;`).call(globalThis);
  const M = await factory({ locateFile: (f) => p.dir + "/" + f, wasmBinary: await (await fetch(p.wasm)).arrayBuffer() });
  dec = new M.HTJ2KDecoder();
}

export const decodeWhole = product.decodeFrame;

/** As the product's `decodeFrame` leaves a frame: in a SharedArrayBuffer, its range taken. */
export function decodePreview(bytes, level, opts) {
  const { info, out } = decodeLevel(dec, bytes, level, opts);
  const sab = new SharedArrayBuffer(out.length);
  new Uint8Array(sab).set(out);
  const range = product.finish(new Uint16Array(sab), info.bitsPerSample, false);
  const scale = 2 ** level;
  return { info: { ...info, width: Math.ceil(info.width / scale), height: Math.ceil(info.height / scale) }, sab, byteCount: out.length, range };
}
