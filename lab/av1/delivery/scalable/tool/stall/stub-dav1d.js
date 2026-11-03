// client/decode/av1-dav1d.js's picture() up to its decode, which needs the WASM this reproduction does not build.
import { continues } from "/client/decode/av1-payload.js";

let last = null;
export async function init() {}
export function picture(bytes, unit) {
  continues(last, unit);
  last = null;
  throw new Error("undecodable: dav1d-WASM is not built in this reproduction");
}
