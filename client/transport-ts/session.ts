/**
 * Media-complete WebTransport client (TypeScript).
 * Same wire as transport-wasm: FoD on bidi control, envelope on server uni streams.
 */

import {
  decodeFodMsg,
  encodeFodMsg,
  hexToBytes,
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
  private bulkPending = new Map<number, Promise<{ bytes: Uint8Array; receivedMs: number }>>();
  private droppedEarly = 0;
  private frameErrors = 0;

  private constructor(
    transport: WebTransport,
    controlWriter: WritableStreamDefaultWriter<Uint8Array>,
  ) {
    this.transport = transport;
    this.controlWriter = controlWriter;
  }

  static async connect(wtUrl: string, certSha256: string): Promise<TransportSession> {
    const hash = hexToBytes(certSha256);
    const transport = new WebTransport(wtUrl, {
      serverCertificateHashes: [{ algorithm: "sha-256", value: hash }],
      congestionControl: "low-latency",
    });
    await transport.ready;

    const bi = await transport.createBidirectionalStream();
    const controlWriter = bi.writable.getWriter();
    const session = new TransportSession(transport, controlWriter);

    session.pumpUni(transport.incomingUnidirectionalStreams);
    session.pumpControl(bi.readable);

    return session;
  }

  private armWaiter(frameIndex: number): Promise<{ bytes: Uint8Array; receivedMs: number }> {
    if (this.waiters.has(frameIndex)) {
      return Promise.reject(new Error(`frame ${frameIndex} already requested`));
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
      this.droppedEarly += 1;
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
        const raw = await readStreamToEnd(stream);
        const receivedMs = performance.now();
        try {
          const { index, codestream } = unwrapEnvelope(raw);
          this.completeWaiter(index, codestream, receivedMs);
        } catch {
          /* ignore bad envelope */
        }
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
    try {
      const { bytes, receivedMs } = await pending;
      return toResult(frameIndex, askMs, bytes, receivedMs);
    } catch (e) {
      const reason = this.errors.get(frameIndex);
      if (reason) throw new Error(`frame ${frameIndex} unavailable: ${reason}`);
      throw e;
    }
  }

  startExactFrames(indices: number[]): number {
    if (indices.length === 0) throw new Error("startExactFrames: empty index list");
    if (this.bulkPending.size > 0) throw new Error("startExactFrames: previous bulk still pending");
    const askMs = performance.now();
    for (const frameIndex of indices) {
      this.bulkPending.set(frameIndex, this.armWaiter(frameIndex));
    }
    void this.sendFod({ op: "request_frames", frames: [...indices] });
    return askMs;
  }

  async waitExactFrame(frameIndex: number, askMs: number): Promise<FrameResult> {
    const pending = this.bulkPending.get(frameIndex);
    this.bulkPending.delete(frameIndex);
    if (!pending) {
      throw new Error(`waitExactFrame: no pending bulk waiter for ${frameIndex}`);
    }
    try {
      const { bytes, receivedMs } = await pending;
      return toResult(frameIndex, askMs, bytes, receivedMs);
    } catch (e) {
      const reason = this.errors.get(frameIndex);
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

  stats() {
    return {
      inFlight: this.waiters.size,
      droppedEarlyMedia: this.droppedEarly,
      frameErrors: this.frameErrors,
    };
  }

  close() {
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

async function readStreamToEnd(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
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
  const body = buf.take(bodyLen);
  const full = new Uint8Array(4 + bodyLen);
  full.set(header, 0);
  full.set(body, 4);
  return decodeFodMsg(full);
}
