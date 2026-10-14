/** client/decode/decoder.js's protocol, as lab/av1/decode/per-frame/drive.js drives it, on P-COPY's codec module. */
import * as codec from "./htj2k-copy.js";

let toConsumer = null;
const abs = () => performance.timeOrigin + performance.now();

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    try {
      await codec.init(m.decoder);
      postMessage({ kind: "ready" });
    } catch (err) {
      postMessage({ kind: "init-failed", reason: String(err?.message ?? err) });
    }
    return;
  }
  const stamps = { decodeStart: abs() };
  try {
    const r = codec.decodeFrame(m.bytes);
    stamps.decodeEnd = abs();
    toConsumer.postMessage({ kind: "frame", index: m.index, pixels: r.sab, byteCount: r.byteCount, stamps });
  } catch (err) {
    postMessage({ kind: "failed", index: m.index, reason: String(err?.message ?? err) });
  }
};
