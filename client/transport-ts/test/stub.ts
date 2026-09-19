/**
 * A WebTransport stand-in for Node: one shared media uni, a control stream whose asks are served
 * FIFO by a server `tfMs` per frame behind a link of `rttMs`, and what it saw.
 */

export type StubLink = { rttMs: number; tfMs: number; bytes: number; stats?: boolean };

export class StubTransport {
  static link: StubLink = { rttMs: 0, tfMs: 0, bytes: 16 };
  static last: StubTransport | null = null;

  readonly ready = Promise.resolve();
  /** The session watches this to notice a closure; a stub session never closes on its own. */
  readonly closed = new Promise<void>(() => {});
  readonly incomingUnidirectionalStreams: ReadableStream<ReadableStream<Uint8Array>>;
  readonly askOrder: number[] = [];
  maxInFlight = 0;
  private inFlight = 0;
  private serverFreeAt = 0;
  private media!: ReadableStreamDefaultController<Uint8Array>;
  private readonly link: StubLink;

  constructor(_url: string, _opts: unknown) {
    this.link = StubTransport.link;
    StubTransport.last = this;
    const mediaStream = new ReadableStream<Uint8Array>({ start: (c) => (this.media = c) });
    this.incomingUnidirectionalStreams = new ReadableStream({
      start: (c) => c.enqueue(mediaStream),
    });
    if (this.link.stats) {
      (this as { getStats?: () => Promise<{ smoothedRtt: number }> }).getStats = async () => ({
        smoothedRtt: this.link.rttMs,
      });
    }
  }

  async createBidirectionalStream() {
    const readable = new ReadableStream<Uint8Array>();
    const writable = new WritableStream<Uint8Array>({ write: (chunk) => this.onAsk(chunk) });
    return { readable, writable };
  }

  close() {}

  private onAsk(chunk: Uint8Array) {
    const len = new DataView(chunk.buffer, chunk.byteOffset, 4).getUint32(0, true);
    const msg = JSON.parse(new TextDecoder().decode(chunk.subarray(4, 4 + len)));
    if (msg.op !== "request_frame") return;
    const { rttMs, tfMs, bytes } = this.link;
    this.askOrder.push(msg.frame);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    const now = performance.now();
    const start = Math.max(now + rttMs / 2, this.serverFreeAt);
    this.serverFreeAt = start + tfMs;
    setTimeout(() => {
      this.inFlight -= 1;
      this.media.enqueue(envelope(msg.frame, bytes));
    }, this.serverFreeAt + rttMs / 2 - now);
  }
}

function envelope(index: number, bytes: number): Uint8Array {
  const out = new Uint8Array(8 + bytes);
  const v = new DataView(out.buffer);
  v.setUint32(0, 4 + bytes, false);
  v.setUint32(4, index, false);
  return out;
}
