/**
 * The WASM client behind the downloader's transport seam. The package exports
 * `TransportSessionHandle` and needs its wasm-bindgen init run first; the seam wants a module
 * exporting `TransportSession` with a static `connect`. D2d — docs/ARCHITECTURE.md.
 */
import init, { TransportSessionHandle } from "./pkg/transport_wasm.js";

let started = null;

export class TransportSession {
  static async connect(url, certHash, options = {}) {
    started ??= init();
    await started;
    const session = await TransportSessionHandle.connect(url, certHash, options.wireBuffers);
    // This client has no opening ask, so an opening fill is asked on the control stream.
    const fill = options.fill;
    if (fill) session.fillFrames(fill.from, fill.to, fill.onFrame, fill.onError);
    return session;
  }
}
