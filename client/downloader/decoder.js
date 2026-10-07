/**
 * One decoder instance. Pixels are written once, into a SharedArrayBuffer, and go straight to the
 * consumer over the port the downloader handed out. docs/ARCHITECTURE.md §The decoders
 */
let codec = null;
let toConsumer = null;
let queue = Promise.resolve();

const abs = () => performance.timeOrigin + performance.now();

/** Both codec modules: `init(config)`, then `decodeFrame(bytes, unit, preview)` → `{ info, sab, byteCount, range }`. */
async function init(m) {
  // Only an AV1 series loads AV1 code; which decoder takes an item is chosen per item. docs/av1/item-format.md
  codec = await import(m.decoder?.codec === "av1" ? "./av1.js" : "./htj2k.js");
  await codec.init({ ...m.decoder, groupLength: m.groupLength });
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    try {
      await init(m);
      postMessage({ kind: "ready" });
    } catch (err) {
      postMessage({ kind: "init-failed", reason: String(err?.message ?? err) });
    }
    return;
  }
  // A decoder that answers later still takes its frames one at a time, in order.
  if (m.kind === "decode") queue = queue.then(() => decode(m));
};

async function decode(m) {
  const stamps = { ...m.stamps, decodeStart: abs() };
  const preview = (r) => toConsumer.postMessage({ ...picture(m, r, { ...stamps, decodeEnd: abs() }), preview: true });
  try {
    const r = await codec.decodeFrame(m.bytes, m, preview);
    stamps.decodeEnd = abs();
    toConsumer.postMessage(picture(m, r, stamps));
    // The wire buffer goes back to the transport's ring, where the next frame is read into it.
    postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount: r.byteCount, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  } catch (err) {
    const reason = String(err?.message ?? err);
    postMessage({ kind: "failed", index: m.index, gen: m.gen, reason, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  }
}

function picture(m, { info, sab, byteCount, range }, stamps) {
  return {
    kind: "frame",
    index: m.index,
    gen: m.gen,
    pixels: sab,
    width: info.width,
    height: info.height,
    bits: info.bitsPerSample,
    components: info.componentCount,
    signed: info.isSigned,
    min: range.min,
    max: range.max,
    byteCount,
    wireBytes: m.bytes.length,
    stamps,
  };
}
