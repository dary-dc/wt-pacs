// The product's decoder worker (client/downloader/decoder.js) in a Node worker thread: the
// browser-worker globals it expects, and the require and __dirname the emscripten glue's Node branch reads.
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";

globalThis.self = globalThis;
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = "/";
globalThis.onmessage = null;
globalThis.postMessage = (m, transfer) => parentPort.postMessage(m, transfer);
await import("../../../../client/downloader/decoder.js");
parentPort.on("message", (data) => globalThis.onmessage({ data }));
