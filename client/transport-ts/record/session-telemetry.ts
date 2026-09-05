/**
 * Telemetry build entry — install patch, then re-export a wrapped TransportSession.
 * Load order: install runs before session module evaluation.
 */

import { install } from "./install.ts";
import { wrapSession } from "./wrap-session.ts";

install({
  arm: (globalThis as unknown as { __wtpacsArm?: "transport-ts" | "transport-wasm" })
    .__wtpacsArm ?? "transport-ts",
  stream_mode:
    (globalThis as unknown as { __wtpacsStreamMode?: "shared" | "per-frame" })
      .__wtpacsStreamMode ?? "shared",
});

import { TransportSession as Inner } from "../session.ts";

export type { FrameResult } from "../session.ts";

export class TransportSession {
  static async connect(wtUrl: string, certSha256: string) {
    const s = await Inner.connect(wtUrl, certSha256);
    return wrapSession(s);
  }
}
