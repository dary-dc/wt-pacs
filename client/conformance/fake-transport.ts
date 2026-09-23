/**
 * A WebTransport stand-in on the global scope. Both implementations reach for
 * `new WebTransport(...)` there — the TS one directly, the WASM one through web_sys — so one
 * fake drives either, in Node, with no browser and no server.
 * It speaks the format in ../transport-ts/wire.ts: `[4B LE len][JSON]` on control,
 * `[4B BE len][4B BE index][codestream]` on a unidirectional stream.
 */
import { decodeFodMsg, encodeFodMsg, type FodMsg } from "../transport-ts/wire.ts";

/** web_sys checks `instanceof` on the bidi stream, which returns false for a bare object. */
class WebTransportBidirectionalStream {
  constructor(
    readonly readable: ReadableStream<Uint8Array>,
    readonly writable: WritableStream<Uint8Array>,
  ) {}
}

export function frameBytes(index: number, codestream: Uint8Array): Uint8Array {
  const inner = new Uint8Array(4 + codestream.length);
  new DataView(inner.buffer).setUint32(0, index, false);
  inner.set(codestream, 4);
  const out = new Uint8Array(4 + inner.length);
  new DataView(out.buffer).setUint32(0, inner.length, false);
  out.set(inner, 4);
  return out;
}

export class FakeTransport {
  static last: FakeTransport;
  /** How many transports have been constructed: a dial the client did not need shows up here. */
  static dials = 0;
  /** The next `n` dials fail — a path that is still gone when the client tries to come back. */
  static failNext = 0;
  readonly ready: Promise<void>;
  readonly closed: Promise<{ closeCode: number; reason: string }>;
  readonly sent: Uint8Array[] = [];
  didClose = false;
  readonly incomingUnidirectionalStreams: ReadableStream<ReadableStream<Uint8Array>>;
  private uni!: ReadableStreamDefaultController<ReadableStream<Uint8Array>>;
  private control: ReadableStreamDefaultController<Uint8Array> | null = null;
  private settleClosed!: (info: { closeCode: number; reason: string }) => void;

  constructor(
    readonly url: string,
    readonly options: unknown,
  ) {
    const refuse = FakeTransport.failNext > 0;
    if (refuse) FakeTransport.failNext -= 1;
    this.ready = refuse ? Promise.reject(new Error("dial refused")) : Promise.resolve();
    this.ready.catch(() => {});
    this.closed = new Promise((resolve) => {
      this.settleClosed = resolve;
    });
    this.incomingUnidirectionalStreams = new ReadableStream({
      start: (c) => {
        this.uni = c;
      },
    });
    FakeTransport.last = this;
    FakeTransport.dials += 1;
  }

  /** The server goes away. `endStreams: false` settles `closed` and leaves the media stream open,
   *  which separates the two signals a client could be learning from. */
  serverClose(closeCode = 0, reason = "server closed the session", endStreams = true) {
    if (this.didClose) return;
    this.didClose = true;
    if (endStreams) {
      try {
        this.uni.close();
      } catch {
        /* already closed */
      }
    }
    this.settleClosed({ closeCode, reason });
  }

  async createBidirectionalStream() {
    return new WebTransportBidirectionalStream(
      new ReadableStream({ start: (c) => void (this.control = c) }),
      new WritableStream({ write: (chunk) => void this.sent.push(chunk) }),
    );
  }

  /** The server refusing a frame: one `frame_error` on control, which is how a range is refused. */
  pushRefusal(index: number, reason: string) {
    this.control?.enqueue(encodeFodMsg({ op: "frame_error", frame_index: index, reason }));
  }

  /** One frame on its own uni stream — the per-frame mode. */
  pushFrame(index: number, codestream: Uint8Array) {
    this.pushOnOneStream([[index, codestream]]);
  }

  /** One media stream, ended after its chunks: a byte stream, as a WebTransport receive stream
   *  is — only those take a BYOB reader. Enqueueing detaches, so each chunk is its own. */
  private pushMediaStream(chunks: Uint8Array[]) {
    this.uni.enqueue(
      new ReadableStream({
        type: "bytes",
        start(c) {
          for (const chunk of chunks) c.enqueue(chunk);
          c.close();
        },
      }),
    );
  }

  /** One frame split across `chunks` reads — a real link delivers a frame in many. */
  pushFrameInChunks(index: number, codestream: Uint8Array, chunks: number) {
    const whole = frameBytes(index, codestream);
    const per = Math.ceil(whole.length / chunks);
    const parts = [];
    for (let at = 0; at < whole.length; at += per) parts.push(whole.slice(at, at + per));
    this.pushMediaStream(parts);
  }

  /** A frame whose stream ends after `sent` codestream bytes — the server truncating it. */
  pushTruncatedFrame(index: number, codestream: Uint8Array, sent: number) {
    this.pushMediaStream([frameBytes(index, codestream).slice(0, 8 + sent)]);
  }

  /** Several frames on one uni stream in one chunk — the shared mode. */
  pushOnOneStream(frames: [number, Uint8Array][]) {
    const parts = frames.map(([i, c]) => frameBytes(i, c));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const merged = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      merged.set(p, at);
      at += p.length;
    }
    this.pushMediaStream([merged]);
  }

  controlMessages(): FodMsg[] {
    return this.sent.map((b) => decodeFodMsg(b));
  }

  close() {
    this.didClose = true;
  }
}

export function installFakeTransport() {
  (globalThis as Record<string, unknown>).WebTransport = FakeTransport;
  (globalThis as Record<string, unknown>).WebTransportBidirectionalStream =
    WebTransportBidirectionalStream;
}
