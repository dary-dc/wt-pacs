/** The painter suite's frames and cells, shared by check.mjs (the browser) and native.mjs (wgpu). client/paint/README.md */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");

/** Odd width, not square, RGB, 8 and 16 bits, signed CT; the last two only for timing. */
export const SETS = {
  grey8: { width: 64, height: 64, components: 1, bits: 8, signed: false, maxval: 255, mode: "field" },
  rgb8: { width: 61, height: 40, components: 3, bits: 8, signed: false, maxval: 255, mode: "cine" },
  u16: { width: 80, height: 48, components: 1, bits: 16, signed: false, maxval: 65535, mode: "field" },
  ct12s: { width: 64, height: 64, components: 1, bits: 12, signed: true, maxval: 4095, mode: "ct" },
  ct512: { width: 512, height: 512, components: 1, bits: 12, signed: true, maxval: 4095, mode: "ct", timing: true },
  big16: { width: 4096, height: 3072, components: 1, bits: 16, signed: false, maxval: 65535, mode: "ct", timing: true },
};

const PY = process.env.PYTHON ?? (fs.existsSync(path.join(ROOT, "lab/av1/.venv/bin/python")) ? path.join(ROOT, "lab/av1/.venv/bin/python") : "python3");
export const FRAMES = path.join(HERE, "frames");
/** The canvas every check cell paints, in CSS px. */
export const CSS = { w: 100, h: 72 };

/** The generator's samples, checked against its checksum, then little-endian and level-shifted if signed. */
export function make(name, s) {
  const out = path.join(FRAMES, `${name}.raw`);
  const stats = path.join(FRAMES, `${name}.json`);
  if (fs.existsSync(out) && fs.existsSync(stats)) return JSON.parse(fs.readFileSync(stats, "utf8"));
  fs.mkdirSync(FRAMES, { recursive: true });
  const pnm = path.join(FRAMES, `${name}.${s.components === 1 ? "pgm" : "ppm"}`);
  execFileSync(PY, [path.join(ROOT, "lab/scripts/gen_frame_pnm.py"), pnm, s.width, s.height, s.components, s.maxval, 0, 1, s.mode].map(String));
  const raw = fs.readFileSync(pnm);
  let at = 0;
  for (let lines = 0; lines < 3; at++) if (raw[at] === 0x0a) lines++;
  const body = raw.subarray(at);
  const wide = s.maxval > 255;
  const le = Buffer.alloc(body.length);
  if (wide) for (let i = 0; i < body.length; i += 2) le.writeUInt16LE(body.readUInt16BE(i), i);
  else body.copy(le);
  const want = fs.readFileSync(`${pnm}.sha256`, "utf8").trim();
  if (createHash("sha256").update(le).digest("hex") !== want) throw new Error(`${name}: not the generator's samples`);
  const values = [];
  for (let i = 0; i < le.length; i += wide ? 2 : 1) {
    const v = wide ? le.readUInt16LE(i) : le[i];
    values.push(s.signed ? v - (1 << (s.bits - 1)) : v);
    if (s.signed) le.writeInt16LE(v - (1 << (s.bits - 1)), i);
  }
  fs.writeFileSync(out, le);
  fs.rmSync(pnm);
  fs.rmSync(`${pnm}.sha256`);
  const sorted = values.sort((a, b) => a - b);
  const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
  const st = { p10: q(0.1), p50: q(0.5), p90: q(0.9) };
  fs.writeFileSync(stats, JSON.stringify(st));
  return st;
}

/** Every cell for one set; `exact` cells are 1:1 on whole device pixels and must equal the reference to the code. */
export function cells(name, s, st) {
  const spec = { width: s.width, height: s.height, components: s.components, bits: s.bits, signed: s.signed };
  const rgb = s.components === 3;
  const c = st.p50;
  const w = Math.max(2, st.p90 - st.p10);
  const span = s.signed ? 1 << s.bits : 1 << s.bits;
  const lo = s.signed ? -(1 << (s.bits - 1)) : 0;
  const windows = rgb
    ? { identity: { photometric: "RGB" }, invert: { photometric: "RGB", invert: true } }
    : {
      identity: { voi: { center: lo + span / 2, width: span, function: "LINEAR" } },
      tight: { voi: { center: c, width: w, function: "LINEAR" } },
      half: { voi: { center: c, width: 510, function: "LINEAR_EXACT" } },
      exact: { voi: { center: c, width: w, function: "LINEAR_EXACT" } },
      sigmoid: { voi: { center: c, width: w, function: "SIGMOID" } },
      mono1: { photometric: "MONOCHROME1", voi: { center: c, width: w, function: "LINEAR" } },
      invert: { invert: true, voi: { center: c, width: w, function: "LINEAR" } },
      rescaled: { rescale: { slope: 2, intercept: -1024 }, voi: { center: 2 * c - 1024, width: 2 * w, function: "LINEAR" } },
    };
  const base = rgb ? windows.identity : windows.tight;
  const one = { fit: false, zoom: 1 };
  const views = {
    "1:1": one,
    r90: { ...one, rotate: 90 }, r180: { ...one, rotate: 180 }, r270: { ...one, rotate: 270 },
    flipH: { ...one, flipH: true }, flipV: { ...one, flipV: true }, "r90+flipH": { ...one, rotate: 90, flipH: true },
    pan: { ...one, panX: 3, panY: -2 },
  };
  const fractional = {
    "pan 0.3,0.6": { ...one, panX: 0.3, panY: 0.6 }, fit: { fit: true }, "zoom 2": { fit: false, zoom: 2 },
    "zoom 0.5": { fit: false, zoom: 0.5 }, "zoom 1.37": { fit: false, zoom: 1.37 },
  };
  const out = [];
  for (const [wn, d] of Object.entries(windows)) out.push({ name: `${name} ${wn} 1:1`, set: name, spec, exact: true, display: { ...d, view: one } });
  for (const [vn, v] of Object.entries(views)) if (vn !== "1:1") out.push({ name: `${name} ${vn}`, set: name, spec, exact: true, display: { ...base, view: v } });
  for (const [vn, v] of Object.entries(fractional)) out.push({ name: `${name} ${vn}`, set: name, spec, exact: false, display: { ...base, view: v } });
  return out;
}
