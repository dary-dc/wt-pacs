// PIXELWORK's worker: one set, every arm on the same frames, each frame's preview group decoded once through
// WebCodecs. Arms, spans, stamps and checks: README.md here §Lossy pixel work protocol, pre-registered.
import { codecString, sequence } from "../../../../client/decode/av1-payload.js";
import * as htj2k from "../../../../client/decode/htj2k.js";
import { built, instantiate } from "../../../../client/decode/wasm-glue.js";
import { hasher } from "../../../../client/decode/xxh3.js";
import { order } from "../../../order.mjs";
import { exact, shown } from "./add.js";
import { simd } from "./add-simd.js";

const GROUP_WAIT_MS = 2000;
const fetchBytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());
const sha256 = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice())), (b) => b.toString(16).padStart(2, "0")).join("");
const bytesOf = (v) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The residual's OpenJPH, a decoder object of its own: a codestream in, its samples as a view of the heap out. */
async function residualDecoder(bits) {
  const M = await instantiate(await built("openjph"), "OpenJPHModule");
  const make = () => {
    const d = new M.HTJ2KDecoder();
    return (u) => {
      d.getEncodedBuffer(u.length).set(u);
      d.readHeader();
      d.decode();
      const b = d.getDecodedBuffer();
      return bits > 8 ? new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2) : b;
    };
  };
  return { residual: make(), twin: make() };
}

/** Groups of units in; each group's VideoFrames out, open, with the decode's stamps. Void if a group comes short. */
function previewDecoder(first) {
  let frames = [];
  let outAt = [];
  let failure = null;
  const decoder = new VideoDecoder({
    output: (f) => { outAt.push(performance.now()); frames.push(f); },
    error: (e) => (failure = e),
  });
  // The client's configuration: client/decode/av1-webcodecs.js
  decoder.configure({ codec: codecString(sequence(first)), hardwareAcceleration: "prefer-software", optimizeForLatency: true });
  return {
    async decode(group) {
      frames = [];
      outAt = [];
      const inAt = [];
      group.forEach((u, i) => {
        inAt.push(performance.now());
        decoder.decode(new EncodedVideoChunk({ type: i ? "delta" : "key", timestamp: i, data: u }));
      });
      const f0 = performance.now();
      const late = new Promise((r) => setTimeout(() => r("late"), GROUP_WAIT_MS));
      const got = await Promise.race([decoder.flush().then(() => "ok"), late]);
      const f1 = performance.now();
      if (failure) throw failure;
      if (got !== "ok" || frames.length < group.length) {
        for (const f of frames) f.close();
        throw new Error(`void: ${frames.length} of ${group.length} frames within ${GROUP_WAIT_MS} ms`);
      }
      return { frames, stamps: { chunkToOutput: outAt.map((t, i) => t - inAt[i]), flush: f1 - f0, span: f1 - inAt[0] } };
    },
    close: () => decoder.close(),
  };
}

const planeOf = (heap, layout) => ({ heap, offset: layout[0].offset / 2, stride: layout[0].stride / 2 });

/** Y alone, dense, from a copyTo buffer: the preview native dav1d writes for a 4:0:0 stream. */
function denseY(buf, layout, w, h) {
  const out = new Uint8Array(w * h * 2);
  for (let y = 0; y < h; y++) {
    const at = layout[0].offset + y * layout[0].stride;
    out.set(new Uint8Array(buf, at, w * 2), y * w * 2);
  }
  return out;
}

async function setUp(o) {
  const [units, resids, wholes] = await Promise.all([o.units, o.residUrls, o.wholeUrls].map((l) => Promise.all(l.map(fetchBytes))));
  await htj2k.init(await built("openjph"));
  const { residual, twin } = await residualDecoder(o.residBits);
  const kernel = await simd(await (await fetch(o.kernel)).arrayBuffer());
  const hash = await hasher();
  return { units, resids, wholes, residual, twin, kernel, hash, kept: null, reuseCopied: false };
}

/** One arm on one frame: its span, its OpenJPH call where it has one, its output. */
async function arm(name, ctx, o, vf, k, preview) {
  const fShown = { width: o.width, height: o.height, bits: o.bits, signed: o.signed, shift: o.shift, bias: o.offset };
  const fAdd = { ...fShown, shift: 0, bias: o.residOffset + (o.mutate === "offset" ? 1 : 0) };
  const plane = { heap: preview, offset: 0, stride: o.width };
  let codec = null;
  const decodeResidual = () => {
    const c0 = performance.now();
    const r = ctx.residual(ctx.resids[k]);
    codec = performance.now() - c0;
    return r;
  };
  const t0 = performance.now();
  let out;
  let copy = null;
  switch (name) {
    case "L": {
      const buf = new ArrayBuffer(vf.allocationSize());
      const layout = await vf.copyTo(buf);
      out = shown(planeOf(new Uint16Array(buf), layout), fShown);
      copy = { buf, layout };
      break;
    }
    case "LR": {
      ctx.kept ??= new ArrayBuffer(vf.allocationSize());
      if (o.mutate !== "reuse" || !ctx.reuseCopied) ctx.layout = await vf.copyTo(ctx.kept);
      ctx.reuseCopied = true;
      out = shown(planeOf(new Uint16Array(ctx.kept), ctx.layout), fShown);
      break;
    }
    case "LS": {
      const target = ctx.kernel.target(vf.allocationSize());
      const layout = await vf.copyTo(target);
      out = ctx.kernel.shown(planeOf(new Uint16Array(target.buffer, target.byteOffset, target.byteLength / 2), layout), fShown);
      break;
    }
    case "A2":
    case "A1":
    case "A1′":
      out = exact(plane, decodeResidual(), fAdd, name !== "A2");
      break;
    case "AS":
      out = ctx.kernel.exact(plane, decodeResidual(), fAdd);
      break;
    case "H":
      out = htj2k.decodeFrame(ctx.wholes[k]);
      break;
    default:
      throw new Error(`arm ${name}: not run by this harness on this host`);
  }
  const ms = performance.now() - t0;
  if (name === "H") {
    const c0 = performance.now();
    ctx.twin(ctx.wholes[k]);
    codec = performance.now() - c0;
  }
  return { ms, codec, out: new Uint8Array(out.sab), range: out.range, copy };
}

/** Every arm on frame k, in this frame's Williams order, each output digested and checked outside its span. */
async function frame(ctx, o, vf, k, index) {
  const buf = new ArrayBuffer(vf.allocationSize());
  const prepLayout = await vf.copyTo(buf);
  const fShown = { width: o.width, height: o.height, bits: o.bits, signed: o.signed, shift: o.shift, bias: o.offset };
  const prep = shown(planeOf(new Uint16Array(buf), prepLayout), fShown);
  const preview = o.signed ? new Int16Array(prep.sab) : new Uint16Array(prep.sab);
  const results = [];
  let prev = null;
  for (const name of order(o.arms, index)) {
    const r = await arm(name, ctx, o, vf, k, preview);
    const d0 = performance.now();
    const digest = ctx.hash.init().update(r.out).digest();
    const digestMs = performance.now() - d0;
    results.push({ name, prev, ...r, digest, digestMs });
    prev = name;
  }
  const L = results.find((r) => r.name === "L");
  const rows = [];
  for (const r of results) {
    const row = { arm: r.name, frame: k, prev: r.prev, ms: r.ms, digestMs: r.digestMs, codec: r.codec, digest: r.digest,
      range: [r.range.min, r.range.max] };
    if (/^A|^H/.test(r.name)) row.sha = await sha256(r.out);
    if (r.name === "L") {
      row.previewSha = await sha256(denseY(r.copy.buf, r.copy.layout, o.width, o.height));
      row.equalPrep = same(r.out, new Uint8Array(prep.sab));
    }
    if ((r.name === "LR" || r.name === "LS") && L) row.equalL = same(r.out, L.out);
    rows.push(row);
  }
  return rows;
}

async function run(o) {
  const ctx = await setUp(o);
  const decoder = previewDecoder(ctx.units[0]);
  const groups = [];
  const rows = [];
  try {
    const warm = await decoder.decode(ctx.units.slice(0, o.group));
    for (let i = 0; i < warm.frames.length; i++) await frame(ctx, o, warm.frames[i], i, i);
    warm.frames.forEach((f) => f.close());
    for (let g = 0; g < ctx.units.length; g += o.group) {
      const { frames, stamps } = await decoder.decode(ctx.units.slice(g, g + o.group));
      groups.push({ first: g, ...stamps });
      for (let i = 0; i < frames.length; i++) rows.push(...(await frame(ctx, o, frames[i], g + i, o.round * 16 + g + i)));
      frames.forEach((f) => f.close());
    }
  } finally {
    decoder.close();
  }
  return { rows, groups, xxh3Vector: ctx.hash.vector };
}

onmessage = async ({ data: o }) => {
  try {
    postMessage(await run(o));
  } catch (e) {
    postMessage({ error: String(e?.message ?? e) });
  }
};
