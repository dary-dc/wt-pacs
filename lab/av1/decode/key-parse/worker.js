/**
 * decoder.js as the product runs it, its messages carrying how many units and flushes reached WebCodecs and, for
 * `phases`, when each decode, output, copy and flush happened (ms on the worker's clock, as decoder.js's stamps).
 * decoder.js reads the global at call time, after this module's body.
 */
import "/client/decode/decoder.js";

let units = 0;
let flushes = 0;
const trace = [];
const now = () => performance.timeOrigin + performance.now();
if (typeof VideoDecoder === "function") {
  const Native = VideoDecoder;
  let made = 0;
  self.VideoDecoder = class extends Native {
    constructor(init) {
      const id = made++;
      super({ ...init, output: (f) => (trace.push(["output", id, now()]), init.output(f)) });
      this.id = id;
    }
    decode(chunk) {
      units++;
      trace.push(["decode", this.id, now()]);
      return super.decode(chunk);
    }
    async flush() {
      flushes++;
      const t = now();
      try {
        return await super.flush();
      } finally {
        trace.push(["flush", this.id, t, now()]);
      }
    }
  };
  const copyTo = VideoFrame.prototype.copyTo;
  VideoFrame.prototype.copyTo = async function (...a) {
    const t = now();
    try {
      return await copyTo.apply(this, a);
    } finally {
      trace.push(["copy", -1, t, now()]);
    }
  };
}
const send = self.postMessage.bind(self);
self.postMessage = (m, transfer) => send({ ...m, units, flushes, trace: trace.splice(0) }, transfer);
