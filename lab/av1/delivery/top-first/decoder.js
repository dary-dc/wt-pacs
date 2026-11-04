/**
 * The decoder worker of both top-first arms, client/decode/decoder.js's protocol. Entry i < F is slice i's top: the
 * shipped payload's prefix (`tf-frame`, cut by ./transport.js) or a top-only payload (`tf-series`), decoded through
 * the product's av1.js and posted as a preview, top ≪ k. Entry F + i is the slice's exact frame: the whole shipped
 * payload (`tf-frame`), or one rebuilt from the top and a low-only payload (`tf-series`). docs/av1/top-first.md §4
 *
 * `mutate` (lab checks only): preview-or1, preview-shift1, join-next, drop-low, preview-late, preview-unmarked.
 */
import * as payload from "/client/decode/av1.js";

const HEADER = 16;
let cfg = null;
let toConsumer = null;
let queue = Promise.resolve();
/** tf-series: each top-only payload, shared between the decoders since the downloader may give its low to another. */
const tops = new Map();
const topWaiters = new Map();
const shared = new BroadcastChannel("top-first-tops");
/** Mutation preview-late: previews held until their exact frame is posted. */
const exactSeen = new BroadcastChannel("top-first-exact");
const exactSent = new BroadcastChannel("top-first-exact");
const held = new Map();
const seen = new Set();

const abs = () => performance.timeOrigin + performance.now();

function keepTop(i, unit) {
  tops.set(i, unit);
  topWaiters.get(i)?.(unit);
  topWaiters.delete(i);
}
shared.onmessage = (e) => keepTop(e.data.i, e.data.unit);
const topOf = (i) => tops.get(i) ?? new Promise((r) => topWaiters.set(i, r));

exactSeen.onmessage = (e) => {
  seen.add(e.data);
  const post = held.get(e.data);
  if (post) setTimeout(post, 50);
  held.delete(e.data);
};

/** payload-format.md's one-frame payload: `bits`, `depth`, split 0, the header's flags and offset kept. */
function single(header, bits, depth, unit) {
  const out = new Uint8Array(HEADER + 4 + unit.length);
  out.set(header.subarray(0, HEADER));
  Object.assign(out, { 1: bits, 2: depth, 3: 0 });
  const w = new DataView(out.buffer);
  w.setUint32(12, 1, true);
  w.setUint32(HEADER, unit.length, true);
  out.set(unit, HEADER + 4);
  return out;
}

/** The shipped payload, byte for byte, from its top-only and low-only payloads. */
function join(topPayload, lowPayload) {
  const top = topPayload.subarray(HEADER + 4);
  const low = lowPayload.subarray(HEADER + 4);
  const frame = 4 + top.length + low.length;
  const out = new Uint8Array(HEADER + 4 + frame);
  out.set(topPayload.subarray(0, HEADER));
  out[1] += cfg.split;
  out[3] = cfg.split;
  const w = new DataView(out.buffer);
  w.setUint32(HEADER, frame, true);
  w.setUint32(HEADER + 4, top.length, true);
  out.set(top, HEADER + 8);
  out.set(low, HEADER + 8 + top.length);
  return out;
}

/** The top-only picture, top ≪ k, in the exact frame's 16-bit layout. */
function shifted(r) {
  const k = cfg.split - (cfg.mutate === "preview-shift1" ? 1 : 0);
  const or = cfg.mutate === "preview-or1" ? 1 : 0;
  const src = r.info.bitsPerSample > 8 ? new Uint16Array(r.sab) : new Uint8Array(r.sab);
  const sab = new SharedArrayBuffer(src.length * 2);
  const out = new Uint16Array(sab);
  for (let j = 0; j < src.length; j++) out[j] = (src[j] << k) | or;
  return { ...r, sab, byteCount: sab.byteLength, info: { ...r.info, bitsPerSample: r.info.bitsPerSample + cfg.split },
    range: { min: r.range.min << k, max: r.range.max << k } };
}

/** A split payload's top unit: its frame is `[u32le top length][top][low]`, the low absent from a prefix. */
const topUnit = (bytes) => bytes.subarray(HEADER + 8, HEADER + 8 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(HEADER + 4, true));

async function preview(m) {
  let bytes = m.bytes;
  if (cfg.mode === "tf-frame") bytes = single(bytes, bytes[1] - bytes[3], bytes[2], topUnit(bytes));
  else {
    const kept = bytes.slice();
    keepTop(m.index, kept);
    shared.postMessage({ i: m.index, unit: kept });
  }
  return shifted(await payload.decodeFrame(bytes, { key: true }));
}

async function exact(m) {
  const i = m.index - cfg.frames;
  let bytes = m.bytes;
  if (cfg.mode === "tf-series") {
    const at = cfg.mutate === "join-next" && i + 1 < cfg.frames ? i + 1 : i;
    bytes = join(await topOf(at), bytes);
  }
  if (cfg.mutate === "drop-low") return shifted(await payload.decodeFrame(single(bytes, bytes[1] - bytes[3], bytes[2], topUnit(bytes)), { key: true }));
  return payload.decodeFrame(bytes, { key: true });
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    try {
      cfg = m.decoder;
      await payload.init({ ...m.decoder, groupLength: m.groupLength });
      postMessage({ kind: "ready" });
    } catch (err) {
      postMessage({ kind: "init-failed", reason: String(err?.message ?? err) });
    }
    return;
  }
  if (m.kind === "decode") queue = queue.then(() => decode(m));
};

async function decode(m) {
  const stamps = { ...m.stamps, decodeStart: abs() };
  const isPreview = m.index < cfg.frames;
  const wireBytes = m.bytes.length;
  try {
    const r = await (isPreview ? preview(m) : exact(m));
    stamps.decodeEnd = abs();
    const marked = isPreview && cfg.mutate !== "preview-unmarked";
    const post = () => toConsumer.postMessage({
      kind: "frame", index: m.index, gen: m.gen, pixels: r.sab, width: r.info.width, height: r.info.height,
      bits: r.info.bitsPerSample, components: r.info.componentCount, signed: r.info.isSigned, min: r.range.min, max: r.range.max,
      byteCount: r.byteCount, wireBytes, stamps, path: r.path, ...(marked && { preview: true }), ...(marked && { layer: "base" }),
    });
    if (isPreview && cfg.mutate === "preview-late" && !seen.has(m.index)) held.set(m.index, post);
    else if (isPreview && cfg.mutate === "preview-late") setTimeout(post, 50);
    else post();
    if (!isPreview && cfg.mutate === "preview-late") exactSent.postMessage(m.index - cfg.frames);
    postMessage({ kind: "done", index: m.index, gen: m.gen, byteCount: r.byteCount, buffer: m.bytes.buffer }, [m.bytes.buffer]);
  } catch (err) {
    postMessage({ kind: "failed", index: m.index, gen: m.gen, reason: String(err?.message ?? err), buffer: m.bytes.buffer }, [m.bytes.buffer]);
  }
}
