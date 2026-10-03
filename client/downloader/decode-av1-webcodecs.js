/**
 * AV1 through the browser's WebCodecs decoder, behind decoder.js's contract at G = 1. Taken only for a
 * series whose every stream is ≤ 10 bits, the depths it returns exactly. docs/decode/README.md §AV1
 */
import { begin, end, units } from "./av1-frame.js";

let cfg = null;
let top = null;
let low = null;

export async function init(d) {
  cfg = d;
  top = decoder();
  if (d.split) low = decoder();
}

export async function decodeFrame(bytes) {
  if (!cfg.split) return end(begin(await top.picture(bytes), cfg));
  const [a, b] = units(bytes);
  const [t, l] = await Promise.all([top.picture(a), low.picture(b)]);
  return end(begin(t, cfg), l);
}

/** One VideoDecoder, flushed after every unit, so a unit decodes from its own bytes or fails. */
function decoder() {
  let vd = null;
  let got = [];
  const open = () => {
    // An error closes the decoder and rejects the flush, which is where it is seen.
    vd = new VideoDecoder({ output: (f) => got.push(f), error: () => {} });
    // Chromium decodes from the in-band sequence header whatever profile this names.
    vd.configure({ codec: "av01.0.04M.10", hardwareAcceleration: "prefer-software" });
  };
  open();
  return {
    async picture(unit) {
      try {
        // Throws for a unit that is not a keyframe: a frame of a group never decodes here at G = 1.
        vd.decode(new EncodedVideoChunk({ type: "key", timestamp: 0, data: unit }));
        // Every output is out once the flush resolves.
        await vd.flush();
        return await read(got[0]);
      } catch (err) {
        if (vd.state === "closed") open();
        throw new Error(`undecodable: ${err?.message ?? err}`);
      } finally {
        for (const f of got) f.close();
        got = [];
      }
    },
  };
}

const FORMATS = { I420: [8, 1], I420P10: [10, 1], I444: [8, 3], I444P10: [10, 3] };

/** The VideoFrame's planes as a picture, after checking it is grey 4:0:0 or GBR 4:4:4. */
async function read(frame) {
  const [bits, components] = FORMATS[frame.format] ?? [];
  if (!bits) throw new Error(`format ${frame.format}`);
  // 4:4:4 identity (GBR) has no YUV matrix to report; a 4:4:4 stream that names one is YUV.
  if (components === 3 && frame.colorSpace.matrix) throw new Error(`4:4:4 with matrix ${frame.colorSpace.matrix}`);
  const buf = new ArrayBuffer(frame.allocationSize());
  const layout = await frame.copyTo(buf);
  const heap = bits > 8 ? new Uint16Array(buf) : new Uint8Array(buf);
  // copyTo's layout is in bytes.
  const shift = bits > 8 ? 1 : 0;
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
