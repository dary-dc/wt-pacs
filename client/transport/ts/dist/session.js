// wire.ts
var utf8Encoder = new TextEncoder();
var utf8Decoder = new TextDecoder();
function encodeFodMsg(msg) {
  const body = utf8Encoder.encode(JSON.stringify(msg));
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, true);
  out.set(body, 4);
  return out;
}
function decodeFodBody(body) {
  return JSON.parse(utf8Decoder.decode(body));
}
var MAX_FRAME_LEN = 64 * 1024 * 1024;
function hexToBytes(hex) {
  if (hex.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// frame-session.ts
var FRAME_TIMEOUT_MS = 15e3;
function settleWithin(ready, close, ms) {
  if (!ms) return ready.then(() => {
  });
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(`the dial did not settle in ${ms} ms`), { name: "DialTimeoutError" }));
      close();
    }, ms);
  });
  return Promise.race([ready, late]).then(() => {
  }).finally(() => clearTimeout(timer));
}
function closedReasonOf(info) {
  const code = info?.closeCode ?? 0;
  const why = info?.reason ? `: ${info.reason}` : "";
  return `session closed (code ${code})${why}`;
}
var WireBuffers = class {
  constructor(cap) {
    this.cap = cap;
  }
  free = [];
  take(len) {
    const buf = this.free.pop();
    return new Uint8Array(buf && buf.byteLength >= len ? buf : new ArrayBuffer(len), 0, len);
  }
  release(buffer) {
    if (this.free.length < this.cap) this.free.push(buffer);
  }
};
var FrameSession = class {
  waiters = /* @__PURE__ */ new Map();
  fill = null;
  /** `performance.now()` of the last byte any stream delivered: what a dead path stops moving. */
  lastByteAt = 0;
  reads = 0;
  /** Set once the session is gone; a waiter armed after this would only reach the timeout. */
  closedReason = null;
  wire;
  readMin;
  constructor(options) {
    this.wire = new WireBuffers(options.wireBuffers ?? 0);
    this.readMin = options.readMin ?? 0;
  }
  /** First reason wins: the stream ending and `closed` settling are the same event twice. */
  failAll(reason) {
    this.closedReason ??= reason;
    const fill = this.fill;
    this.fill = null;
    for (const [index, w] of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error(`frame ${index} unavailable: ${this.closedReason}`));
    }
    this.waiters.clear();
    if (fill) for (const index of fill.pending) fill.onError(index, this.closedReason);
  }
  /** Throws, rather than rejecting, so a refused ask never reaches the wire. */
  armWaiter(frameIndex, onHead) {
    if (this.closedReason) throw new Error(`frame ${frameIndex} unavailable: ${this.closedReason}`);
    if (this.waiters.has(frameIndex)) throw new Error(`frame ${frameIndex} already requested`);
    return new Promise((resolve, reject) => {
      const armedAt = performance.now();
      const expire = () => {
        const quiet = performance.now() - Math.max(armedAt, this.lastByteAt);
        if (quiet < FRAME_TIMEOUT_MS) return void (w.timer = setTimeout(expire, FRAME_TIMEOUT_MS - quiet));
        this.waiters.delete(frameIndex);
        const late = new Error(`timeout waiting for frame ${frameIndex}: no byte for ${FRAME_TIMEOUT_MS} ms`);
        reject(Object.assign(late, { name: "FrameTimeoutError" }));
      };
      const w = { resolve, reject, timer: setTimeout(expire, FRAME_TIMEOUT_MS), onHead };
      this.waiters.set(frameIndex, w);
    });
  }
  /** An asked frame settles its waiter; a fill frame goes straight to the fill's callback. */
  deliver(frameIndex, bytes, receivedMs) {
    const fill = this.fill;
    const owed = fill?.pending.delete(frameIndex) ?? false;
    const w = this.takeWaiter(frameIndex);
    if (w) return void w.resolve({ bytes, receivedMs });
    if (fill && owed) {
      fill.onFrame(toResult(frameIndex, fill.askMs, bytes, receivedMs));
    }
  }
  failWaiter(frameIndex, reason) {
    const w = this.takeWaiter(frameIndex);
    const owed = this.fill?.pending.delete(frameIndex) ?? false;
    if (w) w.reject(new Error(`frame ${frameIndex} unavailable: ${reason}`));
    else if (owed) this.fill?.onError(frameIndex, reason);
  }
  takeWaiter(frameIndex) {
    const w = this.waiters.get(frameIndex);
    if (w) {
      clearTimeout(w.timer);
      this.waiters.delete(frameIndex);
    }
    return w;
  }
  onControl(msg) {
    if (msg.op === "frame_error") this.failWaiter(msg.frame_index, msg.reason ?? "frame error");
  }
  newAccumulator() {
    return new ByteAccumulator(() => this.lastByteAt = performance.now());
  }
  /** Read envelopes until the stream ends. docs/CLIENTS.md#a-truncated-frame-is-a-failure */
  async pumpFramedStream(stream) {
    const onRead = () => {
      this.lastByteAt = performance.now();
      this.reads += 1;
    };
    const onHead = (index) => {
      try {
        this.waiters.get(index)?.onHead?.();
      } catch (e) {
        this.failWaiter(index, `onHead threw: ${e?.message ?? e}`);
      }
    };
    let next = null;
    if (this.readMin) {
      const reader = byobReader(stream);
      if (reader) next = () => readEnvelopeInto(reader, this.wire, this.readMin, onRead, onHead);
    }
    if (!next) {
      const reader = stream.getReader();
      const buf = new ByteAccumulator(onRead);
      next = () => readEnvelope(reader, buf, this.wire, onHead);
    }
    try {
      for (; ; ) {
        const env = await next();
        if (!env) break;
        if (env.ok) {
          this.deliver(env.index, env.codestream, performance.now());
          continue;
        }
        if (env.index >= 0) this.failWaiter(env.index, env.lost);
        break;
      }
    } catch {
    }
  }
  /** `onHead` runs once the frame's envelope head is read, before its body. */
  async requestExactFrame(frameIndex, onHead) {
    const askMs = performance.now();
    const pending = this.armWaiter(frameIndex, onHead);
    const armed = this.waiters.get(frameIndex);
    try {
      await this.sendFod({ op: "request_frame", frame: frameIndex });
    } catch (e) {
      pending.catch(() => {
      });
      if (this.waiters.get(frameIndex) === armed) this.takeWaiter(frameIndex);
      throw e;
    }
    const { bytes, receivedMs } = await pending;
    return toResult(frameIndex, askMs, bytes, receivedMs);
  }
  /**
   * A fill pushed as it lands, on the wire as `stream_frames`: no waiter and no timer per frame,
   * so `endStream()` or a later fill simply drops what is still owed. docs/CLIENTS.md#fills-are-pushed
   */
  fillFrames(from, to, onFrame, onError = () => {
  }) {
    if (to < from) throw new Error("fillFrames: to < from");
    if (this.closedReason) throw new Error(`session unavailable: ${this.closedReason}`);
    const askMs = this.armFill(from, to, onFrame, onError);
    this.sendFod({ op: "stream_frames", from, to }).catch(() => {
    });
    return askMs;
  }
  armFill(from, to, onFrame, onError) {
    const askMs = performance.now();
    const pending = /* @__PURE__ */ new Set();
    for (let i = from; i <= to; i++) pending.add(i);
    this.fill = { pending, askMs, onFrame, onError };
    return askMs;
  }
  async endStream() {
    this.fill = null;
    await this.sendFod({ op: "end_stream" });
  }
  stats() {
    return {
      closed: this.closedReason,
      inFlight: this.waiters.size,
      lastByteAt: this.lastByteAt,
      mediaReads: this.reads
    };
  }
  /** A wire buffer the consumer has finished with, back into the ring. */
  releaseWireBuffer(buffer) {
    this.wire.release(buffer);
  }
};
function toResult(frameIndex, askMs, bytes, receivedMs) {
  return { frameIndex, bytes, timing: { askMs, lastChunkMs: receivedMs } };
}
var be32 = (b) => new DataView(b.buffer, b.byteOffset, 4).getUint32(0, false);
var le32 = (b) => new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
async function fillTo(reader, buf, n) {
  while (buf.length < n) {
    const { value, done } = await reader.read();
    if (done) return false;
    if (value) buf.push(value);
  }
  return true;
}
async function readEnvelope(reader, buf, wire, onHead) {
  if (!await fillTo(reader, buf, 4)) return null;
  const len = be32(buf.take(4));
  if (len < 4 || len > MAX_FRAME_LEN) throw new Error(`invalid frame length ${len}`);
  if (!await fillTo(reader, buf, 4)) return { ok: false, index: -1, lost: "truncated before its index" };
  const index = be32(buf.take(4));
  onHead(index);
  if (!await fillTo(reader, buf, len - 4)) return { ok: false, index, lost: `truncated: ${buf.length} of ${len - 4} bytes` };
  return { ok: true, index, codestream: buf.take(len - 4, wire.take(len - 4)) };
}
function byobReader(stream) {
  try {
    return stream.getReader({ mode: "byob" });
  } catch {
    return null;
  }
}
async function readEnvelopeInto(reader, wire, min, onRead, onHead) {
  const head = await readInto(reader, new Uint8Array(8), min, onRead);
  if (head.filled === 0) return null;
  if (head.filled < 4) return { ok: false, index: -1, lost: "truncated before its index" };
  const len = be32(head.bytes);
  if (len < 4 || len > MAX_FRAME_LEN) throw new Error(`invalid frame length ${len}`);
  if (head.filled < 8) return { ok: false, index: -1, lost: "truncated before its index" };
  const index = be32(head.bytes.subarray(4));
  onHead(index);
  const body = await readInto(reader, wire.take(len - 4), min, onRead);
  if (body.filled < len - 4) return { ok: false, index, lost: `truncated: ${body.filled} of ${len - 4} bytes` };
  return { ok: true, index, codestream: body.bytes };
}
async function readInto(reader, view, min, onRead) {
  const { byteOffset, length } = view;
  let buffer = view.buffer;
  let filled = 0;
  while (filled < length) {
    const rest = length - filled;
    const { value, done } = await reader.read(new Uint8Array(buffer, byteOffset + filled, rest), {
      min: Math.min(rest, min)
    });
    if (value) {
      buffer = value.buffer;
      filled += value.byteLength;
      if (value.byteLength) onRead();
    }
    if (done) break;
  }
  return { bytes: new Uint8Array(buffer, byteOffset, length), filled };
}
var ByteAccumulator = class {
  constructor(onBytes) {
    this.onBytes = onBytes;
  }
  parts = [];
  len = 0;
  push(chunk) {
    this.onBytes();
    this.parts.push(chunk);
    this.len += chunk.length;
  }
  get length() {
    return this.len;
  }
  /** Consume `n` bytes from the front, into `out` when the caller owns a buffer for them. */
  take(n, out = new Uint8Array(n)) {
    if (n > this.len) throw new Error("take past length");
    let filled = 0;
    while (filled < n) {
      const head = this.parts[0];
      const need = n - filled;
      if (head.length <= need) {
        out.set(head, filled);
        filled += head.length;
        this.parts.shift();
      } else {
        out.set(head.subarray(0, need), filled);
        this.parts[0] = head.subarray(need);
        filled += need;
      }
    }
    this.len -= n;
    return out;
  }
};
function openingAskUrl(url, fill) {
  return `${url}${url.includes("?") ? "&" : "?"}ask=fill:${fill.from}-${fill.to}`;
}

// session.ts
var TransportSession = class _TransportSession extends FrameSession {
  constructor(transport, controlWriter, options) {
    super(options);
    this.transport = transport;
    this.controlWriter = controlWriter;
  }
  static async connect(wtUrl, certSha256, options = {}) {
    const fill = options.fill;
    const pinned = certSha256 ? { serverCertificateHashes: [{ algorithm: "sha-256", value: hexToBytes(certSha256) }] } : {};
    const transport = new WebTransport(fill ? openingAskUrl(wtUrl, fill) : wtUrl, pinned);
    await settleWithin(transport.ready, () => transport.close(), options.dialMs);
    const bi = await transport.createBidirectionalStream();
    const controlWriter = bi.writable.getWriter();
    const session = new _TransportSession(transport, controlWriter, options);
    if (fill) session.armFill(fill.from, fill.to, fill.onFrame, fill.onError);
    session.watchClosed();
    session.pumpUni(transport.incomingUnidirectionalStreams);
    session.pumpControl(bi.readable);
    return session;
  }
  /** docs/CLIENTS.md#a-closed-session-is-noticed-at-once. */
  watchClosed() {
    this.transport.closed.then(
      (info) => this.failAll(closedReasonOf(info)),
      (err) => this.failAll(`session closed: ${err?.message ?? String(err)}`)
    );
  }
  async pumpUni(incoming) {
    const reader = incoming.getReader();
    try {
      for (; ; ) {
        const { value: stream, done } = await reader.read();
        if (done || !stream) break;
        void this.pumpFramedStream(stream);
      }
    } catch {
    } finally {
      this.failAll("session closed: the media stream ended");
    }
  }
  async pumpControl(readable) {
    const reader = readable.getReader();
    const buf = this.newAccumulator();
    try {
      for (; ; ) this.onControl(await readFodFrom(reader, buf));
    } catch {
    }
  }
  async sendFod(msg) {
    await this.controlWriter.write(encodeFodMsg(msg));
  }
  close() {
    try {
      this.transport.close();
    } catch {
    }
  }
};
async function readFodFrom(reader, buf) {
  if (!await fillTo(reader, buf, 4)) throw new Error("control stream ended");
  const bodyLen = le32(buf.take(4));
  if (!await fillTo(reader, buf, bodyLen)) throw new Error("control stream ended mid-message");
  return decodeFodBody(buf.take(bodyLen));
}
export {
  TransportSession
};
