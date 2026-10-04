/**
 * AV1 through WebCodecs behind decoder.js's contract, as decode-av1.js: a keyframe decodes alone, any
 * other frame only after its predecessor, here. Only ≤ 10 bits, where it is exact. docs/decode/README.md §AV1
 */
import { begin, end, units } from "./av1-frame.js";

let cfg = null;
let top = null;
let low = null;

export async function init(d) {
  cfg = d;
  top = decoder(d.groupLength ?? 1);
  if (d.split) low = decoder(1);
}

/** A split series is G = 1, so both its units are keyframes. */
export async function decodeFrame(bytes, unit = { key: true }) {
  if (!cfg.split) return end(begin(await top.picture(bytes, unit), cfg));
  const [a, b] = units(bytes);
  const [t, l] = await Promise.all([top.picture(a, { key: true }), low.picture(b, { key: true })]);
  return end(begin(t, cfg), l);
}

/** A unit with no frame and no error would hold its group's decoder forever; past this it is flushed. */
const STALL_MS = 2000;

/** Flushed at a group's end and before a keyframe while it holds one, never inside it. lab/av1/wclat */
function decoder(groupLength) {
  let vd = null;
  let got = [];
  let wake = null;
  let last = null;
  let failed = null;
  let held = false;
  const open = () => {
    // An error closes the decoder; the unit waiting on it sees that.
    vd = new VideoDecoder({ output: (f) => (got.push(f), wake?.()), error: (e) => ((failed = e), wake?.()) });
    vd.configure({ codec: "av01.0.04M.10", hardwareAcceleration: "prefer-software", optimizeForLatency: true });
    last = null;
    held = false;
  };
  open();
  return {
    async picture(bytes, unit) {
      const follows = last !== null && unit.gen === last.gen && unit.index === last.index + 1;
      if (!unit.key && !follows) throw new Error(`undecodable: frame ${unit.index - 1} was not decoded before it here`);
      last = null;
      let stall = 0;
      try {
        if (unit.key && held) await vd.flush();
        held = true;
        const out = new Promise((r) => (wake = r));
        // Throws for a keyframe that is not one, and for any other frame after a flush.
        vd.decode(new EncodedVideoChunk({ type: unit.key ? "key" : "delta", timestamp: 0, data: bytes }));
        await Promise.race([out, new Promise((r) => (stall = setTimeout(r, STALL_MS)))]);
        if (!got.length && vd.state === "configured") await vd.flush();
        if (vd.state === "closed") throw failed ?? new Error("decoder closed");
        if (!got.length) throw new Error("no frame");
        const p = await read(got[0]);
        if (groupLength > 1 && (unit.index + 1) % groupLength) {
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
        for (const f of got) f.close();
        got = [];
      }
    },
  };
}

const FORMATS = { I420: [8, 1], I420P10: [10, 1], I444: [8, 3], I444P10: [10, 3] };

/** The frame's planes as a picture, if it is grey 4:0:0 or GBR 4:4:4. */
async function read(frame) {
  const [bits, components] = FORMATS[frame.format] ?? [];
  if (!bits) throw new Error(`format ${frame.format}`);
  // 4:4:4 identity (GBR) has no YUV matrix to report; a 4:4:4 stream that names one is YUV.
  if (components === 3 && frame.colorSpace.matrix) throw new Error(`4:4:4 with matrix ${frame.colorSpace.matrix}`);
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

function neutral(planes, width, height, grey) {
  for (const { heap, offset, stride } of planes) {
    for (let y = 0; y < height; y++) {
      for (let s = offset + y * stride, x = 0; x < width; x++, s++) if (heap[s] !== grey) return false;
    }
  }
  return true;
}
