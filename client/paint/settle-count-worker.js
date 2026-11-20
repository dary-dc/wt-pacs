/** The settle check's count: the paint module's own reads and fences for each settle, the context's calls wrapped. settle-check.mjs */
const calls = { readPixels: 0, fenceSync: 0 };
for (const name of Object.keys(calls)) {
  const original = WebGL2RenderingContext.prototype[name];
  WebGL2RenderingContext.prototype[name] = function (...args) {
    calls[name] += 1;
    return original.apply(this, args);
  };
}
// Imported after the wrapping, and after the handler is set, so the page's message is not missed.
const loaded = import("./paint-worker.js");

onmessage = async ({ data: { canvas } }) => {
  try {
    const { paint, start } = await loaded;
    start(canvas, () => {});
    const frame = { pixels: new SharedArrayBuffer(64 * 64), width: 64, height: 64, bits: 8, components: 1, signed: false };
    const display = { photometric: "MONOCHROME2", voi: { center: 128, width: 256, function: "LINEAR" }, view: { fit: true } };
    const out = {};
    for (const settle of [undefined, "fence", "read"]) {
      calls.readPixels = calls.fenceSync = 0;
      await paint({ frame, same: false, display, width: 64, height: 64, dpr: 1, read: false, settle });
      out[settle ?? "none"] = { ...calls };
    }
    postMessage({ out });
  } catch (e) {
    postMessage({ error: String(e?.message ?? e) });
  }
};
