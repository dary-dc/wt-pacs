/**
 * One item through the client's reader (client/downloader/av1.js), in Node or a browser worker: which
 * decoder gave its pictures, each stream's picture against the stream the writer planned from the
 * source (top = v ≫ k, low = v & (2^k − 1), v after the series' offset), and the merged frame's SHA-256
 * against the source's, and the range the contract reports against the source's. Queue row 43; README.md
 */
import { parseItem } from "../../../client/downloader/av1-item.js";

const AV1 = new URL("../../../client/downloader/av1.js", import.meta.url);
let calls = [];
let planned = null;

/** av1.js with each decoder module wrapped: a picture is checked the moment it is returned, before the next decode reuses it. */
export async function reader(d) {
  const av1 = await import(AV1.href);
  const wrap = (name, m) => ({
    ...m,
    picture(bytes, unit, which) {
      const stream = name === "dav1d" ? (calls.some((c) => c.decoder === "dav1d") ? "low" : "top") : which ?? "top";
      const done = (pic) => (calls.push({ decoder: name, stream, same: planned ? same(pic, planned[stream]) : null }), pic);
      const failed = (e) => {
        calls.push({ decoder: name, stream, error: String(e?.message ?? e) });
        throw e;
      };
      try {
        const p = m.picture(bytes, unit, which);
        return p instanceof Promise ? p.then(done, failed) : done(p);
      } catch (e) {
        failed(e);
      }
    },
  });
  const names = { "./decode-av1.js": "dav1d", "./decode-av1-webcodecs.js": "webcodecs" };
  await av1.init(d, async (path) => wrap(names[path], await import(new URL(path, AV1).href)));
  return av1;
}

/** `raw` the source frame's bytes as stored; `meta` its set's metadata.json. */
export async function verify(av1, bytes, raw, meta, truth, sha256) {
  calls = [];
  let header = null;
  try {
    header = parseItem(bytes);
    planned = header.rct || meta.channels !== 1 ? null : plan(raw, meta, header.split);
    const f = await av1.decodeFrame(bytes);
    const used = calls.filter((c) => !c.error);
    const decoder = used.at(-1)?.decoder ?? "none";
    const streams = used.filter((c) => c.decoder === decoder);
    const range = planned && `${f.range.min}..${f.range.max}` === `${planned.min}..${planned.max}`;
    return {
      decoder, exact: (await sha256(new Uint8Array(f.sab))) === truth && range !== false,
      streamsSame: planned ? streams.length === (header.split ? 2 : 1) && streams.every((c) => c.same) : null,
      fellBack: calls.some((c) => c.error), header: { bits: header.bits, depth: header.depth, split: header.split },
    };
  } catch (e) {
    return { decoder: calls.at(-1)?.decoder ?? "none", exact: false, error: String(e?.message ?? e), header };
  }
}

function plan(raw, meta, split) {
  const n = meta.width * meta.height;
  const view = meta.bitsStored <= 8 ? new (meta.signed ? Int8Array : Uint8Array)(raw.buffer, raw.byteOffset, n)
    : new (meta.signed ? Int16Array : Uint16Array)(raw.buffer.slice(raw.byteOffset, raw.byteOffset + 2 * n));
  const offset = meta.min < 0 ? -meta.min : 0;
  const top = new Uint16Array(n);
  const low = new Uint16Array(n);
  let [min, max] = [Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    [min, max] = [Math.min(min, view[i]), Math.max(max, view[i])];
    const v = view[i] + offset;
    top[i] = v >> split;
    low[i] = v & ((1 << split) - 1);
  }
  return { top, low, min, max, width: meta.width, height: meta.height };
}

function same(pic, values) {
  const { width, height } = planned;
  if (pic.width !== width || pic.height !== height || pic.planes.length !== 1) return false;
  const { heap, offset, stride } = pic.planes[0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (heap[offset + y * stride + x] !== values[y * width + x]) return false;
  }
  return true;
}
