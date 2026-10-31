/**
 * The product's decoder modules copied with per-stage stamps and the protocol's lab levers, into a gitignored
 * directory the dev server serves; the product's own files are not touched. README.md here
 *
 *   node lab/av1/decode/breakdown/stamp.mjs OUT [--move STAGE:s|STAGE:e] [--break w1|w2|z]
 *   node lab/av1/decode/breakdown/stamp.mjs --list      the stages, one a line
 */
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = new URL("../../../..", import.meta.url).pathname;
const SRC = path.join(ROOT, "client/decode");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

/**
 * A stage brackets its work: `s`, the work, a spin the attribution check can lengthen, `e`. A stamp moved
 * puts the work and its spin on the other side of it. `name` is a JS expression.
 */
function stage(file, id, name, work, { indent } = {}) {
  const pad = indent ?? work.match(/^ */)[0];
  const body = work.trimStart();
  const s = `${pad}labStamp(${name} + ":s");`;
  const e = `${pad}labStamp(${name} + ":e");`;
  const spin = `${pad}labSpin(${name});`;
  const w = `${pad}${body}`;
  return {
    file, id, find: work,
    plain: [s, w, spin, e].join("\n"),
    "s": [w, spin, s, e].join("\n"),
    "e": [s, e, w, spin].join("\n"),
  };
}

const STAGES = [
  stage("decoder.js", "codec", '"codec"', "    const d = await codec.decodeFrame(m.bytes, m, preview);"),
  stage("decoder.js", "digest", '"digest"', "  const got = hash(r.sab);"),
  stage("av1-dav1d.js", "dav1d.copyin", '"dav1d.copyin"', "  M.HEAPU8.set(bytes, ptr);"),
  stage("av1-dav1d.js", "dav1d.flush", '"dav1d.flush"', "  if (unit.key) M._av1_flush();"),
  stage("av1-dav1d.js", "dav1d.decode", '"dav1d.decode"', "  const r = M._av1_decode(ptr, bytes.length);"),
  stage("av1-dav1d.js", "dav1d.held", '"dav1d.held"', "  const p = held();"),
  stage("av1-frame.js", "place1", '"place1"', [
    "  const sab = new SharedArrayBuffer(pic.width * pic.height * components * (wide ? 2 : 1));",
    "  const out = wide ? (signed ? new Int16Array(sab) : new Uint16Array(sab)) : signed ? new Int8Array(sab) : new Uint8Array(sab);",
    "  const mask = wide ? 0xffff : 0xff;",
    "  const f = { pic, out, sab, components, bits, signed, mask, offset: payload.offset, range: { min: Infinity, max: -Infinity } };",
    "  if (payload.rct) unrct(f, pic);",
    "  else place(f, pic, payload.split, !payload.split);"].join("\n")),
  stage("av1-frame.js", "place2", '"place2"', "    place(f, low, 0, true);"),
  stage("av1-frame.js", "fused", '"fused"', [
    "  const sab = new SharedArrayBuffer(pic.width * pic.height * (payload.bits > 8 ? 2 : 1));",
    "  const out = payload.bits > 8 ? (payload.signed ? new Int16Array(sab) : new Uint16Array(sab)) : payload.signed ? new Int8Array(sab) : new Uint8Array(sab);",
    "  const range = { min: Infinity, max: -Infinity };",
    "  fuse(out, pic, low, payload.split, payload.offset, range);"].join("\n")),
  stage("av1-webcodecs.js", "config", "`${which}.config`", "        if (unit.key) configure(bytes);"),
  stage("av1-webcodecs.js", "copyTo", "`${which}.copyTo`", "  const buf = new ArrayBuffer(frame.allocationSize());\n  const layout = await frame.copyTo(buf);"),
  stage("av1-webcodecs.js", "neutral", "`${which}.neutral`", "  const chroma = components !== 1 || (globalThis.lab.passes && seq.mono) || neutral(planes.slice(1), (width + 1) >> 1, (height + 1) >> 1, 1 << (bits - 1));"),
  stage("av1-webcodecs.js", "flush", "`${which}.flush`", "          if (!(globalThis.lab.noFlush && length === 1)) await vd.flush();"),
  stage("av1.js", "z.inflate", '"z.inflate"', "  const out = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(\"deflate-raw\"))).arrayBuffer());"),
  stage("av1.js", "z.unpack", '"z.unpack"', "  for (let i = 0, j = 0; i < n; j++) { const b = bytes[j]; heap[i++] = b >> 6; heap[i++] = (b >> 4) & 3; heap[i++] = (b >> 2) & 3; heap[i++] = b & 3; }"),
];

/** The decode itself, from the chunk sent to the frame out of the decoder's own threads: two edits, one stage. */
const SENT = "        vd.decode(new EncodedVideoChunk({ type: unit.key ? \"key\" : \"delta\", timestamp: stamp, data: bytes }));";
const OUT = "      got = f;\n      wake?.();";
const RACE = "        await Promise.race([out, new Promise((r) => (stall = setTimeout(r, STALL_MS)))]);";
const DECODE = {
  plain: [[SENT, '        labStamp(`${which}.decode:s`);\n' + SENT], [OUT, "      got = f;\n      labSpin(`${which}.decode`);\n      labStamp(`${which}.decode:e`);\n      wake?.();"]],
  s: [[OUT, "      got = f;\n      labSpin(`${which}.decode`);\n      labStamp(`${which}.decode:e`);\n      wake?.();"], [RACE, RACE + '\n        labStamp(`${which}.decode:s`);']],
  e: [[SENT, '        labStamp(`${which}.decode:s`);\n        labStamp(`${which}.decode:e`);\n' + SENT], [OUT, "      got = f;\n      labSpin(`${which}.decode`);\n      wake?.();"]],
};
const PARSE_S = "  if (avoid && !unit.key) throw new Error(\"a frame inside a group decodes on its group's decoder alone\");";
const PARSE_E = ["      const [t, l] = await Promise.all", "  let f;\n  try {"];
const PARSE = {
  plain: [[PARSE_S, '  labStamp("parse:s");\n' + PARSE_S], [PARSE_E[0], '      labSpin("parse");\n      labStamp("parse:e");\n' + PARSE_E[0]], [PARSE_E[1], '  labSpin("parse");\n  labStamp("parse:e");\n' + PARSE_E[1]]],
  s: [[PARSE_E[0], '      labSpin("parse");\n      labStamp("parse:s");\n      labStamp("parse:e");\n' + PARSE_E[0]], [PARSE_E[1], '  labSpin("parse");\n  labStamp("parse:s");\n  labStamp("parse:e");\n' + PARSE_E[1]]],
  e: [[PARSE_S, '  labStamp("parse:s");\n  labStamp("parse:e");\n' + PARSE_S], [PARSE_E[0], '      labSpin("parse");\n' + PARSE_E[0]], [PARSE_E[1], '  labSpin("parse");\n' + PARSE_E[1]]],
};

/** The scaffolding every copy carries: the stamp list, the lab flags, the levers. Applied before the stages. */
const BASE = [
  ["decoder.js", "const abs = () => performance.timeOrigin + performance.now();", `const abs = () => performance.timeOrigin + performance.now();
let labStamps = null;
globalThis.labStamp = (k) => labStamps?.push([k, abs()]);
globalThis.labSpin = (k) => {
  const ms = globalThis.lab?.spin?.[k];
  for (const t = performance.now(); ms && performance.now() - t < ms; );
};`],
  ["decoder.js", "  digests = m.digests ?? null;", "  globalThis.lab = m.decoder?.lab ?? {};\n  digests = m.digests ?? null;"],
  ["decoder.js", "  const stamps = { ...m.stamps, decodeStart: abs() };", "  const stamps = { ...m.stamps, decodeStart: abs() };\n  labStamps = [];"],
  ["decoder.js", "    const r = await checked(m, await codec.decodeFrame(m.bytes, m, preview));\n    stamps.decodeEnd = abs();",
    "    const d = await codec.decodeFrame(m.bytes, m, preview);\n    const r = await checked(m, d);\n    stamps.decodeEnd = abs();\n    stamps.lab = labStamps;"],
  // W1: a shown keyframe at G = 1 refreshes every reference, so no flush; any other unit is refused.
  ["av1-payload.js", "function sequenceHeader(unit) {", "function sequenceHeader(unit, want = 1) {"],
  ["av1-payload.js", "    if (type === 1) return unit.subarray(p, p + size);", "    if (type === want) return unit.subarray(p, p + size);"],
  ["av1-payload.js", "const two = (n) =>", `/** A frame that is a KEY_FRAME and shown: AV1 §5.9.2's first bits, or reduced_still_picture_header. */
export function shownKey(unit) {
  const seq = sequenceHeader(unit);
  if (seq && (seq[0] >> 3) & 1) return true;
  const fh = sequenceHeader(unit, 6) ?? sequenceHeader(unit, 3);
  return !!fh && fh[0] >> 7 === 0 && ((fh[0] >> 5) & 3) === 0 && ((fh[0] >> 4) & 1) === 1;
}

const two = (n) =>`],
  ["av1-webcodecs.js", 'import { codecString, continues, sequence } from "./av1-payload.js";', 'import { codecString, continues, sequence, shownKey } from "./av1-payload.js";'],
  ["av1-webcodecs.js", 'const stream = (which) => (streams[which] ??= decoder(which === "top" ? groupLength : 1));', 'const stream = (which) => (streams[which] ??= decoder(which === "top" ? groupLength : 1, which));'],
  ["av1-webcodecs.js", "function decoder(length) {", "function decoder(length, which) {"],
  ["av1-webcodecs.js", "        if (unit.key) configure(bytes);", "        if (unit.key) configure(bytes);\n        if (globalThis.lab.noFlush && length === 1 && !shownKey(bytes)) throw new Error(\"not a shown keyframe\");"],
  ["av1-webcodecs.js", "        const p = await read(got, seq);", "        const p = await read(got, seq, which);"],
  ["av1-webcodecs.js", "          await vd.flush();\n          held = false;", "          if (!(globalThis.lab.noFlush && length === 1)) await vd.flush();\n          held = false;"],
  ["av1-webcodecs.js", "async function read(frame, seq) {", "async function read(frame, seq, which) {"],
  // W2: no chroma check on a mono_chrome stream.
  ["av1-webcodecs.js", "  if (components === 1 && !neutral(planes.slice(1), (width + 1) >> 1, (height + 1) >> 1, 1 << (bits - 1))) {",
    "  const chroma = components !== 1 || (globalThis.lab.passes && seq.mono) || neutral(planes.slice(1), (width + 1) >> 1, (height + 1) >> 1, 1 << (bits - 1));\n  if (!chroma) {"],
  // W2: the two place() passes as one, on a grey split frame.
  ["av1-frame.js", "/** The contract's return, the low picture OR-ed in first when the frame is split. */", `/** begin() and end() as one pass over a grey split frame: (top << k | low) − offset, with the range. */
export function fused(pic, low, payload) {
  if (pic.bits !== payload.depth || pic.planes.length !== 1 || !payload.split || payload.rct) refuse("not a grey split frame");
  if (low.bits !== 8 || low.planes.length !== 1 || low.width !== pic.width || low.height !== pic.height) refuse("a low picture unlike its top");
  const sab = new SharedArrayBuffer(pic.width * pic.height * (payload.bits > 8 ? 2 : 1));
  const out = payload.bits > 8 ? (payload.signed ? new Int16Array(sab) : new Uint16Array(sab)) : payload.signed ? new Int8Array(sab) : new Uint8Array(sab);
  const range = { min: Infinity, max: -Infinity };
  fuse(out, pic, low, payload.split, payload.offset, range);
  const info = { width: pic.width, height: pic.height, bitsPerSample: payload.bits, componentCount: 1, isSigned: payload.signed };
  return { info, sab, byteCount: sab.byteLength, range };
}

function fuse(out, pic, low, k, offset, range) {
  const t = pic.planes[0];
  const l = low.planes[0];
  for (let y = 0, o = 0; y < pic.height; y++) {
    for (let x = 0, s = t.offset + y * t.stride, q = l.offset + y * l.stride; x < pic.width; x++, s++, q++, o++) {
      const v = ((t.heap[s] << k) | l.heap[q]) - offset;
      out[o] = v;
      if (v < range.min) range.min = v;
      if (v > range.max) range.max = v;
    }
  }
}

/** The contract's return, the low picture OR-ed in first when the frame is split. */`],
  ["av1.js", 'import { begin, end } from "./av1-frame.js";', `import { begin, end, fused } from "./av1-frame.js";

/** Z: the low stream as its k bits packed MSB first and deflated (lab/av1/bytes/low-stream), k = 2 only. */
async function inflate(bytes) {
  const out = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  return out;
}

function unpacked(bytes, k, width, height) {
  if (k !== 2) throw new Error(\`undecodable: a deflated low of k = \${k}\`);
  const n = width * height;
  const heap = new Uint8Array(n + 3);
  for (let i = 0, j = 0; i < n; j++) { const b = bytes[j]; heap[i++] = b >> 6; heap[i++] = (b >> 4) & 3; heap[i++] = (b >> 2) & 3; heap[i++] = b & 3; }
  return { width, height, bits: 8, planes: [{ heap, offset: 0, stride: width }] };
}`],
  ["av1.js", '      const [t, l] = await Promise.all([wc.picture(top, unit), low && wc.picture(low, { key: true }, "low")]);\n      return { ...end(begin(t, payload), l), path: "av1-webcodecs" };',
    `      const z = globalThis.lab.z && low && inflate(low);
      const [t, l] = await Promise.all([wc.picture(top, unit), z || (low && wc.picture(low, { key: true }, "low"))]);
      const lp = z ? unpacked(l, payload.split, t.width, t.height) : l;
      if (globalThis.lab.passes && lp) return { ...fused(t, lp, payload), path: "av1-webcodecs" };
      return { ...end(begin(t, payload), lp), path: "av1-webcodecs" };`],
  ["av1.js", "  let f;\n  try {", "  const z = globalThis.lab.z && low && inflate(low);\n  let f;\n  try {"],
  ["av1.js", "  return { ...end(f, low && (lowPic || dav1d.picture(low, { key: true }))), path };",
    "  const lowZ = z && unpacked(await z, payload.split, f.pic.width, f.pic.height);\n  return { ...end(f, low && (lowZ || lowPic || dav1d.picture(low, { key: true }))), path };"],
];

/** A lever broken on purpose, for its exactness check to catch. */
const BREAK = {
  w1: ["av1-payload.js", "if (seq && (seq[0] >> 3) & 1) return true;", "if (seq && (seq[0] >> 2) & 1) return true;"],
  w2: ["av1-frame.js", "const v = ((t.heap[s] << k) | l.heap[q]) - offset;", "const v = ((t.heap[s] << (k - 1)) | l.heap[q]) - offset;"],
  z: ["av1.js", "heap[i++] = b >> 6; heap[i++] = (b >> 4) & 3;", "heap[i++] = (b >> 4) & 3; heap[i++] = b >> 6;"],
};

export const stages = () => [...STAGES.map((s) => s.id), "decode", "parse"];

function replaceOnce(text, find, replace, where) {
  const at = text.indexOf(find);
  if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(`${where}: ${at < 0 ? "not found" : "not unique"}: ${find.slice(0, 80)}`);
  return text.slice(0, at) + replace + text.slice(at + find.length);
}

/** Writes the copy into OUT/client/decode; `move` is `STAGE:s` or `STAGE:e`, `broken` a lever. */
export function build(out, { move, broken } = {}) {
  const dst = path.join(out, "client/decode");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  const files = {};
  for (const f of ["decoder.js", "av1.js", "av1-dav1d.js", "av1-frame.js", "av1-payload.js", "av1-probe.js", "av1-webcodecs.js", "htj2k.js", "wasm-glue.js", "xxh3.js"]) {
    files[f] = readFileSync(path.join(SRC, f), "utf8");
  }
  const edit = (f, a, b) => (files[f] = replaceOnce(files[f], a, b, `${f}`));
  for (const [f, a, b] of BASE) edit(f, a, b);
  const [mid, side] = move ? move.split(":") : [];
  for (const s of STAGES) edit(s.file, s.find, s[mid === s.id ? side : "plain"]);
  for (const [a, b] of DECODE[mid === "decode" ? side : "plain"]) edit("av1-webcodecs.js", a, b);
  for (const [a, b] of PARSE[mid === "parse" ? side : "plain"]) edit("av1.js", a, b);
  if (broken) edit(...BREAK[broken]);
  for (const [f, text] of Object.entries(files)) writeFileSync(path.join(dst, f), text);
  symlinkSync(path.join(SRC, "wasm"), path.join(dst, "wasm"));
  writeFileSync(path.join(dst, "dav1d-worker.js"), 'import "/lab/av1/bytes/frame-groups/no-webcodecs.js";\nimport "./decoder.js";\n');
  return dst;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv.includes("--list")) console.log(stages().join("\n"));
  else console.log(build(path.resolve(process.argv[2]), { move: arg("--move"), broken: arg("--break") }));
}
