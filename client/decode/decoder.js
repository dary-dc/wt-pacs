/**
 * One decoder instance. Pixels are written once, into a SharedArrayBuffer, and go straight to the
 * consumer over the port the downloader handed out. docs/ARCHITECTURE.md §The decoders
 */
let codec = null;
let check = null;
let toConsumer = null;
let queue = Promise.resolve();

const abs = () => performance.timeOrigin + performance.now();

/** Both codec modules: `init(config)`, then `decodeFrame(bytes, unit, preview)` → `{ info, sab, byteCount, range }`. */
async function init(m) {
  // Only an AV1 series loads AV1 code; which decoder takes a payload is chosen per payload. docs/av1/payload-format.md
  codec = await import(m.decoder?.codec === "av1" ? "./av1.js" : "./htj2k.js");
  await codec.init({ ...m.decoder, groupLength: m.groupLength });
  check = m.digests ? await checker(m.digests, m.decoder?.hasher) : null;
}

/** The series' digest of each frame, and an XXH3-64 over what a decode hands on. docs/adr/exactness-in-production.md */
async function checker({ algorithm, frames }, hasher) {
  if (algorithm !== "xxh3-64") throw new Error(`frame digests in ${algorithm}, not xxh3-64`);
  if (!hasher) throw new Error("frame digests with no decoder.hasher to check them");
  // hash-wasm's per-algorithm build is UMD: run as a classic script, it leaves `hashwasm` on the global.
  new Function(await (await fetch(hasher)).text()).call(globalThis);
  const h = await globalThis.hashwasm.createXXHash3();
  const digest = (sab) => {
    h.init();
    h.update(new Uint8Array(sab));
    return h.digest("hex");
  };
  return { frames, digest };
}

/** `true` or `false` against the series' digest, `"unchecked"` with none. */
function verify(index, r) {
  const want = check?.frames[index];
  if (!want) return { exact: "unchecked" };
  const got = check.digest(r.sab);
  return { exact: got === want, got, want };
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
    let r = await codec.decodeFrame(m.bytes, m, preview);
    let v = verify(m.index, r);
    if (v.exact === false) [r, v] = await again(m, r, v);
    stamps.decodeEnd = abs();
    toConsumer.postMessage({ ...picture(m, r, stamps), exact: v.exact, exactReason: v.reason, path: r.path });
    // The wire buffer goes back to the transport's ring, where the next frame is read into it.
    postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount: r.byteCount, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  } catch (err) {
    const reason = String(err?.message ?? err);
    postMessage({ kind: "failed", index: m.index, gen: m.gen, reason, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  }
}

/** A mismatch decoded once more on the other path; exact only if that passes. Asking again would bring the same bytes. */
async function again(m, r, v) {
  const first = `${r.path} gave ${v.got}, the series says ${v.want}`;
  try {
    const r2 = await codec.decodeFrame(m.bytes, m, null, r.path);
    const v2 = verify(m.index, r2);
    if (v2.exact === true) return [r2, v2];
    return [r, { ...v, reason: `${first}; ${r2.path} gave ${v2.got}` }];
  } catch (err) {
    return [r, { ...v, reason: `${first}; again: ${String(err?.message ?? err)}` }];
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
