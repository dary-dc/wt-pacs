/**
 * Opt-in: dial WebTransport and a WebSocket at once and keep whichever session is ready first,
 * because a network that swallows UDP makes a QUIC dial wait out Chrome's four-second handshake
 * timeout before it fails. docs/proposal-udp-fallback.md §Race it
 */

import { TransportSession as OverQuic } from "./session.ts";
import { TransportSession as OverTcp } from "./ws-session.ts";
import type { ConnectOptions } from "./frame-session.ts";

export type { ConnectOptions, FrameResult, OpeningFill } from "./frame-session.ts";

export class TransportSession {
  static async connect(url: string, certSha256: string, options: ConnectOptions = {}) {
    // An opening fill in both dials would be pushed by both servers: it goes to the winner alone.
    const { fill, ...dialOptions } = options;
    const dials: Promise<OverQuic | OverTcp>[] = [
      OverQuic.connect(url, certSha256, dialOptions),
      OverTcp.connect(url, certSha256, dialOptions),
    ];
    let winner: OverQuic | OverTcp;
    try {
      winner = await Promise.any(dials);
    } catch (e) {
      const errors = (e as AggregateError).errors as Error[];
      const timedOut = errors.some((err) => err?.name === "DialTimeoutError");
      const why = errors.map((err) => err?.message ?? String(err)).join("; ");
      throw Object.assign(new Error(`neither transport connected: ${why}`), {
        name: timedOut ? "DialTimeoutError" : "Error",
      });
    }
    for (const dial of dials) dial.then((s) => s !== winner && s.close(), () => {});
    if (fill) winner.fillFrames(fill.from, fill.to, fill.onFrame, fill.onError);
    return winner;
  }
}
