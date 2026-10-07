/**
 * One AV1 stream's unit through WebCodecs, as a picture av1-frame.js merges, as decode-av1.js: a keyframe
 * decodes alone, any other unit only after its predecessor, here. Only ≤ 10 bits, where it is exact.
 * docs/decode/README.md §AV1
 */
import { codecString, continues, sequence } from "./av1-item.js";
import { PROBES } from "./av1-probe.js";

let groupLength = 1;
const streams = {};
const probed = {};

export async function init(d) {
  groupLength = d.groupLength ?? 1;
}

/** Whether a tiny unit of `layout` comes back with the samples it was coded from, once per worker. */
export function probe(layout) {
  return (probed[layout] ??= (async () => {
    const p = PROBES[layout];
    if (!p) return false;
    try {
      const pic = await stream("probe").picture(Uint8Array.from(atob(p.unit), (c) => c.charCodeAt(0)), { key: true });
      return pic.width === p.width && pic.height === p.height && checksum(pic) === p.fnv;
    } catch {
      return false;
    }
  })());
}

/** The decoder of a stream (`top`, `low`): a split frame's two units decode side by side. */
export const picture = (bytes, unit, which = "top") => stream(which).picture(bytes, unit);

/** FNV-1a over every sample of every plane, row by row: av1-probe.js's `fnv`. */
function checksum({ width, height, planes }) {
  let h = 0x811c9dc5;
  for (const { heap, offset, stride } of planes) {
    for (let y = 0; y < height; y++) {
      for (let s = offset + y * stride, x = 0; x < width; x++, s++) h = Math.imul(h ^ heap[s], 0x01000193) >>> 0;
    }
  }
  return h;
}

/** A unit with no frame and no error would hold its group's decoder forever; past this it is flushed. */
const STALL_MS = 2000;

const stream = (which) => (streams[which] ??= decoder(which === "top" ? groupLength : 1));

/** Flushed at a group's end and before a keyframe while it holds one, never inside it. lab/av1/wclat */
function decoder(length) {
  let vd = null;
  let got = null;
  let wake = null;
  let last = null;
  let failed = null;
  let held = false;
  let stamp = 0;
  let codec = null;
  let seq = null;
  const open = () => {
    // A frame of an earlier unit, flushed late, is not this unit's: only the stamp it was sent with is taken.
    const output = (f) => {
      if (f.timestamp !== stamp || got) return f.close();
      got = f;
      wake?.();
    };
    vd = new VideoDecoder({ output, error: (e) => ((failed = e), wake?.()) });
    codec = null;
    last = null;
    held = false;
  };
  /** From the keyframe's own sequence header; a configure resets the decoder, so only when the string changes. */
  const configure = (bytes) => {
    seq = sequence(bytes);
    if (!seq) throw new Error("keyframe without a sequence header");
    const c = codecString(seq);
    if (c === codec) return;
    vd.configure({ codec: c, hardwareAcceleration: "prefer-software", optimizeForLatency: true });
    codec = c;
  };
  open();
  return {
    async picture(bytes, unit) {
      continues(last, unit);
      last = null;
      let stall = 0;
      try {
        if (unit.key && held) await vd.flush();
        if (unit.key) configure(bytes);
        held = true;
        stamp += 1;
        const out = new Promise((r) => (wake = r));
        // Throws for a keyframe that is not one, and for any other unit after a flush.
        vd.decode(new EncodedVideoChunk({ type: unit.key ? "key" : "delta", timestamp: stamp, data: bytes }));
        await Promise.race([out, new Promise((r) => (stall = setTimeout(r, STALL_MS)))]);
        if (!got && vd.state === "configured") await vd.flush();
        if (vd.state === "closed") throw failed ?? new Error("decoder closed");
        if (!got) throw new Error("no frame");
        const p = await read(got, seq);
        if (length > 1 && (unit.index + 1) % length) {
          last = { gen: unit.gen, index: unit.index };
        } else {
          await vd.flush();
          held = false;
        }
        return p;
      } catch (err) {
        if (vd.state === "closed") open();
        throw new Error(`undecodable: ${err?.message ?? err}`);
      } finally {
        clearTimeout(stall);
        wake = null;
        failed = null;
        got?.close();
        got = null;
      }
    },
  };
}

const FORMATS = { I420: [8, 1], I420P10: [10, 1], I444: [8, 3], I444P10: [10, 3], RGBX: [8, 3], BGRX: [8, 3] };
// The byte of G, B and R in a pixel: Firefox returns an identity stream as RGB, its samples untouched. lab/av1/xengine
const RGB = { RGBX: [1, 2, 0], BGRX: [1, 0, 2] };

/** The frame's planes as a picture, if it is grey 4:0:0 or 4:4:4 identity; `seq` its sequence header's fields. */
async function read(frame, seq) {
  const [bits, components] = FORMATS[frame.format] ?? [];
  if (!bits) throw new Error(`format ${frame.format}`);
  // From the header, as dav1d's path: the frame's colorSpace echoes the codec string, not the stream.
  if (components === 3 && seq.mc !== 0) throw new Error(`4:4:4 with matrix ${seq.mc}`);
  if (RGB[frame.format]) return planar(frame, RGB[frame.format]);
  const buf = new ArrayBuffer(frame.allocationSize());
  const layout = await frame.copyTo(buf);
  const heap = bits > 8 ? new Uint16Array(buf) : new Uint8Array(buf);
  const shift = bits > 8 ? 1 : 0;
  // copyTo's layout is in bytes.
  const planes = layout.map(({ offset, stride }) => ({ heap, offset: offset >> shift, stride: stride >> shift }));
  const { width, height } = frame.visibleRect;
  // 4:0:0 comes back as 4:2:0 with every chroma sample mid-grey; colour 4:2:0 is not lossless.
  if (components === 1 && !neutral(planes.slice(1), (width + 1) >> 1, (height + 1) >> 1, 1 << (bits - 1))) {
    throw new Error("4:2:0 with chroma");
  }
  return { width, height, bits, planes: planes.slice(0, components) };
}

/** An 8-bit RGB frame as the G, B and R planes the stream was coded in. */
async function planar(frame, at) {
  const { width, height } = frame.visibleRect;
  const px = new Uint8Array(frame.allocationSize());
  const [{ offset, stride }] = await frame.copyTo(px);
  const planes = at.map((c) => {
    const heap = new Uint8Array(width * height);
    for (let y = 0, o = 0; y < height; y++) {
      for (let s = offset + y * stride + c, x = 0; x < width; x++, s += 4) heap[o++] = px[s];
    }
    return { heap, offset: 0, stride: width };
  });
  return { width, height, bits: 8, planes };
}

function neutral(planes, width, height, grey) {
  for (const { heap, offset, stride } of planes) {
    for (let y = 0; y < height; y++) {
      for (let s = offset + y * stride, x = 0; x < width; x++, s++) if (heap[s] !== grey) return false;
    }
  }
  return true;
}
