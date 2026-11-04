/**
 * Top first in the frame, lab only: the product's transport with its envelope reader replaced. Each envelope is read
 * in two reads — head and payload up to the end of its top, then the rest — and delivered twice: the prefix as entry
 * i, the whole payload as entry F + i, where the server holds the shipped bundle's F entries. The downloader is told
 * of 2F entries and dispatches both as it does any frame. docs/av1/top-first.md §4
 *
 * Loaded as the downloader's `transport` with `?frames=F`.
 */
import { TransportSession } from "/client/transport/ts/dist/session.js";

const F = Number(new URL(import.meta.url).searchParams.get("frames"));
if (!(F > 0)) throw new Error("top-first transport: ?frames=F missing");
/** payload-format.md: 16-byte header, one u32le frame length, then the frame's u32le top length. */
const TOP_AT = 24;

const be32 = (b, at = 0) => new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0, false);
const le32 = (b, at = 0) => new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0, true);

/** The server range that carries a run of lab entries: entry j is server frame j mod F. */
function serverRange(from, to) {
  if (to - from + 1 >= F || (from < F && to >= F && to - F < from)) return { from: 0, to: F - 1 };
  return { from: Math.min(from % F, to % F), to: Math.max(from % F, to % F) };
}

class Bytes {
  constructor(reader, onBytes) {
    Object.assign(this, { reader, onBytes, parts: [], length: 0 });
  }

  /** False when the stream ended before `n` bytes were held. */
  async hold(n) {
    while (this.length < n) {
      const { value, done } = await this.reader.read();
      if (done) return false;
      if (value?.length) {
        this.onBytes();
        this.parts.push(value);
        this.length += value.length;
      }
    }
    return true;
  }

  take(out) {
    for (let filled = 0; filled < out.length; ) {
      const head = this.parts[0];
      const need = out.length - filled;
      out.set(head.subarray(0, need), filled);
      filled += Math.min(need, head.length);
      if (head.length <= need) this.parts.shift();
      else this.parts[0] = head.subarray(need);
    }
    this.length -= out.length;
    return out;
  }
}

const proto = TransportSession.prototype;
const armFill = proto.armFill;
let opening = null;

/** connect() arms the opening fill with the server's range; the downloader's own entries are armed instead. */
proto.armFill = function (from, to, onFrame, onError) {
  if (opening) [{ from, to }, opening] = [opening, null];
  return armFill.call(this, from, to, onFrame, onError);
};

proto.fillFrames = function (from, to, onFrame, onError = () => {}) {
  if (to < from) throw new Error("fillFrames: to < from");
  const askMs = armFill.call(this, from, to, onFrame, onError);
  this.sendFod({ op: "stream_frames", ...serverRange(from, to) }).catch(() => {});
  return askMs;
};

proto.pumpFramedStream = async function (stream) {
  const buf = new Bytes(stream.getReader(), () => {
    this.lastByteAt = performance.now();
    this.reads += 1;
  });
  try {
    for (;;) {
      if (!(await buf.hold(8))) break;
      const head = buf.take(new Uint8Array(8));
      const len = be32(head);
      const index = be32(head, 4);
      const out = this.wire.take(len - 4);
      let at = TOP_AT;
      if (!(await buf.hold(at))) return this.failWaiter(index, "truncated in its payload header");
      buf.take(out.subarray(0, at));
      if (out[3]) {
        at += le32(out, 20);
        if (!(await buf.hold(at - TOP_AT))) return this.failWaiter(index, "truncated in its top");
        buf.take(out.subarray(TOP_AT, at));
        // A copy: the whole buffer goes to a decoder once the rest is read into it.
        this.deliver(index, out.slice(0, at), performance.now());
      }
      if (!(await buf.hold(out.length - at))) return this.failWaiter(F + index, `truncated: ${buf.length} of ${out.length - at} bytes`);
      buf.take(out.subarray(at));
      this.deliver(F + index, out, performance.now());
    }
  } catch {
    /* stream ended */
  }
};

export class LabTransportSession {
  static connect(url, hash, options = {}) {
    if (!options.fill) return TransportSession.connect(url, hash, options);
    opening = { from: options.fill.from, to: options.fill.to };
    return TransportSession.connect(url, hash, { ...options, fill: { ...options.fill, ...serverRange(options.fill.from, options.fill.to) } });
  }
}
export { LabTransportSession as TransportSession };
