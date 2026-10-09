/**
 * The same envelopes and FoD messages over one WebSocket, for a network that impairs UDP or a
 * browser without WebTransport. Binary messages, joined, are the shared media stream's bytes; a
 * text message is one FoD message's JSON. docs/WIRE.md §The WebSocket mapping
 */

import type { FodMsg } from "./wire.ts";
import { closedReasonOf, FrameSession, openingAskUrl, settleWithin, type ConnectOptions } from "./frame-session.ts";

export type { ConnectOptions, FrameResult, OpeningFill } from "./frame-session.ts";

export class TransportSession extends FrameSession {
  private constructor(
    private readonly socket: WebSocket,
    options: ConnectOptions,
  ) {
    super({ ...options, readMin: undefined });
  }

  /** The server's TCP listener shares its QUIC port's number, so `https://h:p/` dials `wss://h:p/`. */
  static async connect(
    url: string,
    _certSha256: string,
    options: ConnectOptions = {},
  ): Promise<TransportSession> {
    // A WebSocket cannot pin a certificate by hash: the browser's own trust decides.
    const wsUrl = url.replace(/^https:/, "wss:");
    const fill = options.fill;
    const socket = new WebSocket(fill ? openingAskUrl(wsUrl, fill) : wsUrl);
    socket.binaryType = "arraybuffer";
    const open = new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onclose = (e) => reject(new Error(`the WebSocket dial failed (code ${e.code})`));
    });
    await (options.dialMs ? settleWithin(open, () => socket.close(), options.dialMs) : open);

    const session = new TransportSession(socket, options);
    session.pump();
    // The server pushes it behind the 101, so the run is armed and never asked for.
    if (fill) session.armFill(fill.from, fill.to, fill.onFrame, fill.onError);
    return session;
  }

  private pump() {
    let media!: ReadableStreamDefaultController<Uint8Array>;
    let closed = "session closed: the media stream broke";
    this.socket.onmessage = (e) => {
      if (typeof e.data === "string") this.onControl(JSON.parse(e.data) as FodMsg);
      else media.enqueue(new Uint8Array(e.data as ArrayBuffer));
    };
    this.socket.onclose = (e) => {
      closed = closedReasonOf({ closeCode: e.code, reason: e.reason });
      media.close();
    };
    // Bytes already here are read before the session is failed, so a frame the close cut short
    // is named as truncated rather than as merely owed.
    void this.pumpFramedStream(new ReadableStream({ start: (c) => void (media = c) })).then(() => {
      this.failAll(closed);
      this.close();
    });
  }

  protected async sendFod(msg: FodMsg) {
    this.socket.send(JSON.stringify(msg));
  }

  close() {
    this.socket.close(1000);
  }
}
