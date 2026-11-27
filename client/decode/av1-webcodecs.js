/**
 * One AV1 stream's unit through WebCodecs, as a picture av1-frame.js merges, as av1-dav1d.js: a keyframe
 * decodes alone, any other unit only after its predecessor, here. Only ≤ 10 bits, where it is exact.
 * docs/decode/README.md §AV1
 */
import { neutral } from "./av1-frame.js";
import { codecString, continues, sequence } from "./av1-payload.js";
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

/** The decoder of a stream (`top`, `low`): a split frame's two units decode side by side. `out()`: the next unit of its group may be sent. */
export const picture = (bytes, unit, which = "top", out) => stream(which).picture(bytes, unit, out);

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

/**
 * Flushed at a group's end and before a keyframe while it holds one, never inside it. Inside a group the next unit is
 * sent once the last one's frame is out, while that frame is read back: one frame in flight, read in order.
 * docs/decode/README.md §WebCodecs without a flush, §The read-back's share
 */
function decoder(length) {
  let vd = null;
  let failed = null;
  let held = false;
  let stamp = 0;
  let codec = null;
  let seq = null;
  let last = null;
  let waiting = null;
  let sendable = Promise.resolve();
  let read = Promise.resolve(true);
  const open = () => {
    // A frame of an earlier unit, flushed late, is not this unit's: only the stamp it was sent with is taken.
    const output = (f) => {
      if (f.timestamp !== waiting?.stamp || waiting.frame) return f.close();
      waiting.frame = f;
      waiting.wake();
    };
    vd = new VideoDecoder({ output, error: (e) => ((failed = e), waiting?.wake()) });
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
  /** The unit to the decoder, and its frame once out. */
  const send = async (bytes, unit) => {
    last = null;
    if (unit.key && held) await vd.flush();
    if (unit.key) configure(bytes);
    held = true;
    const w = (waiting = { stamp: ++stamp, frame: null, wake: null });
    const out = new Promise((r) => (w.wake = r));
    let stall = 0;
    try {
      // Throws for a keyframe that is not one, and for any other unit after a flush.
      vd.decode(new EncodedVideoChunk({ type: unit.key ? "key" : "delta", timestamp: w.stamp, data: bytes }));
      await Promise.race([out, new Promise((r) => (stall = setTimeout(r, STALL_MS)))]);
      if (!w.frame && vd.state === "configured") await vd.flush();
      if (vd.state === "closed") throw failed ?? new Error("decoder closed");
      if (!w.frame) throw new Error("no frame");
      return w.frame;
    } catch (err) {
      w.frame?.close();
      throw err;
    } finally {
      clearTimeout(stall);
      waiting = null;
      failed = null;
    }
  };
  open();
  return {
    picture(bytes, unit, out) {
      const [mayStart, before] = [sendable, read];
      let free;
      sendable = new Promise((r) => (free = r));
      const mid = length > 1 && (unit.index + 1) % length;
      let sent = false;
      const p = (async () => {
        let frame = null;
        try {
          await mayStart;
          // Only a unit inside the group of the one before is sent while that one is still read back.
          if (unit.key) await before;
          continues(last, unit);
          sent = true;
          frame = await send(bytes, unit);
          if (!(await before) && !unit.key) continues(null, unit);
          if (mid) {
            last = { gen: unit.gen, index: unit.index };
            free();
            out?.();
            // The next unit's send is queued behind this frame's read unless the read waits a task for it.
            await new Promise((r) => setTimeout(r, 0));
          }
          const pic = await readFrame(frame, seq);
          if (!mid) {
            await vd.flush();
            held = false;
          }
          return pic;
        } catch (err) {
          if (last && last.gen === unit.gen && last.index === unit.index) last = null;
          if (vd.state === "closed") open();
          const why = err?.message ?? String(err);
          throw new Error(why.startsWith("undecodable:") ? why : `undecodable: ${why}`);
        } finally {
          frame?.close();
          free();
        }
      })();
      // A unit refused before it was sent leaves the decoder as the unit before it left it.
      read = p.then(() => true, () => (sent ? false : before));
      return p;
    },
  };
}

const FORMATS = { I420: [8, 1], I420P10: [10, 1], I444: [8, 3], I444P10: [10, 3], RGBX: [8, 3], BGRX: [8, 3] };
// The byte of G, B and R in a pixel: Firefox returns an identity stream as RGB, its samples untouched. docs/decode/README.md §Why, and what would make it exact
const RGB = { RGBX: [1, 2, 0], BGRX: [1, 0, 2] };

/** The frame's planes as a picture, if it is grey (4:0:0, or 4:2:0 with mid-grey chroma) or 4:4:4 identity; `seq` its sequence header's fields. */
async function readFrame(frame, seq) {
  const [bits, components] = FORMATS[frame.format] ?? [];
  if (!bits) throw new Error(`format ${frame.format}`);
  if (RGB[frame.format] && seq.ss[0]) return grey(frame, seq);
  // From the header, as dav1d's path: the frame's colorSpace echoes the codec string, not the stream.
  if (components === 3 && seq.mc !== 0) throw new Error(`4:4:4 with matrix ${seq.mc}`);
  if (RGB[frame.format]) return planar(frame, RGB[frame.format]);
  const size = frame.allocationSize();
  const buf = new ArrayBuffer(size);
  const layout = await frame.copyTo(buf);
  const shift = bits > 8 ? 1 : 0;
  const heap = new (bits > 8 ? Uint16Array : Uint8Array)(buf, 0, size >> shift);
  // copyTo's layout is in bytes.
  const planes = layout.map(({ offset, stride }) => ({ heap, offset: offset >> shift, stride: stride >> shift }));
  const { width, height } = frame.visibleRect;
  // 4:0:0 comes back as 4:2:0 with every chroma sample mid-grey; colour 4:2:0 is not lossless.
  // mono_chrome: "does not contain U and V color planes" (AV1 §Color config semantics), so its 4:2:0 chroma is the decoder's own.
  if (components === 1 && !seq.mono && !neutral(planes.slice(1), (width + 1) >> 1, (height + 1) >> 1, 1 << (bits - 1))) {
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

/** A grey stream returned as RGB, as Firefox returns 4:2:0: exact only at full range, where R = G = B = Y. */
async function grey(frame, seq) {
  if (!seq.range) throw new Error("grey at limited range returned as RGB");
  const { width, height } = frame.visibleRect;
  const px = new Uint8Array(frame.allocationSize());
  const [{ offset, stride }] = await frame.copyTo(px);
  const heap = new Uint8Array(width * height);
  for (let y = 0, o = 0; y < height; y++) {
    for (let s = offset + y * stride, x = 0; x < width; x++, s += 4) {
      if (px[s] !== px[s + 1] || px[s] !== px[s + 2]) throw new Error("4:2:0 with chroma");
      heap[o++] = px[s];
    }
  }
  return { width, height, bits: 8, planes: [{ heap, offset: 0, stride: width }] };
}
