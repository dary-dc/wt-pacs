/**
 * Media-complete WebTransport client (TypeScript).
 * Same wire as transport-wasm: FoD on bidi control, envelope on server uni streams.
 */

import {
  decodeFodBody,
  encodeFodMsg,
  hexToBytes,
  MAX_FRAME_LEN,
  unwrapEnvelope,
  type FodMsg,
} from "./wire.ts";

const FRAME_TIMEOUT_MS = 15_000;

export type FrameResult = {
  frameIndex: number;
  tier: "exact";
  codec: "htj2k";
  bytes: Uint8Array;
  timing: {
    askMs: number;
    firstChunkMs: number;
    lastChunkMs: number;
    chunks: number;
    serveUs: null;
  };
};

type Waiter = {
  resolve: (v: { bytes: Uint8Array; receivedMs: number }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class TransportSession {
  private transport: WebTransport;
  private controlWriter: WritableStreamDefaultWriter<Uint8Array>;
  private waiters = new Map<number, Waiter>();
  private errors = new Map<number, string>();
  private arrived = new Map<number, { bytes: Uint8Array; receivedMs: number }>();
  private bulkHeld = new Set<number>();
  private bulkRange: { from: number; to: number } | null = null;
  private bulkWaited = new Set<number>();
  private droppedEarly = 0;
  private frameErrors = 0;

  private constructor(
    transport: WebTransport,
    controlWriter: WritableStreamDefaultWriter<Uint8Array>,
  ) {
    this.transport = transport;
    this.controlWriter = controlWriter;
  }

  static async connect(
    wtUrl: string,
    certSha256: string,
    transport?: WebTransport,
  ): Promise<TransportSession> {
    const wt =
      transport ??
      new WebTransport(wtUrl, {
        serverCertificateHashes: [{ algorithm: "sha-256", value: hexToBytes(certSha256) }],
        congestionControl: "low-latency",
      });
    const bi = await wt.createBidirectionalStream();
    const controlWriter = bi.writable.getWriter();
    const session = new TransportSession(wt, controlWriter);

    session.pumpUni(wt.incomingUnidirectionalStreams);
    session.pumpControl(bi.readable);

    return session;
  }

  private bulkBusy() {
    return this.bulkHeld.size > 0 || this.bulkRange !== null;
  }

  private expects(frameIndex: number) {
    if (this.bulkHeld.has(frameIndex)) return true;
    const r = this.bulkRange;
    return r !== null && frameIndex >= r.from && frameIndex <= r.to;
  }

  private takeBulk(frameIndex: number): boolean {
    if (this.bulkHeld.delete(frameIndex)) return true;
    const r = this.bulkRange;
    if (r && frameIndex >= r.from && frameIndex <= r.to && !this.bulkWaited.has(frameIndex)) {
      this.bulkWaited.add(frameIndex);
      if (this.bulkWaited.size === r.to - r.from + 1) {
        this.bulkRange = null;
        this.bulkWaited.clear();
      }
      return true;
    }
    return false;
  }

  private armWaiter(frameIndex: number): Promise<{ bytes: Uint8Array; receivedMs: number }> {
    if (this.waiters.has(frameIndex)) {
      return Promise.reject(new Error(`frame ${frameIndex} already requested`));
    }
    const early = this.arrived.get(frameIndex);
    if (early) {
      this.arrived.delete(frameIndex);
      return Promise.resolve(early);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(frameIndex);
        reject(new Error(`timeout waiting for frame ${frameIndex} after ${FRAME_TIMEOUT_MS} ms`));
      }, FRAME_TIMEOUT_MS);
      this.waiters.set(frameIndex, { resolve, reject, timer });
    });
  }

  private completeWaiter(frameIndex: number, bytes: Uint8Array, receivedMs: number) {
    const w = this.waiters.get(frameIndex);
    if (!w) {
      if (this.expects(frameIndex)) this.arrived.set(frameIndex, { bytes, receivedMs });
      else this.droppedEarly += 1;
      return;
    }
    clearTimeout(w.timer);
    this.waiters.delete(frameIndex);
    w.resolve({ bytes, receivedMs });
  }

  private failWaiter(frameIndex: number, reason: string) {
    const w = this.waiters.get(frameIndex);
    this.errors.set(frameIndex, reason);
    this.frameErrors += 1;
    this.arrived.delete(frameIndex);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiters.delete(frameIndex);
    w.reject(new Error(`frame ${frameIndex} unavailable: ${reason}`));
  }

  private async pumpUni(incoming: ReadableStream<ReadableStream<Uint8Array>>) {
    const reader = incoming.getReader();
    try {
      for (;;) {
        const { value: stream, done } = await reader.read();
        if (done || !stream) break;
        // Both stream modes write `[4B BE len][envelope]` per frame. Per-frame mode
        // ends the uni after one frame; shared mode keeps delivering frames on one uni.
        void this.pumpFramedStream(stream);
      }
    } catch {
      /* session closed */
    } finally {
      for (const [, w] of this.waiters) {
        clearTimeout(w.timer);
        w.reject(new Error("session closed"));
      }
      this.waiters.clear();
    }
  }

  /** Read length-prefixed envelopes until the uni stream ends. */
  private async pumpFramedStream(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const buf = new ByteAccumulator();
    try {
      for (;;) {
        const envelope = await readLengthPrefixed(reader, buf);
        if (!envelope) break;
        const receivedMs = performance.now();
        try {
          const { index, codestream } = unwrapEnvelope(envelope);
          this.completeWaiter(index, codestream, receivedMs);
        } catch {
          /* ignore bad envelope */
        }
      }
    } catch {
      /* stream ended */
    }
  }

  private async pumpControl(readable: ReadableStream<Uint8Array>) {
    const reader = readable.getReader();
    const buf = new ByteAccumulator();
    try {
      for (;;) {
        const msg = await readFodFrom(reader, buf);
        if (msg.op === "frame_error") {
          this.failWaiter(msg.frame_index, msg.reason ?? "frame error");
        }
      }
    } catch {
      /* control ended */
    }
  }

  private async sendFod(msg: FodMsg) {
    await this.controlWriter.write(encodeFodMsg(msg));
  }

  async requestExactFrame(frameIndex: number): Promise<FrameResult> {
    const askMs = performance.now();
    const pending = this.armWaiter(frameIndex);
    await this.sendFod({ op: "request_frame", frame: frameIndex });
    return this.settle(frameIndex, askMs, pending);
  }

  startExactFrames(indices: number[]): number {
    if (indices.length === 0) throw new Error("startExactFrames: empty index list");
    if (this.bulkBusy()) throw new Error("startExactFrames: previous bulk still pending");
    const seen = new Set<number>();
    for (const frameIndex of indices) {
      if (seen.has(frameIndex) || this.waiters.has(frameIndex)) {
        throw new Error(`frame ${frameIndex} already requested`);
      }
      seen.add(frameIndex);
    }
    const askMs = performance.now();
    for (const frameIndex of indices) this.bulkHeld.add(frameIndex);
    // docs/CLIENTS.md § Ask before waiters — write is queued before any timer is armed.
    this.sendFod({ op: "request_frames", frames: [...indices] }).catch((e) => {
      for (const frameIndex of indices) this.failWaiter(frameIndex, `control write: ${e}`);
    });
    return askMs;
  }

  async waitExactFrame(frameIndex: number, askMs: number): Promise<FrameResult> {
    if (!this.takeBulk(frameIndex)) {
      throw new Error(`waitExactFrame: no pending bulk waiter for ${frameIndex}`);
    }
    const reason = this.errors.get(frameIndex);
    if (reason) {
      this.errors.delete(frameIndex);
      throw new Error(`frame ${frameIndex} unavailable: ${reason}`);
    }
    return this.settle(frameIndex, askMs, this.armWaiter(frameIndex));
  }

  /** Await one armed waiter; a refusal the server sent for this frame wins over the raw error. */
  private async settle(
    frameIndex: number,
    askMs: number,
    pending: Promise<{ bytes: Uint8Array; receivedMs: number }>,
  ): Promise<FrameResult> {
    try {
      const { bytes, receivedMs } = await pending;
      return toResult(frameIndex, askMs, bytes, receivedMs);
    } catch (e) {
      const reason = this.errors.get(frameIndex);
      this.errors.delete(frameIndex);
      if (reason) throw new Error(`frame ${frameIndex} unavailable: ${reason}`);
      throw e;
    }
  }

  async requestExactFrames(indices: number[]): Promise<FrameResult[]> {
    const askMs = this.startExactFrames(indices);
    const out: FrameResult[] = [];
    for (const i of indices) {
      out.push(await this.waitExactFrame(i, askMs));
    }
    return out;
  }

  /** `{}` on the wire is the whole study. `waitLast` is the last index the caller will wait. */
  startStreamFrames(waitLast: number, range?: { from?: number; to?: number }): number {
    if (this.bulkBusy()) throw new Error("startStreamFrames: previous bulk still pending");
    const from = range?.from ?? 0;
    const last = range?.to ?? waitLast;
    if (last < from) throw new Error("startStreamFrames: to < from");
    const askMs = performance.now();
    this.bulkRange = { from, to: last };
    const msg: FodMsg = { op: "stream_frames" };
    if (range?.from !== undefined) msg.from = range.from;
    if (range?.to !== undefined) msg.to = range.to;
    void this.sendFod(msg);
    return askMs;
  }

  async endStream() {
    await this.sendFod({ op: "end_stream" });
  }

  stats() {
    return {
      inFlight: this.waiters.size,
      droppedEarlyMedia: this.droppedEarly,
      frameErrors: this.frameErrors,
    };
  }

  close() {
    this.droppedEarly += this.arrived.size;
    this.arrived.clear();
    this.bulkHeld.clear();
    this.bulkRange = null;
    this.bulkWaited.clear();
    try {
      this.transport.close();
    } catch {
      /* ignore */
    }
  }
}

function toResult(
  frameIndex: number,
  askMs: number,
  bytes: Uint8Array,
  receivedMs: number,
): FrameResult {
  return {
    frameIndex,
    tier: "exact",
    codec: "htj2k",
    bytes,
    timing: {
      askMs,
      firstChunkMs: receivedMs,
      lastChunkMs: receivedMs,
      chunks: 1,
      serveUs: null,
    },
  };
}

async function readLengthPrefixed(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buf: ByteAccumulator,
): Promise<Uint8Array | null> {
  while (buf.length < 4) {
    const { value, done } = await reader.read();
    if (done) return null;
    if (value) buf.push(value);
  }
  const header = buf.take(4);
  const len = new DataView(header.buffer, header.byteOffset, 4).getUint32(0, false);
  if (len === 0 || len > MAX_FRAME_LEN) {
    throw new Error(`invalid frame length ${len}`);
  }
  while (buf.length < len) {
    const { value, done } = await reader.read();
    if (done) throw new Error("uni stream ended mid-frame");
    if (value) buf.push(value);
  }
  return buf.take(len);
}

class ByteAccumulator {
  private parts: Uint8Array[] = [];
  private len = 0;

  push(chunk: Uint8Array) {
    this.parts.push(chunk);
    this.len += chunk.length;
  }

  get length() {
    return this.len;
  }

  /** Consume `n` bytes from the front. */
  take(n: number): Uint8Array {
    if (n > this.len) throw new Error("take past length");
    const out = new Uint8Array(n);
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
}

async function readFodFrom(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buf: ByteAccumulator,
): Promise<FodMsg> {
  while (buf.length < 4) {
    const { value, done } = await reader.read();
    if (done) throw new Error("control stream ended");
    if (value) buf.push(value);
  }
  const header = buf.take(4);
  const bodyLen = new DataView(header.buffer, header.byteOffset, 4).getUint32(0, true);
  while (buf.length < bodyLen) {
    const { value, done } = await reader.read();
    if (done) throw new Error("control stream ended mid-message");
    if (value) buf.push(value);
  }
  return decodeFodBody(buf.take(bodyLen));
}
