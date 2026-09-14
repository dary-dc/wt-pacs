/**
 * A WebTransport stand-in on the global scope. Both implementations reach for
 * `new WebTransport(...)` there — the TS one directly, the WASM one through web_sys — so one
 * fake drives either, in Node, with no browser and no server.
 *
 * It speaks the format in ../transport-ts/wire.ts: `[4B LE len][JSON]` on control,
 * `[4B BE len][4B BE index][codestream]` on a unidirectional stream.
 */
import { decodeFodMsg, type FodMsg } from "../transport-ts/wire.ts";

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
  readonly ready = Promise.resolve();
  readonly closed = new Promise<void>(() => {});
  readonly sent: Uint8Array[] = [];
  didClose = false;
  readonly incomingUnidirectionalStreams: ReadableStream<ReadableStream<Uint8Array>>;
  private uni!: ReadableStreamDefaultController<ReadableStream<Uint8Array>>;

  constructor(
    readonly url: string,
    readonly options: unknown,
  ) {
    this.incomingUnidirectionalStreams = new ReadableStream({
      start: (c) => {
        this.uni = c;
      },
    });
    FakeTransport.last = this;
  }

  async createBidirectionalStream() {
    return new WebTransportBidirectionalStream(
      new ReadableStream({ start: () => {} }),
      new WritableStream({ write: (chunk) => void this.sent.push(chunk) }),
    );
  }

  /** One frame on its own uni stream — the per-frame mode. */
  pushFrame(index: number, codestream: Uint8Array) {
    this.pushOnOneStream([[index, codestream]]);
  }

  /** One frame split across `chunks` reads — a real link delivers a frame in many. */
  pushFrameInChunks(index: number, codestream: Uint8Array, chunks: number) {
    const whole = frameBytes(index, codestream);
    const per = Math.ceil(whole.length / chunks);
    this.uni.enqueue(
      new ReadableStream({
        start(c) {
          for (let at = 0; at < whole.length; at += per) c.enqueue(whole.subarray(at, at + per));
          c.close();
        },
      }),
    );
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
    this.uni.enqueue(
      new ReadableStream({
        start(c) {
          c.enqueue(merged);
          c.close();
        },
      }),
    );
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
