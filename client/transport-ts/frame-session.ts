/**
 * What every session does whatever carries its bytes: one waiter per asked frame, a fill pushed
 * as it lands, refusals, and the reader of `[4B BE len][4B BE index][codestream…]`. The carrier —
 * WebTransport (`session.ts`) or a WebSocket (`ws-session.ts`) — only dials, sends and feeds bytes.
 */

import { MAX_FRAME_LEN, type FodMsg } from "./wire.ts";
import { AskWindow, type AskWindowConfig } from "./ask-window.ts";

const FRAME_TIMEOUT_MS = 15_000;

export type ConnectOptions = {
  /** Hold on-demand asks to a depth: fixed, or `"auto"` from the link. `ask-window.ts`. */
  window?: AskWindowConfig;
  /** A fill the session URL carries, served behind the accept. docs/ARCHITECTURE.md */
  fill?: OpeningFill;
  /** Wire buffers to keep for reuse; 0 allocates one per frame. docs/decode/README.md §The wire buffer ring */
  wireBuffers?: number;
  /** ms: a dial whose `ready` has not settled by then is closed and rejected with a `DialTimeoutError`.
   *  docs/ARCHITECTURE.md §A dial that never settles */
  dialMs?: number;
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

/** Closes a dial whose `ready` outlives `ms`, so an abandoned dial leaves nothing open. */
export function settleWithin(ready: Promise<unknown>, close: () => void, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // First: `close()` rejects a connecting `ready` at once, and the race must see this error.
      reject(Object.assign(new Error(`the dial did not settle in ${ms} ms`), { name: "DialTimeoutError" }));
      close();
    }, ms);
  });
  return Promise.race([ready, late]).then(() => {}).finally(() => clearTimeout(timer));
}

export function closedReasonOf(info: { closeCode?: number; reason?: string } | undefined): string {
  const code = info?.closeCode ?? 0;
  const why = info?.reason ? `: ${info.reason}` : "";
  return `session closed (code ${code})${why}`;
}

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

export abstract class FrameSession {
  private waiters = new Map<number, Waiter>();
  private errors = new Map<number, string>();
  private bulkPending = new Map<number, Promise<{ bytes: Uint8Array; receivedMs: number }>>();
  private fill: Fill | null = null;
  private droppedEarly = 0;
  private frameErrors = 0;
  /** `performance.now()` of the last byte any stream delivered: what a dead path stops moving. */
  private lastByteAt = 0;
  /** Set once the session is gone; a waiter armed after this would only reach the timeout. */
  private closedReason: string | null = null;
  private readonly window: AskWindow | null;
  private readonly wire: WireBuffers;

  protected constructor(options: ConnectOptions) {
    this.window = options.window ? new AskWindow(options.window, () => this.smoothedRtt()) : null;
    this.wire = new WireBuffers(options.wireBuffers ?? 0);
  }

  protected abstract sendFod(msg: FodMsg): Promise<void>;

  protected abstract smoothedRtt(): Promise<number | undefined>;

  abstract close(): void;

  /** First reason wins: the stream ending and `closed` settling are the same event twice. */
  protected failAll(reason: string) {
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
      const armedAt = performance.now();
      // Late when the session goes quiet, not when the ask is old: a long burst still owes its tail.
      const expire = () => {
        const quiet = performance.now() - Math.max(armedAt, this.lastByteAt);
        if (quiet < FRAME_TIMEOUT_MS) return void (w.timer = setTimeout(expire, FRAME_TIMEOUT_MS - quiet));
        this.waiters.delete(frameIndex);
        reject(new Error(`timeout waiting for frame ${frameIndex}: no byte for ${FRAME_TIMEOUT_MS} ms`));
      };
      const w = { resolve, reject, timer: setTimeout(expire, FRAME_TIMEOUT_MS) };
      this.waiters.set(frameIndex, w);
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

  protected failWaiter(frameIndex: number, reason: string) {
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

  protected onControl(msg: FodMsg) {
    if (msg.op === "frame_error") this.failWaiter(msg.frame_index, msg.reason ?? "frame error");
  }

  protected newAccumulator(): ByteAccumulator {
    return new ByteAccumulator(() => (this.lastByteAt = performance.now()));
  }

  /** Read envelopes until the stream ends. docs/CLIENTS.md#a-truncated-frame-is-a-failure */
  protected async pumpFramedStream(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const buf = this.newAccumulator();
    try {
      for (;;) {
        const env = await readEnvelope(reader, buf, this.wire);
        if (!env) break;
        if (env.ok) {
          this.deliver(env.index, env.codestream, performance.now());
          continue;
        }
        // One stream carrying the whole run loses every frame behind the cut one too.
        if (env.index >= 0) this.failWaiter(env.index, env.lost);
        break;
      }
    } catch {
      /* stream ended */
    }
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

  protected armFill(
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
      lastByteAt: this.lastByteAt,
    };
  }

  /** A wire buffer the consumer has finished with, back into the ring. */
  releaseWireBuffer(buffer: ArrayBuffer) {
    this.wire.release(buffer);
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

/** A frame off a media stream, or the index of the one a stream that ended mid-frame lost. */
type Envelope =
  | { ok: true; index: number; codestream: Uint8Array }
  | { ok: false; index: number; lost: string };

const be32 = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, 4).getUint32(0, false);
export const le32 = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);

/** Read until `buf` holds `n` bytes; false when the stream ended before that. */
export async function fillTo(
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

export class ByteAccumulator {
  private parts: Uint8Array[] = [];
  private len = 0;

  constructor(private onBytes: () => void) {}

  push(chunk: Uint8Array) {
    this.onBytes();
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
