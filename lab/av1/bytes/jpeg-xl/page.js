/**
 * One engine's share of JXL, run by the page so any browser that opens a URL can take it. `probe`: each set's
 * first frame through every native path (`<img>`, `createImageBitmap`, `ImageDecoder`, a float16 canvas read),
 * compared sample by sample with the fetched series. `time`: each variant's frames in order — native, or a WASM
 * decoder in the embedded-codec harness's worker — hashed against the series' checksums. run.mjs serves and drives it.
 */
import { order } from "/lab/order.mjs";

const post = (path, body) => fetch(path, { method: "POST", body: JSON.stringify(body) });
const bytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());

async function hex(u8) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", u8));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The fetched frame as coded values, after its bytes matched the checksum written when it was fetched. */
async function source(s, mutate) {
  const raw = await bytes(`/${s.data}/${s.name}/000.raw`);
  if ((await hex(raw)) !== s.truth[0]) throw new Error(`${s.name}: source does not match its checksum`);
  const v = s.stored > 8 ? new Uint16Array(raw.buffer) : raw;
  return Uint32Array.from(v, (x) => x + s.shift + (mutate ? 1 : 0));
}

/**
 * Samples out of a native path against the source: exact, or the largest error in source units once the
 * output's own range is scaled to the source's (8 bits back to B: × (2^B − 1) / 255).
 */
function compare(s, src, out, outMax, stride, unit = (o) => o) {
  const max = 2 ** s.stored - 1;
  let exact = true;
  let err = 0;
  for (let i = 0; i < src.length; i++) {
    const o = unit(out[(i / s.channels | 0) * stride + (i % s.channels)]);
    if (o !== src[i]) exact = false;
    err = Math.max(err, Math.abs(o * max / outMax - src[i]));
  }
  return { exact: exact && outMax === max, maxErr: Math.round(err * 10) / 10 };
}

const canvasOf = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });

function readCanvas(img, s) {
  const ctx = canvasOf(s.width, s.height).getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx;
}

async function viaImg(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

async function probeOne(s, url, mutate) {
  const src = await source(s, mutate);
  const r = { set: s.name, coding: url.split("/").at(-2) };
  // A path that never settles (seen on the 30 MP frame) is reported, not waited on.
  const attempt = async (name, fn) => {
    const late = new Promise((_, reject) => setTimeout(() => reject(new Error("no answer in 60 s")), 60000));
    try { r[name] = await Promise.race([fn(), late]); } catch (e) { r[name] = { error: `${e.name}: ${e.message}` }; }
    post("/jx/log", { line: `${s.name} ${r.coding} ${name}: ${JSON.stringify(r[name])}` });
  };
  await attempt("img", async () => {
    const img = await viaImg(url);
    const d = readCanvas(img, s).getImageData(0, 0, s.width, s.height).data;
    return { size: `${img.naturalWidth}x${img.naturalHeight}`, ...compare(s, src, d, 255, 4) };
  });
  await attempt("bitmap", async () => {
    const bmp = await createImageBitmap(new Blob([await bytes(url)], { type: "image/jxl" }));
    const d = readCanvas(bmp, s).getImageData(0, 0, s.width, s.height).data;
    return compare(s, src, d, 255, 4);
  });
  await attempt("float16", async () => {
    const img = await viaImg(url);
    const d = readCanvas(img, s).getImageData(0, 0, s.width, s.height, { pixelFormat: "rgba-float16" }).data;
    if (!(d.constructor.name === "Float16Array")) return { error: `returned ${d.constructor.name}` };
    const max = 2 ** s.stored - 1;
    return compare(s, src, d, max, 4, (f) => Math.round(f * max));
  });
  await attempt("imageDecoder", async () => {
    if (typeof ImageDecoder !== "function") return { error: "no ImageDecoder" };
    const supported = await ImageDecoder.isTypeSupported("image/jxl");
    if (!supported) return { supported };
    const dec = new ImageDecoder({ data: await bytes(url), type: "image/jxl" });
    const { image } = await dec.decode({ frameIndex: 0 });
    const out = { supported, format: image.format, colorSpace: image.colorSpace?.toJSON() };
    const wide = /P1[026]/.test(image.format ?? "");
    const buf = new Uint8Array(image.allocationSize());
    await image.copyTo(buf);
    if (/^(RGB|BGR)/.test(image.format)) {
      if (image.format.startsWith("BGR")) for (let i = 0; i < buf.length; i += 4) [buf[i], buf[i + 2]] = [buf[i + 2], buf[i]];
      Object.assign(out, compare(s, src, buf, 255, 4));
    } else if (/^I4/.test(image.format) && s.channels === 1) {
      const y = wide ? new Uint16Array(buf.buffer, 0, s.width * s.height) : buf.subarray(0, s.width * s.height);
      Object.assign(out, compare(s, src, y, wide ? 2 ** Number(image.format.match(/P(1\d)/)[1]) - 1 : 255, 1));
    }
    image.close();
    dec.close();
    return out;
  });
  return r;
}

/** Native: each frame to an `ImageBitmap`, drawn and read back — the samples a viewer could window. */
async function nativeVariant(a) {
  const units = await Promise.all(a.urls.map(bytes));
  const ctx = canvasOf(a.width, a.height).getContext("2d", { willReadFrequently: true });
  const decode = async (u) => {
    const bmp = await createImageBitmap(new Blob([u], { type: "image/jxl" }));
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return ctx.getImageData(0, 0, a.width, a.height).data;
  };
  await decode(units[0]);  // warm-up: the first frame, untimed
  const t0 = performance.now();
  const frames = [];
  for (const u of units) frames.push(await decode(u));
  const ms = performance.now() - t0;
  const hashes = [];
  for (const d of frames) {
    // Only an 8-bit frame can come back exact through an 8-bit canvas: its first `channels` of RGBA.
    const out = new Uint8Array(d.length / 4 * a.channels);
    for (let p = 0, o = 0; p < d.length; p += 4) for (let c = 0; c < a.channels; c++) out[o++] = d[p + c];
    hashes.push(await hex(out));
  }
  return { ms, hashes };
}

const wasmVariant = (o) => new Promise((resolve) => {
  const w = new Worker("/lab/av1/bytes/embedded/worker.js", { type: "module" });
  w.onmessage = (e) => { w.terminate(); resolve(e.data); };
  w.onerror = (e) => { w.terminate(); resolve({ error: e.message }); };
  w.postMessage({ base: location.origin, ...o });
});

const cfg = await (await post("/jx/hello", { ua: navigator.userAgent })).json();
try {
  if (cfg.mode === "probe") {
    const probes = [];
    for (const s of cfg.sets) for (const url of s.probe) probes.push(await probeOne(s, url, cfg.mutate));
    await post("/jx/done", { probes });
  } else {
    const rows = [];
    for (const a of order(cfg.variants, cfg.round)) {
      const got = a.o.variant === "native" ? await nativeVariant(a.o).catch((e) => ({ error: String(e) })) : await wasmVariant(a.o);
      const exact = got.hashes ? got.hashes.filter((h, i) => h === a.want[i]).length : 0;
      rows.push({ set: a.set, variant: a.variant, frames: a.want.length, exact, ms: got.ms, error: got.error });
    }
    await post("/jx/done", { rows });
  }
} catch (e) {
  await post("/jx/done", { error: `${e.name}: ${e.message}` });
}
