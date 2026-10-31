/**
 * decoder.js as the product runs it, its messages carrying how many units and flushes reached WebCodecs.
 * decoder.js reads the global at call time, after this module's body.
 */
import "/client/decode/decoder.js";

let units = 0;
let flushes = 0;
if (typeof VideoDecoder === "function") {
  const Native = VideoDecoder;
  self.VideoDecoder = class extends Native {
    decode(chunk) {
      units++;
      return super.decode(chunk);
    }
    flush() {
      flushes++;
      return super.flush();
    }
  };
}
const send = self.postMessage.bind(self);
self.postMessage = (m, transfer) => send({ ...m, units, flushes }, transfer);
