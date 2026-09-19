/**
 * A decoder stand-in for D2c: it decodes nothing, it stalls. Each decode holds for `delayMs`
 * so the downloader's queue backs up on purpose — contention forced, not waited for. It tags
 * every frame with the order it started (`decodeSeq`) and the most it ever held at once
 * (`maxInFlight`), which is what the ordering and the two-outstanding-per-decoder bound are read
 * from. docs/proposal-downloader.md §The downloader; client/conformance/dispatch-rig.ts drives it.
 */
let toConsumer = null;
let delayMs = 120;
let inFlight = 0;
let maxInFlight = 0;
let decodeSeq = 0;

const abs = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    if (m.decoder && typeof m.decoder.delayMs === "number") delayMs = m.decoder.delayMs;
    postMessage({ kind: "ready" });
    return;
  }
  if (m.kind !== "decode") return;
  const seq = ++decodeSeq;
  inFlight += 1;
  if (inFlight > maxInFlight) maxInFlight = inFlight;
  const stamps = { ...m.stamps, decodeStart: abs() };
  const bytes = new Uint8Array(m.bytes);
  await sleep(delayMs);
  const sab = new SharedArrayBuffer(bytes.length);
  new Uint8Array(sab).set(bytes);
  stamps.decodeEnd = abs();
  toConsumer.postMessage({
    kind: "frame",
    index: m.index,
    pixels: sab,
    width: 1,
    height: bytes.length,
    bits: 8,
    components: 1,
    signed: false,
    min: 0,
    max: 0,
    byteCount: bytes.length,
    stamps,
    decodeSeq: seq,
    maxInFlight,
  });
  postMessage({ kind: "done", index: m.index, byteCount: bytes.length });
  inFlight -= 1;
};
