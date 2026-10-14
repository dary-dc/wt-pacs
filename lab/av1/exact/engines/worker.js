/**
 * decoder.js as the product runs it, its messages carrying how many units reached WebCodecs — which
 * decoder the engine was given. decoder.js reads both globals at call time, after this module's body.
 */
import "/client/decode/decoder.js";

let units = 0;
if (typeof VideoDecoder === "function") {
  const Native = VideoDecoder;
  self.VideoDecoder = class extends Native {
    decode(chunk) {
      units++;
      return super.decode(chunk);
    }
  };
}
const send = self.postMessage.bind(self);
self.postMessage = (m, transfer) => send({ ...m, webcodecsUnits: units }, transfer);
// A variant that says `webcodecs: false` runs the same decoder.js with no VideoDecoder: dav1d-WASM, as the product falls back.
const handle = self.onmessage;
self.onmessage = (e) => {
  if (e.data?.kind === "init" && e.data.decoder?.webcodecs === false) delete self.VideoDecoder;
  return handle(e);
};
