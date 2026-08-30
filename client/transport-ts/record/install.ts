/**
 * Telemetry entry — patch WebTransport before any client module loads.
 * Plan §3 / ADR option G.
 */

import { proxyTransport } from "./proxy.ts";
import { ensureReport, getTap, setTap, Tap } from "./tap.ts";
import type { TapConfig } from "./types.ts";
export { wrapSession } from "./wrap-session.ts";

export type InstallOptions = Partial<TapConfig> & {
  /** If false, skip patching (tests). Default true. */
  patch?: boolean;
};

let installed = false;
let RealWebTransport: typeof WebTransport | null = null;

export function install(opts: InstallOptions = {}) {
  const config: TapConfig = {
    arm: opts.arm ?? "transport-ts",
    stream_mode: opts.stream_mode ?? "shared",
    copies_per_frame: opts.copies_per_frame ?? (opts.arm === "transport-wasm" ? 2 : 1),
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
