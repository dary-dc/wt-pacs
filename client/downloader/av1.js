/**
 * An AV1 item behind decoder.js's contract: parsed, then decoded through WebCodecs when every stream
 * is ≤ 10 bits and its layout's probe passed, through dav1d-WASM otherwise or when WebCodecs fails.
 * docs/av1/item-format.md §Decoder choice, per item
 */
import { layouts, parseItem, units } from "./av1-item.js";
import { begin, end } from "./av1-frame.js";

let cfg = null;
let importer = (path) => import(path);
const loaded = {};

/** `d` is the series' decoder config: dav1d's `glue`, `wasm` and `dir`, `groupLength`, and `mixed`: a top over 10 bits to dav1d, its low to WebCodecs (lab/av1/mixdec). */
export async function init(d, load) {
  cfg = d;
  if (load) importer = load;
}

/** Imported and initialised on first use; a failed import is not remembered, so the next item tries again. */
function module(path) {
  return (loaded[path] ??= importer(path).then(async (m) => {
    await m.init(cfg);
    return m;
  }).catch((e) => {
    delete loaded[path];
    throw e;
  }));
}

async function webcodecs(streams) {
  if (typeof VideoDecoder !== "function") return null;
  const wc = await module("./decode-av1-webcodecs.js").catch(() => null);
  if (!wc) return null;
  for (const layout of streams) if (!(await wc.probe(layout))) return null;
  return wc;
}

export async function decodeFrame(bytes, unit = { key: true }, preview) {
  const item = parseItem(bytes);
  const [top, low] = units(item.frames[0], item.split);
  const wc = item.depth <= 10 && (await webcodecs(layouts(item, top)));
  if (wc) {
    try {
      const [t, l] = await Promise.all([wc.picture(top, unit), low && wc.picture(low, { key: true }, "low")]);
      return end(begin(t, item), l);
    } catch {
      /* dav1d decodes what WebCodecs would not */
    }
  }
  const dav1d = await module("./decode-av1.js");
  // A scalable unit's base is lossy and of its own size: shown as it is, never merged with a low unit.
  const base = preview && ((pic) => preview(end(begin(pic, { ...item, split: 0 }))));
  const lowWc = low && cfg.mixed && item.depth > 10 && (await webcodecs(["g8"]));
  const pending = lowWc && lowWc.picture(low, { key: true }, "low").catch(() => null);
  let f;
  try {
    f = begin(dav1d.picture(top, unit, base), item);
  } finally {
    await pending; // in flight, it would be taken as the next item's low
  }
  return end(f, low && ((await pending) || dav1d.picture(low, { key: true })));
}
