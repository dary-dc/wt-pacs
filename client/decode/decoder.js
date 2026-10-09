/**
 * One decoder instance. Pixels are written once, into a SharedArrayBuffer, and go straight to the
 * consumer over the port the downloader handed out. docs/ARCHITECTURE.md §The decoders
 */
let codec = null;
let toConsumer = null;
let queue = Promise.resolve();
/** The series' XXH3-64 per frame, 16 hex digits, and the hasher; absent, every frame is unchecked. docs/FIXTURES.md §Frame digests */
let digests = null;
let xxh3 = null;

const abs = () => performance.timeOrigin + performance.now();

/** Both codec modules: `init(config)`, then `decodeFrame(bytes, unit, preview, avoid)` → `{ info, sab, byteCount, range, path }`, `avoid` a path not to take. */
async function init(m) {
  // Only an AV1 series loads AV1 code; which decoder takes a payload is chosen per payload. docs/av1/payload-format.md
  codec = await import(m.decoder?.codec === "av1" ? "./av1.js" : "./htj2k.js");
  await codec.init({ ...m.decoder, groupLength: m.groupLength });
  digests = m.digests ?? null;
  if (digests) xxh3 = await hasher();
}

/** hash-wasm's XXH3, fetched by wasm/fetch_xxh3.sh; its UMD sets `hashwasm` on the global. */
async function hasher() {
  const src = await (await fetch(new URL("./wasm/vendor/hash-wasm/xxhash3.umd.min.js", import.meta.url))).text();
  new Function(src).call(globalThis);
  return globalThis.hashwasm.createXXHash3();
}

const hash = (sab) => xxh3.init().update(new Uint8Array(sab)).digest("hex");

/** A mismatch is decoded once more on another path, never asked again: docs/adr/exactness-in-production.md §2 */
async function checked(m, r) {
  const want = digests?.[m.index];
  if (!want) return { ...r, exact: "unchecked" };
  const got = hash(r.sab);
  if (got === want) return { ...r, exact: true };
  const first = `${r.path} gave ${got}, not ${want}`;
  try {
    const again = await codec.decodeFrame(m.bytes, m, null, r.path);
    const second = hash(again.sab);
    if (second === want) return { ...again, exact: true, mismatchOn: r.path };
    return { ...r, exact: false, reason: `${first}; ${again.path} gave ${second}` };
  } catch (err) {
    return { ...r, exact: false, reason: `${first}; no second decode: ${err?.message ?? err}` };
  }
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
    const r = await checked(m, await codec.decodeFrame(m.bytes, m, preview));
    stamps.decodeEnd = abs();
    toConsumer.postMessage(picture(m, r, stamps));
    // The wire buffer goes back to the transport's ring, where the next frame is read into it.
    postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount: r.byteCount, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  } catch (err) {
    const reason = String(err?.message ?? err);
    postMessage({ kind: "failed", index: m.index, gen: m.gen, reason, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  }
}

function picture(m, { info, sab, byteCount, range, path, exact, reason, mismatchOn }, stamps) {
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
    path,
    exact,
    reason,
    mismatchOn,
    wireBytes: m.bytes.length,
    stamps,
  };
}
