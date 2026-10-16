/**
 * The WASM client behind the downloader's transport seam. The package exports
 * `TransportSessionHandle` and needs its wasm-bindgen init run first; the seam wants a module
 * exporting `TransportSession` with a static `connect`. docs/CLIENTS.md §The seam.
 */
import init, { TransportSessionHandle } from "./pkg/transport_wasm.js";

let started = null;

export class TransportSession {
  static async connect(url, certHash, options = {}) {
    started ??= init();
    await started;
    return TransportSessionHandle.connect(url, certHash, options);
  }
}
