// One fault for one frame, read from the decoder worker's query: lab/faultbench/README.md
const q = new URLSearchParams(self.location.search);
const fault = q.get("fault");
const at = Number(q.get("at"));
// Before av1.js looks for it, so the AV1 arm can be held to dav1d-WASM.
if (q.get("webcodecs") === "off") delete self.VideoDecoder;

/** `decode` as it is, but for frame `at`: a sample flipped on the first decode or on every one, half its bytes, or no answer. */
export const inject = (decode) => async (bytes, unit, preview, avoid) => {
  if (unit?.index !== at) return decode(bytes, unit, preview, avoid);
  if (fault === "hang") return new Promise(() => {});
  if (fault === "truncate") return decode(bytes.subarray(0, bytes.length >> 1), unit, preview, avoid);
  const r = await decode(bytes, unit, preview, avoid);
  if (fault === "sample-always" || (fault === "sample" && avoid == null)) new Uint8Array(r.sab)[0] ^= 1;
  return r;
};
