/**
 * decoder.js as it is, with WebCodecs watched, broken or taken away. Every mode but `none` posts each
 * unit's length handed to a VideoDecoder, and each codec string it is configured with, on the BroadcastChannel `?ch=`. `?mode=spy` closes the
 * decoder on a one-byte unit, as a decode error would; `fail` on any unit over 1 500 bytes, which no
 * probe is; `stale` hands over the previous unit's frame before each frame; `none` is a browser without one.
 */
import "/client/downloader/decoder.js";

const q = new URL(import.meta.url).searchParams;
const mode = q.get("mode");
// Before any message can arrive, so before decoder.js looks for VideoDecoder.
if (mode === "none") delete self.VideoDecoder;
else {
  const ch = new BroadcastChannel(q.get("ch"));
  self.VideoDecoder = class extends VideoDecoder {
    constructor({ output, error }) {
      let previous = null;
      const late = (f) => {
        if (previous) output(previous);
        previous = f.clone();
        output(f);
      };
      super({ output: mode === "stale" ? late : output, error });
    }

    configure(config) {
      ch.postMessage(config.codec);
      return super.configure(config);
    }

    decode(chunk) {
      ch.postMessage(chunk.byteLength);
      if (chunk.byteLength === 1 || (mode === "fail" && chunk.byteLength > 1500)) this.close();
      return super.decode(chunk);
    }
  };
}
