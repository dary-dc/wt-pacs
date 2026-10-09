/**
 * An AV1 payload behind decoder.js's contract: parsed, then decoded through WebCodecs when every stream
 * is ≤ 10 bits and its layout's probe passed, through dav1d-WASM otherwise or when WebCodecs fails.
 * docs/av1/payload-format.md §Decoder choice, per payload
 */
import { layouts, parsePayload, units } from "./av1-payload.js";
import { begin, end } from "./av1-frame.js";

let cfg = null;
let importer = (path) => import(path);
const loaded = {};

/** `d` is the series' decoder config: dav1d's `glue`, `wasm` and `dir`, `groupLength`, and `mixed`: a top over 10 bits to dav1d, its low to WebCodecs (lab/av1/decode/mixed). */
export async function init(d, load) {
  cfg = d;
  if (load) importer = load;
  // Fetched while the session dials, compiled only on first use: lab/page-open/README.md §Cold round trips by codec
  importer("./av1-dav1d.js").catch(() => {});
  if (typeof VideoDecoder === "function") importer("./av1-webcodecs.js").catch(() => {});
  for (const url of [d.glue, d.wasm]) if (url) fetch(url).then((r) => r.arrayBuffer()).catch(() => {});
}

/** Imported and initialised on first use; a failed import is not remembered, so the next payload tries again. */
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
  const wc = await module("./av1-webcodecs.js").catch(() => null);
  if (!wc) return null;
  for (const layout of streams) if (!(await wc.probe(layout))) return null;
  return wc;
}

export async function decodeFrame(bytes, unit = { key: true }, preview, again) {
  const payload = parsePayload(bytes);
  const [top, low] = units(payload.frames[0], payload.split);
  const wc = again !== "av1-webcodecs" && payload.depth <= 10 && (await webcodecs(layouts(payload, top)));
  if (wc) {
    try {
      const [t, l] = await Promise.all([wc.picture(top, unit), low && wc.picture(low, { key: true }, "low")]);
      return { ...end(begin(t, payload), l), path: "av1-webcodecs" };
    } catch (e) {
      if (again) throw e;
      /* dav1d decodes what WebCodecs would not */
    }
  }
  if (again === "av1-dav1d") throw new Error("no other AV1 decoder takes this payload");
  const dav1d = await module("./av1-dav1d.js");
  // A scalable unit's base is lossy and of its own size: shown as it is, never merged with a low unit.
  const base = preview && ((pic) => preview(end(begin(pic, { ...payload, split: 0 }))));
  const lowWc = low && cfg.mixed && payload.depth > 10 && (await webcodecs(["g8"]));
  const pending = lowWc && lowWc.picture(low, { key: true }, "low").catch(() => null);
  let f;
  try {
    f = begin(dav1d.picture(top, unit, base), payload);
  } finally {
    await pending; // in flight, it would be taken as the next payload's low
  }
  return { ...end(f, low && ((await pending) || dav1d.picture(low, { key: true }))), path: "av1-dav1d" };
}
