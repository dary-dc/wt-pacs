// One fault for one frame, read from the decoder worker's query: lab/faultbench/README.md
const q = new URLSearchParams(self.location.search);
const fault = q.get("fault");
const at = Number(q.get("at"));
/** When each flipped decode returns, which the check that follows finds: lab/report-arms times D5's kill from it. */
const found = new BroadcastChannel("faultbench");
// Before av1.js looks for it, so the AV1 arm can be held to dav1d-WASM.
if (q.get("webcodecs") === "off") delete self.VideoDecoder;

/** `decode` as it is, but for frame `at`: a sample flipped on the first decode or on every one, half its bytes, or no answer. */
export const inject = (decode) => async (bytes, unit, preview, avoid) => {
  if (unit?.index !== at) return decode(bytes, unit, preview, avoid);
  if (fault === "hang") return new Promise(() => {});
  if (fault === "truncate") return decode(bytes.subarray(0, bytes.length >> 1), unit, preview, avoid);
  const r = await decode(bytes, unit, preview, avoid);
  if (fault === "sample-always" || (fault === "sample" && avoid == null)) {
    new Uint8Array(r.sab)[0] ^= 1;
    const t = performance.timeOrigin + performance.now();
    found.postMessage({ index: at, at: t });
    // report-arms' D5a-busy: told from this thread, the driver's kill never waits for a busy page thread.
    if (q.get("ping")) fetch("/fault", { method: "POST", body: JSON.stringify({ load: q.get("load"), at: t }) }).catch(() => {});
  }
  return r;
};
