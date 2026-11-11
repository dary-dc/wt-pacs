/**
 * An AV1 payload behind decoder.js's contract: parsed, then decoded through WebCodecs first, through dav1d-WASM
 * once WebCodecs refuses it or fails; an exact series over 10 bits goes to dav1d alone.
 * docs/av1/payload-format.md §Decoder choice, per payload
 */
import { layouts, parsePayload, units } from "./av1-payload.js";
import { begin, end, merge } from "./av1-frame.js";

let cfg = null;
let importer = (path) => import(path);
const loaded = {};

/** `d` is the series' decoder config: dav1d's `glue`, `wasm` and `dir`, `groupLength`, `lossy` for an optimal-quality series, `mixed`: a top over 10 bits to dav1d, its low to WebCodecs (lab/av1/decode/mixed), `onePass`, on unless `false`: a WebCodecs split frame merged in one pass and a `mono_chrome` stream's chroma not checked (docs/decode/README.md §JS passes protocol, pre-registered), and `reuseCopyBuffer`: each WebCodecs stream copies every frame into one buffer (§Merge-free protocol, pre-registered). */
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

/** Why WebCodecs failed an optimal-quality series' first frame over 10 bits, where no probe is made: dav1d's from then on, per worker. */
let refusedDeep = null;

/** `{ wc }`, the WebCodecs module once every layout's probe passed, or `{ refusal }`, why not. */
async function webcodecs(streams) {
  if (typeof VideoDecoder !== "function") return { refusal: "no VideoDecoder" };
  const wc = await module("./av1-webcodecs.js").catch(() => null);
  if (!wc) return { refusal: "av1-webcodecs.js did not load" };
  for (const layout of streams) if (!(await wc.probe(layout))) return { refusal: `its ${layout} probe failed` };
  return { wc };
}

function route(payload, top, avoid) {
  if (avoid === "av1-webcodecs") return {};
  if (payload.depth <= 10) return webcodecs(layouts(payload, top));
  if (!cfg.lossy) return {};
  return refusedDeep ? { refusal: refusedDeep } : webcodecs([]);
}

export async function decodeFrame(bytes, unit = { key: true }, preview, avoid) {
  if (avoid && !unit.key) throw new Error("a frame inside a group decodes on its group's decoder alone");
  const payload = parsePayload(bytes);
  const [top, low] = units(payload.frames[0], payload.split);
  let { wc, refusal } = await route(payload, top, avoid);
  if (wc) {
    try {
      const [t, l] = await Promise.all([wc.picture(top, unit), low && wc.picture(low, { key: true }, "low")]);
      return { ...(cfg.onePass !== false && l ? merge(t, l, payload) : end(begin(t, payload), l)), path: "av1-webcodecs" };
    } catch (e) {
      if (avoid === "av1-dav1d") throw e;
      refusal = e?.message ?? String(e);
      if (payload.depth > 10) refusedDeep = refusal;
    }
  }
  if (avoid === "av1-dav1d") throw new Error(`no WebCodecs decoder for this payload${refusal ? `: ${refusal}` : ""}`);
  const dav1d = await module("./av1-dav1d.js");
  // A scalable unit's base is lossy and of its own size: shown as it is, never merged with a low unit.
  const base = preview && ((pic) => preview(end(begin(pic, { ...payload, split: 0 }))));
  const lowWc = low && cfg.mixed && !avoid && payload.depth > 10 && (await webcodecs(["g8"])).wc;
  const pending = lowWc && lowWc.picture(low, { key: true }, "low").catch(() => null);
  let f;
  try {
    f = begin(dav1d.picture(top, unit, base), payload);
  } finally {
    await pending; // in flight, it would be taken as the next payload's low
  }
  const lowPic = low && (await pending);
  const path = lowPic ? "av1-mixed" : "av1-dav1d";
  return { ...end(f, low && (lowPic || dav1d.picture(low, { key: true }))), path, refusal };
}
