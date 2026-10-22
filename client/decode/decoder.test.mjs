// node client/decode/decoder.test.mjs — decoder.js's order of decodes, on a stand-in codec; no browser.
const GLUE = `var OpenJPHModule = async () => ({ HTJ2KDecoder: class {
  getEncodedBuffer(n) { return (this.bytes = new Uint8Array(n)); }
  readHeader() {}
  getFrameInfo() { return { width: 1, height: 1, componentCount: 1, bitsPerSample: 8, isSigned: false }; }
  decode() {}
  getDecodedBuffer() { return this.bytes.subarray(0, 1); }
} });`;
globalThis.fetch = async () => new Response(GLUE);
globalThis.onmessage = null;
globalThis.postMessage = () => {};
await import("./decoder.js");
const order = [];
await onmessage({ data: { kind: "init", toConsumer: { postMessage: (m) => order.push(m.index) }, decoder: { glue: "g", wasm: "w", dir: "d" } } });

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};
const decode = (index, priority) => onmessage({ data: { kind: "decode", index, gen: 0, key: true, bytes: new Uint8Array([index]), stamps: {}, ...priority } });
const drained = () => new Promise((r) => setTimeout(r, 20));

/** Frames with no priority decode in arrival order: what every decode is without the lab flag `askJump`. */
for (const i of [0, 1, 2, 3]) decode(i);
await drained();
check(order.join() === "0,1,2,3", `no priority: arrival order (${order})`);

/** A frame marked `priority: "ask"` decodes before the fill frames queued ahead of it, after the one already decoding. */
order.length = 0;
for (const i of [0, 1, 2]) decode(i);
decode(3, { priority: "ask" });
decode(4);
await drained();
check(order.join() === "0,3,1,2,4", `an ask runs after the current frame, before the queued ones (${order})`);

console.log(failed ? `${failed} failed` : "decoder order, arrival and an ask first: ok");
process.exit(failed ? 1 : 0);
