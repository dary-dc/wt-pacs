/**
 * TS-arm telemetry entry — install the shared patch, then re-export a wrapped session.
 * Load order: install runs before the product session module evaluates.
 */

import { install } from "../record/install.ts";
import { wrapSession } from "../record/wrap-session.ts";

install({
  arm: (globalThis as unknown as { __wtpacsArm?: "transport-ts" | "transport-wasm" })
    .__wtpacsArm ?? "transport-ts",
  stream_mode:
    (globalThis as unknown as { __wtpacsStreamMode?: "shared" | "per-frame" })
      .__wtpacsStreamMode ?? "shared",
});

import { TransportSession as Inner } from "./session.ts";

export type { FrameResult } from "./session.ts";

export class TransportSession {
  static async connect(wtUrl: string, certSha256: string, transport?: WebTransport) {
    const s = await Inner.connect(wtUrl, certSha256, transport);
    return wrapSession(s);
  }
}
