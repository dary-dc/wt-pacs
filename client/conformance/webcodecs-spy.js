/**
 * decoder.js as it is, with WebCodecs watched or taken away: `?mode=spy` counts every unit handed to a
 * VideoDecoder on the BroadcastChannel `?ch=` and closes the decoder on a one-byte unit, as a decode
 * error would; `?mode=none` is a browser without one.
 */
import "/client/downloader/decoder.js";

const q = new URL(import.meta.url).searchParams;
// Before any message can arrive, so before decoder.js looks for VideoDecoder.
if (q.get("mode") === "none") delete self.VideoDecoder;
else {
  const ch = new BroadcastChannel(q.get("ch"));
  self.VideoDecoder = class extends VideoDecoder {
    decode(chunk) {
      ch.postMessage(chunk.byteLength);
      if (chunk.byteLength === 1) this.close();
      return super.decode(chunk);
    }
  };
}
