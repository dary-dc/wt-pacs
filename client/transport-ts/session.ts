/**
 * Media-complete WebTransport client (TypeScript).
 * Same wire as transport-wasm: FoD on bidi control, envelope on server uni streams.
 */

import {
  decodeFodBody,
  encodeFodMsg,
  hexToBytes,
  MAX_FRAME_LEN,
  type FodMsg,
} from "./wire.ts";
import { AskWindow, type AskWindowConfig } from "./ask-window.ts";

const FRAME_TIMEOUT_MS = 15_000;

export type ConnectOptions = {
  /** Hold on-demand asks to a depth: fixed, or `"auto"` from the link. `ask-window.ts`. */
  window?: AskWindowConfig;
  /** A fill the session URL carries, served behind the accept. docs/proposal-session-open.md */
  fill?: OpeningFill;
  /** Wire buffers to keep for reuse; 0 allocates one per frame. docs/decode/README.md §The wire buffer ring */
  wireBuffers?: number;
};

export type OpeningFill = {
  from: number;
  to: number;
  onFrame: (f: FrameResult) => void;
  onError: (frameIndex: number, reason: string) => void;
};

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

/** A fill pushed as it lands: what is still owed, and where each frame goes. No timer per frame. */
type Fill = {
  pending: Set<number>;
  askMs: number;
  onFrame: (f: FrameResult) => void;
  onError: (frameIndex: number, reason: string) => void;
};

/**
 * The ring: a frame is read into a buffer the consumer hands back, so a fill's peak is the pool
 * and not the series. A buffer too small for the frame being read is dropped rather than grown.
 */
class WireBuffers {
  private free: ArrayBuffer[] = [];

  constructor(private readonly cap: number) {}

  take(len: number): Uint8Array {
    const buf = this.free.pop();
    return new Uint8Array(buf && buf.byteLength >= len ? buf : new ArrayBuffer(len), 0, len);
  }

  release(buffer: ArrayBuffer) {
    if (this.free.length < this.cap) this.free.push(buffer);
  }
}

function closedReasonOf(info: { closeCode?: number; reason?: string } | undefined): string {
  const code = info?.closeCode ?? 0;
  const why = info?.reason ? `: ${info.reason}` : "";
  return `session closed (code ${code})${why}`;
}

export class TransportSession {
  private transport: WebTransport;
  private controlWriter: WritableStreamDefaultWriter<Uint8Array>;
  private waiters = new Map<number, Waiter>();
  private errors = new Map<number, string>();
  private bulkPending = new Map<number, Promise<{ bytes: Uint8Array; receivedMs: number }>>();
  private fill: Fill | null = null;
  private droppedEarly = 0;
  private frameErrors = 0;
  /** Set once the session is gone; a waiter armed after this would only reach the timeout. */
  private closedReason: string | null = null;
  private readonly window: AskWindow | null;
  private readonly wire: WireBuffers;

  private constructor(
    transport: WebTransport,
    controlWriter: WritableStreamDefaultWriter<Uint8Array>,
    options: ConnectOptions,
  ) {
    this.transport = transport;
    this.controlWriter = controlWriter;
    this.window = options.window ? new AskWindow(options.window, () => this.smoothedRtt()) : null;
    this.wire = new WireBuffers(options.wireBuffers ?? 0);
  }

  static async connect(
    wtUrl: string,
    certSha256: string,
    options: ConnectOptions = {},
  ): Promise<TransportSession> {
    const hash = hexToBytes(certSha256);
    const fill = options.fill;
    const transport = new WebTransport(fill ? openAskUrl(wtUrl, fill) : wtUrl, {
      serverCertificateHashes: [{ algorithm: "sha-256", value: hash }],
      congestionControl: "low-latency",
    });
    await transport.ready;

    const bi = await transport.createBidirectionalStream();
    const controlWriter = bi.writable.getWriter();
    const session = new TransportSession(transport, controlWriter, options);
    // The server is already pushing it, so the run is armed and never asked for.
    if (fill) session.armFill(fill.from, fill.to, fill.onFrame, fill.onError);

    session.watchClosed();
    session.pumpUni(transport.incomingUnidirectionalStreams);
    session.pumpControl(bi.readable);

    return session;
  }

  /** docs/CLIENTS.md#a-closed-session-is-noticed-at-once. */
  private watchClosed() {
    this.transport.closed.then(
      (info) => this.failAll(closedReasonOf(info)),
      (err) => this.failAll(`session closed: ${err?.message ?? String(err)}`),
    );
  }

  /** First reason wins: the stream ending and `closed` settling are the same event twice. */
  private failAll(reason: string) {
    this.closedReason ??= reason;
    const fill = this.fill;
    this.fill = null;
    for (const [index, w] of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error(`frame ${index} unavailable: ${this.closedReason}`));
    }
    this.waiters.clear();
    // A fill that lost a frame is not complete: what it was still owed is named, not dropped.
    if (fill) for (const index of fill.pending) fill.onError(index, this.closedReason);
  }

  private armWaiter(frameIndex: number): Promise<{ bytes: Uint8Array; receivedMs: number }> {
    if (this.closedReason) {
      return Promise.reject(new Error(`frame ${frameIndex} unavailable: ${this.closedReason}`));
    }
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

  /** An asked frame settles its waiter; a fill frame goes straight to the fill's callback. */
  private deliver(frameIndex: number, bytes: Uint8Array, receivedMs: number) {
    const fill = this.fill;
    const owed = fill?.pending.delete(frameIndex) ?? false;
    const w = this.waiters.get(frameIndex);
    if (w) {
      clearTimeout(w.timer);
      this.waiters.delete(frameIndex);
      w.resolve({ bytes, receivedMs });
      // The window paces on-demand asks, so only a settled waiter closes one of its slots.
      this.window?.done(frameIndex, bytes.length, receivedMs);
      return;
    }
    if (fill && owed) {
      fill.onFrame(toResult(frameIndex, fill.askMs, bytes, receivedMs));
      return;
    }
    this.droppedEarly += 1;
  }

  private failWaiter(frameIndex: number, reason: string) {
    const w = this.waiters.get(frameIndex);
    this.errors.set(frameIndex, reason);
    this.frameErrors += 1;
    const owed = this.fill?.pending.delete(frameIndex) ?? false;
    if (!w) {
      if (owed) this.fill?.onError(frameIndex, reason);
      return;
    }
    clearTimeout(w.timer);
    this.waiters.delete(frameIndex);
    w.reject(new Error(`frame ${frameIndex} unavailable: ${reason}`));
    this.window?.done(frameIndex, 0, performance.now());
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
      this.failAll("session closed: the media stream ended");
    }
  }

  /** Read envelopes until the uni stream ends. docs/CLIENTS.md#a-truncated-frame-is-a-failure */
  private async pumpFramedStream(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const buf = new ByteAccumulator();
    try {
      for (;;) {
        const env = await readEnvelope(reader, buf, this.wire);
        if (!env) break;
        if (env.ok) {
          this.deliver(env.index, env.codestream, performance.now());
          continue;
        }
        // Shared mode carries the whole run here, so the frames behind the lost one are gone too.
        if (env.index >= 0) this.failWaiter(env.index, env.lost);
        break;
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
    const ask: FodMsg = { op: "request_frame", frame: frameIndex };
    if (this.window) {
      this.window.ask(frameIndex, () => {
        this.sendFod(ask).catch((e) => this.failWaiter(frameIndex, `control write: ${e}`));
      });
    } else {
      await this.sendFod(ask);
    }
    return this.settle(frameIndex, askMs, pending);
  }

  // Not in this TypeScript version's DOM library yet; Chromium has it, other browsers may not.
  private async smoothedRtt(): Promise<number | undefined> {
    const t = this.transport as { getStats?: () => Promise<{ smoothedRtt?: number }> };
    if (typeof t.getStats !== "function") return undefined;
    try {
      return (await t.getStats()).smoothedRtt;
    } catch {
      return undefined;
    }
  }

  startExactFrames(indices: number[]): number {
    if (indices.length === 0) throw new Error("startExactFrames: empty index list");
    if (this.bulkPending.size > 0) throw new Error("startExactFrames: previous bulk still pending");
    const askMs = performance.now();
    for (const frameIndex of indices) {
      this.bulkPending.set(frameIndex, this.armWaiter(frameIndex));
    }
    // A control write that fails would otherwise leave every waiter to the 15 s timeout.
    this.sendFod({ op: "request_frames", frames: [...indices] }).catch((e) => {
      for (const frameIndex of indices) this.failWaiter(frameIndex, `control write: ${e}`);
    });
    return askMs;
  }

  async waitExactFrame(frameIndex: number, askMs: number): Promise<FrameResult> {
    const pending = this.bulkPending.get(frameIndex);
    this.bulkPending.delete(frameIndex);
    if (!pending) {
      throw new Error(`waitExactFrame: no pending bulk waiter for ${frameIndex}`);
    }
    return this.settle(frameIndex, askMs, pending);
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

  /** `{}` on the wire is the whole study. `waitLast` arms waiters through that index. */
  startStreamFrames(waitLast: number, range?: { from?: number; to?: number }): number {
    if (this.bulkPending.size > 0) throw new Error("startStreamFrames: previous bulk still pending");
    const from = range?.from ?? 0;
    const last = range?.to ?? waitLast;
    if (last < from) throw new Error("startStreamFrames: to < from");
    const askMs = performance.now();
    for (let i = from; i <= last; i++) {
      this.bulkPending.set(i, this.armWaiter(i));
    }
    const msg: FodMsg = { op: "stream_frames" };
    if (range?.from !== undefined) msg.from = range.from;
    if (range?.to !== undefined) msg.to = range.to;
    void this.sendFod(msg);
    return askMs;
  }

  /**
   * A fill pushed as it lands, on the wire as `stream_frames`: no waiter and no timer per frame,
   * so `endStream()` or a later fill simply drops what is still owed. docs/CLIENTS.md#fills-are-pushed
   */
  fillFrames(
    from: number,
    to: number,
    onFrame: (f: FrameResult) => void,
    onError: (frameIndex: number, reason: string) => void = () => {},
  ): number {
    if (to < from) throw new Error("fillFrames: to < from");
    if (this.closedReason) throw new Error(`session unavailable: ${this.closedReason}`);
    const askMs = this.armFill(from, to, onFrame, onError);
    void this.sendFod({ op: "stream_frames", from, to });
    return askMs;
  }

  private armFill(
    from: number,
    to: number,
    onFrame: (f: FrameResult) => void,
    onError: (frameIndex: number, reason: string) => void,
  ): number {
    const askMs = performance.now();
    const pending = new Set<number>();
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
      droppedEarlyMedia: this.droppedEarly,
      frameErrors: this.frameErrors,
      windowDepth: this.window?.current() ?? null,
    };
  }

  /** A wire buffer the consumer has finished with, back into the ring. */
  releaseWireBuffer(buffer: ArrayBuffer) {
    this.wire.release(buffer);
  }

  close() {
    try {
      this.transport.close();
    } catch {
      /* ignore */
    }
  }
}

/** `:` and `-` are legal in a query, and `parse_open_ask` splits on them literally. */
function openAskUrl(wtUrl: string, fill: { from: number; to: number }): string {
  return `${wtUrl}${wtUrl.includes("?") ? "&" : "?"}ask=fill:${fill.from}-${fill.to}`;
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

/** A frame off a media stream, or the index of the one a stream that ended mid-frame lost. */
type Envelope =
  | { ok: true; index: number; codestream: Uint8Array }
  | { ok: false; index: number; lost: string };

const be32 = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, 4).getUint32(0, false);
const le32 = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);

/** Read until `buf` holds `n` bytes; false when the stream ended before that. */
async function fillTo(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buf: ByteAccumulator,
  n: number,
): Promise<boolean> {
  while (buf.length < n) {
    const { value, done } = await reader.read();
    if (done) return false;
    if (value) buf.push(value);
  }
  return true;
}

/** `[4B BE len][4B BE index][codestream…]`: the index is read first so a loss can be named. */
async function readEnvelope(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buf: ByteAccumulator,
  wire: WireBuffers,
): Promise<Envelope | null> {
  if (!(await fillTo(reader, buf, 4))) return null;
  const len = be32(buf.take(4));
  if (len < 4 || len > MAX_FRAME_LEN) throw new Error(`invalid frame length ${len}`);
  if (!(await fillTo(reader, buf, len))) {
    if (buf.length < 4) return { ok: false, index: -1, lost: "truncated before its index" };
    const index = be32(buf.take(4));
    return { ok: false, index, lost: `truncated: ${buf.length} of ${len - 4} bytes` };
  }
  return { ok: true, index: be32(buf.take(4)), codestream: buf.take(len - 4, wire.take(len - 4)) };
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

  /** Consume `n` bytes from the front, into `out` when the caller owns a buffer for them. */
  take(n: number, out: Uint8Array = new Uint8Array(n)): Uint8Array {
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
}

async function readFodFrom(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buf: ByteAccumulator,
): Promise<FodMsg> {
  if (!(await fillTo(reader, buf, 4))) throw new Error("control stream ended");
  const bodyLen = le32(buf.take(4));
  if (!(await fillTo(reader, buf, bodyLen))) throw new Error("control stream ended mid-message");
  return decodeFodBody(buf.take(bodyLen));
}
