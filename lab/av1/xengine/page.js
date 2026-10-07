/**
 * One engine variant's probe, run by the page so any browser that opens a URL can take it: every layout
 * through VideoDecoder under each codec string, each frame's planes read back by every copy the engine
 * offers and matched with the encoder input's checksums. run.mjs serves and drives it.
 */
import { codecString, sequence } from "/client/downloader/av1-item.js";

const STRINGS = { derived: null, legacy: "av01.0.04M.10" };
const COPIES = ["own", "RGBX", "BGRX"];
const PLANAR = { I420: [2, 2], I420P10: [2, 2], I422: [2, 1], I422P10: [2, 1], I444: [1, 1], I444P10: [1, 1], NV12: [2, 2] };
const post = (path, body) => fetch(path, { method: "POST", body: JSON.stringify(body) });
const hex = async (b) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b)), (x) => x.toString(16).padStart(2, "0")).join("");

function decodeOne(codec, unit) {
  return new Promise((resolve, reject) => {
    const vd = new VideoDecoder({ output: (f) => resolve(f), error: reject });
    vd.configure({ codec, hardwareAcceleration: "prefer-software", optimizeForLatency: true });
    vd.decode(new EncodedVideoChunk({ type: "key", timestamp: 0, data: unit }));
    vd.flush().then(() => setTimeout(() => reject(new Error("flushed with no frame")), 50), reject);
  });
}

/** Rows of one plane, `bytes` wide, out of a copy laid out as `layout`. */
function rows(buf, layout, height, bytes) {
  const out = new Uint8Array(height * bytes);
  for (let y = 0; y < height; y++) out.set(buf.subarray(layout.offset + y * layout.stride, layout.offset + y * layout.stride + bytes), y * bytes);
  return out;
}

/** The image's planes in the coded order, as the checksums take them, or why this copy cannot give them. */
async function planes(frame, copy, l, mutate) {
  const opts = copy === "own" ? {} : { format: copy };
  const size = frame.allocationSize(opts);
  const buf = new Uint8Array(size);
  const layout = await frame.copyTo(buf, opts);
  if (mutate) buf[layout[0].offset + (l.height >> 1) * layout[0].stride + 1] ^= 1;
  const format = copy === "own" ? frame.format : copy;
  const wide = l.bits > 8;
  if (PLANAR[format]) {
    if (/P10$/.test(format) !== wide) return { why: `${format} for ${l.bits}-bit samples` };
    const bps = wide ? 2 : 1;
    if (l.chroma !== "444") return { planes: [rows(buf, layout[0], l.height, l.width * bps)] };
    if (PLANAR[format][0] !== 1) return { why: `${format} for 4:4:4` };
    return { planes: [0, 1, 2].map((c) => rows(buf, layout[c], l.height, l.width * bps)) };
  }
  if (/^(RGB|BGR)[XA]$/.test(format)) {
    if (wide) return { why: `${format} holds 8 of ${l.bits} bits` };
    const px = rows(buf, layout[0], l.height, l.width * 4);
    const channel = (c) => { const p = new Uint8Array(l.width * l.height); for (let i = 0; i < p.length; i++) p[i] = px[4 * i + c]; return p; };
    const [r, g, b] = format.startsWith("RGB") ? [0, 1, 2] : [2, 1, 0];
    // GBR in coded order; grey is exact only if every channel is the grey.
    return { planes: [channel(g), channel(b), channel(r)] };
  }
  return { why: `format ${format}` };
}

async function probe({ frames: dir, mutate }) {
  const manifest = await (await fetch(`/${dir}/manifest.json`)).json();
  const rows_ = [];
  for (const l of manifest) {
    const units = await Promise.all(l.frames.map((_, i) => fetch(`/${dir}/${l.name}/${String(i).padStart(3, "0")}.obu`)
      .then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b))));
    for (const [sname, fixed] of Object.entries(STRINGS)) {
      const codec = fixed ?? codecString(sequence(units[0]));
      const row = { layout: l.name, string: sname, codec, frames: units.length, copies: {} };
      const config = { codec, hardwareAcceleration: "prefer-software", optimizeForLatency: true };
      row.supported = await VideoDecoder.isConfigSupported(config).then((r) => r.supported, (e) => `throws ${e.name}`);
      for (const copy of COPIES) row.copies[copy] = { exact: 0 };
      for (const [i, unit] of units.entries()) {
        let frame;
        try {
          frame = await decodeOne(codec, unit);
        } catch (e) {
          row.error = `${e.name}: ${e.message}`;
          break;
        }
        Object.assign(row, { format: frame.format, coded: `${frame.codedWidth}x${frame.codedHeight}`,
          colour: `${frame.colorSpace.matrix}/${frame.colorSpace.fullRange}` });
        for (const copy of COPIES) {
          const c = row.copies[copy];
          try {
            const got = await planes(frame, copy, l, mutate);
            if (got.why) { c.why = got.why; continue; }
            const sums = await Promise.all(got.planes.map(hex));
            const truth = l.frames[i].planes;
            const want = got.planes.length > truth.length ? got.planes.map(() => truth[0]) : truth;
            if (sums.every((s, k) => s === want[k])) c.exact++;
            else c.why = `planes ${sums.map((s, k) => (s === want[k] ? "ok" : "differ")).join(",")}`;
          } catch (e) {
            c.why = `${e.name}: ${e.message}`;
          }
        }
        frame.close();
      }
      rows_.push(row);
    }
  }
  return rows_;
}

const setup = await (await post("/xe/hello", { ua: navigator.userAgent, videoDecoder: typeof VideoDecoder === "function" })).json();
try {
  await post("/xe/done", { rows: typeof VideoDecoder === "function" ? await probe(setup) : [] });
} catch (e) {
  await post("/xe/done", { error: String(e?.stack ?? e) });
}
