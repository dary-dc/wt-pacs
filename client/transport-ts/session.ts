/**
 * Media-complete WebTransport client (TypeScript).
 * Same wire as transport-wasm: FoD on bidi control, envelope on server uni streams.
 */

import { decodeFodBody, encodeFodMsg, hexToBytes, type FodMsg } from "./wire.ts";
import {
  ByteAccumulator,
  closedReasonOf,
  fillTo,
  FrameSession,
  le32,
  settleWithin,
  type ConnectOptions,
} from "./frame-session.ts";

export type { ConnectOptions, FrameResult, OpeningFill } from "./frame-session.ts";

export class TransportSession extends FrameSession {
  private transport: WebTransport;
  private controlWriter: WritableStreamDefaultWriter<Uint8Array>;

  private constructor(
    transport: WebTransport,
    controlWriter: WritableStreamDefaultWriter<Uint8Array>,
    options: ConnectOptions,
  ) {
    super(options);
    this.transport = transport;
    this.controlWriter = controlWriter;
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
    await (options.dialMs
      ? settleWithin(transport.ready, () => transport.close(), options.dialMs)
      : transport.ready);

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

  private async pumpControl(readable: ReadableStream<Uint8Array>) {
    const reader = readable.getReader();
    const buf = this.newAccumulator();
    try {
      for (;;) this.onControl(await readFodFrom(reader, buf));
    } catch {
      /* control ended */
    }
  }

  protected async sendFod(msg: FodMsg) {
    await this.controlWriter.write(encodeFodMsg(msg));
  }

  // Not in this TypeScript version's DOM library yet; Chromium has it, other browsers may not.
  protected async smoothedRtt(): Promise<number | undefined> {
    const t = this.transport as { getStats?: () => Promise<{ smoothedRtt?: number }> };
    if (typeof t.getStats !== "function") return undefined;
    try {
      return (await t.getStats()).smoothedRtt;
    } catch {
      return undefined;
    }
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

async function readFodFrom(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buf: ByteAccumulator,
): Promise<FodMsg> {
  if (!(await fillTo(reader, buf, 4))) throw new Error("control stream ended");
  const bodyLen = le32(buf.take(4));
  if (!(await fillTo(reader, buf, bodyLen))) throw new Error("control stream ended mid-message");
  return decodeFodBody(buf.take(bodyLen));
}
