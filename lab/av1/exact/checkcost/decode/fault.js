// Row 145's `sample` fault on demand, and the first AV1 decoder chosen: lab/av1/exact/checkcost/README.md
/** A decode message with `fault` has one byte of its first decode's output flipped; `first: "av1-dav1d"` keeps an AV1 payload's first decode off WebCodecs. */
export const inject = (decode) => async (bytes, unit, preview, avoid) => {
  const r = await decode(bytes, unit, preview, avoid ?? (unit?.first === "av1-dav1d" ? "av1-webcodecs" : undefined));
  if (unit?.fault && avoid == null) new Uint8Array(r.sab)[0] ^= 1;
  return r;
};
