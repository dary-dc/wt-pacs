/**
 * decoder.js as it is, every VideoDecoder call and callback in this worker posted on the BroadcastChannel `?ch=`:
 * the downloader's decode message (index, decoder id), and per VideoDecoder instance each configure, chunk
 * (timestamp, type, decodeQueueSize), output (timestamp), error, flush, reset and close. docs/reviews/page-runs.md §3a
 */
import "/client/decode/decoder.js";

const q = new URL(import.meta.url).searchParams;
const ch = new BroadcastChannel(q.get("ch"));
const dropInstance = q.get("drop") === "instance";
const worker = Math.random().toString(36).slice(2, 10);
let made = 0;
const tag = (id) => (dropInstance ? undefined : `${worker}.${id}`);
const post = (ev) => ch.postMessage({ worker, t: performance.timeOrigin + performance.now(), ...ev });
/** FNV-1a of a unit's bytes: a chunk is matched to the frame whose payload carried it. */
const fnv = (b) => b.reduce((h, x) => Math.imul(h ^ x, 0x01000193) >>> 0, 0x811c9dc5);
/** An unsplit payload's unit follows its 20-byte header (dispatch-rig.ts `asPayload`). */
const UNIT_AT = 20;

// Ahead of decoder.js's own handler, which transfers the bytes away.
const handle = self.onmessage;
self.onmessage = (e) => {
  const m = e.data;
  if (m?.kind === "decode") post({ ev: "submit", index: m.index, decoder: m.stamps?.decoder, key: m.key, unit: fnv(m.bytes.subarray(UNIT_AT)) });
  return handle(e);
};

const reply = self.postMessage.bind(self);
self.postMessage = (m, transfer) => {
  if (m?.kind === "done" || m?.kind === "failed") post({ ev: m.kind, index: m.index, reason: m.reason });
  return reply(m, transfer);
};

self.VideoDecoder = class extends VideoDecoder {
  #id;

  constructor({ output, error }) {
    const id = ++made;
    super({
      output: (f) => (post({ ev: "output", instance: tag(id), timestamp: f.timestamp, format: f.format }), output(f)),
      error: (e) => (post({ ev: "error", instance: tag(id), message: String(e?.message ?? e) }), error(e)),
    });
    this.#id = id;
    post({ ev: "create", instance: tag(id) });
  }

  configure(config) {
    post({ ev: "configure", instance: tag(this.#id), codec: config.codec });
    return super.configure(config);
  }

  decode(chunk) {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const at = { instance: tag(this.#id), timestamp: chunk.timestamp, type: chunk.type, unit: fnv(data), queue: this.decodeQueueSize };
    try {
      super.decode(chunk);
      post({ ev: "decode", ...at });
    } catch (e) {
      post({ ev: "decode", ...at, threw: String(e?.message ?? e) });
      throw e;
    }
  }

  flush() {
    post({ ev: "flush", instance: tag(this.#id) });
    return super.flush().then(
      () => post({ ev: "flushed", instance: tag(this.#id) }),
      (e) => (post({ ev: "flushed", instance: tag(this.#id), threw: String(e?.message ?? e) }), Promise.reject(e)),
    );
  }

  reset() {
    post({ ev: "reset", instance: tag(this.#id) });
    return super.reset();
  }

  close() {
    post({ ev: "close", instance: tag(this.#id) });
    return super.close();
  }
};
