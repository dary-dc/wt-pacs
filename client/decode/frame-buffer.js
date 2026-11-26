/** A decoded frame's memory: a `SharedArrayBuffer`, or under the lab's `pixels: "transfer"` an `ArrayBuffer` the decoder transfers. docs/adr/frame-path.md §3, *Experiment 3* */
let transfer = false;

export const transferFrames = (on) => void (transfer = on);

export const frameBuffer = (bytes) => (transfer ? new ArrayBuffer(bytes) : new SharedArrayBuffer(bytes));

/** The transfer list a frame's message carries: a shared buffer is never listed. */
export const transferOf = (buffer) => (buffer instanceof ArrayBuffer ? [buffer] : []);
