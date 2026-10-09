/**
 * The telemetry transport: named as the downloader's `transport`, it patches WebTransport in the
 * downloader's worker and answers the page's harvest over a BroadcastChannel. Its own query
 * carries the Tap's `stream_mode`.
 */

import { install } from "../../record/install.ts";
import { wrapSession } from "../../record/wrap-session.ts";
import type { ConnectOptions } from "./frame-session.ts";
import { TransportSession as Inner } from "./session.ts";
import { encodeFodMsg } from "./wire.ts";

const query = new URL(import.meta.url).searchParams;
const tap = install({
  client: "transport-ts",
  stream_mode: query.get("stream_mode") === "per-frame" ? "per-frame" : "shared",
});

/** The page asks once, after its run and before it closes the session that ends this worker. */
const harvest = new BroadcastChannel("wtpacs-telemetry");
harvest.onmessage = (e) => {
  if (e.data === "harvest") harvest.postMessage({ report: tap.finish() });
};

export type { FrameResult } from "./session.ts";

export class TransportSession {
  static async connect(wtUrl: string, certSha256: string, options: ConnectOptions = {}) {
    return wrapSession(await Inner.connect(wtUrl, certSha256, wrapOpening(options)));
  }
}

/** An opening fill's frames are delivered from inside the session, past the wrapper. */
function wrapOpening(options: ConnectOptions): ConnectOptions {
  const fill = options.fill;
  if (!fill) return options;
  tap.gesture();
  // It rides the session URL, so no control write opens its rows.
  tap.onControlWrite(encodeFodMsg({ op: "stream_frames", from: fill.from, to: fill.to }));
  return {
    ...options,
    fill: {
      ...fill,
      onFrame: (f) => {
        tap.onDelivered(f.frameIndex);
        fill.onFrame(f);
      },
      onError: (i, reason) => {
        tap.onAskFailed(i, reason);
        fill.onError(i, reason);
      },
    },
  };
}
