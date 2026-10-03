// HTJ2K's own preview: the smallest prefix of each served frame that decodes at level 1 (half size)
// and 2 (quarter) exactly as the whole frame does there, and that image's quality against the
// encoder's input, repeated back to full size. Writes prefix.json beside the manifest.
//
//   node lab/av1/preview/prefix.mjs FRAMES DATA      — lab/av1/preview/README.md
import fs from "node:fs";
import path from "node:path";
import { instance, sha256 } from "../../decode-bench/decoder.mjs";

const [dir, data] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const M = (await instance()).module;

function decodeAt(bytes, level) {
  const d = new M.HTJ2KDecoder();
  try {
    d.getEncodedBuffer(bytes.length).set(bytes);
    d.readHeader();
    if (level === 0) d.decode();
    else d.decodeSubResolution(level);
    return d.getDecodedBuffer().slice();
  } catch {
    return null;
  } finally {
    d.delete();
  }
}

const digest = (px) => (px ? sha256(px) : null);

function minimalPrefix(bytes, level, want) {
  let lo = 1;
  let hi = bytes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (digest(decodeAt(bytes.subarray(0, mid), level)) === want) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The small image repeated back to full size, against the stored samples. */
function quality(set, level, px, truthRaw) {
  const { width: w, height: h, channels: ch, bits } = set;
  const wide = bits > 8;
  const small = { w: Math.ceil(w / 2 ** level), h: Math.ceil(h / 2 ** level) };
  if (px.length !== small.w * small.h * ch * (wide ? 2 : 1)) throw new Error(`${set.name}: level ${level} is not ${small.w}×${small.h}`);
  const got = wide ? new Uint16Array(px.buffer, px.byteOffset, px.length / 2) : px;
  const want = wide ? new Uint16Array(truthRaw.buffer, truthRaw.byteOffset, truthRaw.length / 2) : truthRaw;
    let se = 0;
  let maxAbs = 0;
  for (let y = 0; y < h; y++) {
    const sy = y >> level;
    for (let x = 0; x < w; x++) {
      const sx = x >> level;
      for (let c = 0; c < ch; c++) {
        const d = got[(sy * small.w + sx) * ch + c] - want[(y * w + x) * ch + c];
        se += d * d;
        if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
      }
    }
  }
  const peak = (1 << bits) - 1;
  return { psnr: 10 * Math.log10((peak * peak) / (se / (w * h * ch))), maxAbs };
}

const out = [];
for (const set of manifest) {
  const levels = { 1: [], 2: [] };
  for (let i = 0; i < set.frames; i++) {
    const name = String(i).padStart(3, "0");
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, set.name, `${name}.htj2k`)));
    const raw = new Uint8Array(fs.readFileSync(path.join(data, set.name, `${name}.raw`)));
    if (digest(decodeAt(bytes, 0)) !== set.truth[i]) throw new Error(`${set.name} ${i}: HTJ2K not exact`);
    for (const level of [1, 2]) {
      const whole = decodeAt(bytes, level);
      const need = minimalPrefix(bytes, level, digest(whole));
      if (digest(decodeAt(bytes.subarray(0, need - 1), level)) === digest(whole)) {
        throw new Error(`${set.name} ${i} level ${level}: one byte short still decodes the image`);
      }
      levels[level].push({ bytes: need, digest: digest(whole), ...quality(set, level, whole, raw) });
    }
  }
  const row = { name: set.name, levels };
  for (const [level, fr] of Object.entries(levels)) {
    const b = fr.reduce((s, f) => s + f.bytes, 0);
    const all = set.htj2k.reduce((s, v) => s + v, 0);
    console.log(`${set.name} level ${level}: ${b} B (${((100 * b) / all).toFixed(1)} % of HTJ2K), PSNR mean ` +
      `${(fr.reduce((s, f) => s + f.psnr, 0) / fr.length).toFixed(2)} min ${Math.min(...fr.map((f) => f.psnr)).toFixed(2)}, ` +
      `max|Δ| ${Math.max(...fr.map((f) => f.maxAbs))}`);
  }
  out.push(row);
}
fs.writeFileSync(path.join(dir, "prefix.json"), JSON.stringify(out));
