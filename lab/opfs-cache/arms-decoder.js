// M5's decoder: the product's HTJ2K build and frame check, each exact frame written to OPFS, its samples where the arm says.
// docs/adr/frame-path.md §Who owns a frame's memory, M5 amended
import { instantiate } from "/client/decode/wasm-glue.js";
import { finish } from "/client/decode/htj2k.js";
import { hasher } from "/client/decode/xxh3.js";
import { DECODING, slotsOf } from "./arms-slots.js";

let dec = null;
let xxh3 = null;
let digests = null;
let toView = null;
let dir = null;
let arm = null;
let ring = null;
let queue = Promise.resolve();
const dry = new BroadcastChannel("arms-dry");
const abs = () => performance.timeOrigin + performance.now();

onmessage = ({ data: m }) => {
  if (m.kind === "init") {
    toView = m.toConsumer;
    init(m).then(() => postMessage({ kind: "ready" }), (e) => postMessage({ kind: "init-failed", reason: String(e?.message ?? e) }));
  }
  if (m.kind === "decode") queue = queue.then(() => decode(m));
};

async function init(m) {
  const d = m.decoder;
  const M = await instantiate(d, `typeof Module !== "undefined" ? Module : OpenJPHModule`, { mainScriptUrlOrBlob: d.glue });
  dec = new M.HTJ2KDecoder();
  xxh3 = await hasher();
  digests = m.digests;
  arm = d.arm;
  if (d.ring) ring = { ...slotsOf(d.ring.table), samples: d.ring.samples, slotBytes: d.ring.slotBytes };
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("arms", { create: true });
  dir = await root.getDirectoryHandle(encodeURIComponent(d.key), { create: true });
}

/** A free slot by `compareExchange`; with none, the view is told and the decoder waits for its next free. */
function takeSlot() {
  const t0 = performance.now();
  for (let waits = 0; ; waits++) {
    for (let s = 0; s < ring.count; s++) {
      if (ring.claim(s, DECODING)) return { slot: s, take: ring.taken(s), bytes: new Uint8Array(ring.samples, s * ring.slotBytes, ring.slotBytes), waits, waitedMs: performance.now() - t0 };
    }
    const seen = ring.freedCount();
    dry.postMessage("dry");
    ring.waitFree(seen);
  }
}

const destination = {
  ring: () => takeSlot(),
  transfer: (out) => ({ bytes: new Uint8Array(out.length) }),
  disk: (out) => ({ bytes: out }),
};

async function decode(m) {
  const stamps = { ...m.stamps, decodeStart: abs() };
  let into = null;
  try {
    dec.getEncodedBuffer(m.bytes.length).set(m.bytes);
    dec.readHeader();
    const info = dec.getFrameInfo();
    dec.decode();
    const out = dec.getDecodedBuffer();
    into = destination[arm](out);
    const bytes = into.bytes.subarray(0, out.length);
    if (bytes !== out) bytes.set(out);
    const range = finish(new (info.isSigned ? Int16Array : Uint16Array)(bytes.buffer, bytes.byteOffset, bytes.length / 2), info.bitsPerSample, info.isSigned);
    const exact = xxh3.init().update(bytes).digest("hex") === digests[m.index];
    let stored = false;
    if (exact) {
      const h = await (await dir.getFileHandle(String(m.index), { create: true })).createSyncAccessHandle();
      stored = h.write(bytes, { at: 0 }) === bytes.length;
      h.close();
    }
    stamps.decodeEnd = abs();
    const pixels = into.slot === undefined && arm !== "disk" ? into.bytes.buffer : undefined;
    toView.postMessage({ kind: "frame", index: m.index, gen: m.gen, pixels, slot: into.slot, take: into.take, waits: into.waits, waitedMs: into.waitedMs,
      width: info.width, height: info.height, bits: info.bitsPerSample, signed: info.isSigned, min: range.min, max: range.max,
      byteCount: out.length, path: `htj2k-${arm}`, exact, stored, stamps }, arm === "transfer" ? [bytes.buffer] : []);
    postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount: out.length, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  } catch (err) {
    if (into?.slot !== undefined) ring.free(into.slot);
    postMessage({ kind: "failed", index: m.index, gen: m.gen, reason: String(err?.message ?? err), buffer: m.bytes.buffer }, [m.bytes.buffer]);
  }
}
