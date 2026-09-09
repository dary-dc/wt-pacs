/**
 * Telemetry entry — patch WebTransport before any client module loads.
 * Plan §3 / ADR option G.
 */

import { proxyTransport } from "./proxy.ts";
import { DEFAULT_RING_CAPACITY, ensureReport, getTap, setTap, Tap } from "./tap.ts";
import type { TapConfig } from "./types.ts";
export { wrapSession } from "./wrap-session.ts";

export type InstallOptions = Partial<TapConfig> & {
  /** If false, skip patching (tests). Default true. */
  patch?: boolean;
};

let installed = false;
let RealWebTransport: typeof WebTransport | null = null;

export function install(opts: InstallOptions = {}) {
  const arm = opts.arm ?? "transport-ts";
  const config: TapConfig = {
    arm,
    stream_mode: opts.stream_mode ?? "shared",
    // Source read, not measured here: TS copies once (ByteAccumulator.take); WASM copies
    // chunk → RecvBuf, then RecvBuf → JS heap. Say so in the report.
    copies_per_frame_declared:
      opts.copies_per_frame_declared ?? (arm === "transport-wasm" ? 2 : 1),
    copies_source:
      opts.copies_source ??
      (arm === "transport-wasm"
        ? "source: session.rs RecvBuf::push_chunk + js_buffer_from"
        : "source: session.ts ByteAccumulator.take"),
    ring_capacity: opts.ring_capacity ?? DEFAULT_RING_CAPACITY,
  };
  const tap = new Tap(config);
  setTap(tap);
  (globalThis as unknown as { __wtpacsTap?: Tap }).__wtpacsTap = tap;

  if (opts.patch === false) {
    exposeGlobal(tap);
    return tap;
  }

  if (!installed) {
    RealWebTransport = globalThis.WebTransport;
    const Real = RealWebTransport;
    // Function constructor so `new WebTransport(...)` works.
    function PatchedWebTransport(url: string, options?: WebTransportOptions) {
      const real = new Real!(url, options);
      return proxyTransport(real);
    }
    PatchedWebTransport.prototype = Real.prototype;
    Object.setPrototypeOf(PatchedWebTransport, Real);
    Object.defineProperty(globalThis, "WebTransport", {
      configurable: true,
      writable: true,
      value: PatchedWebTransport,
    });
    installed = true;
  }

  exposeGlobal(tap);
  return tap;
}

function exposeGlobal(tap: Tap) {
  (globalThis as unknown as { __wtpacsTelemetry?: () => unknown }).__wtpacsTelemetry = () =>
    tap.finish();
}

export function uninstall() {
  if (RealWebTransport) {
    Object.defineProperty(globalThis, "WebTransport", {
      configurable: true,
      writable: true,
      value: RealWebTransport,
    });
  }
  setTap(null);
  delete (globalThis as unknown as { __wtpacsTelemetry?: unknown }).__wtpacsTelemetry;
  delete (globalThis as unknown as { __wtpacsTap?: unknown }).__wtpacsTap;
  installed = false;
}

export { ensureReport, getTap } from "./tap.ts";
export type { TelemetryReport } from "./types.ts";
