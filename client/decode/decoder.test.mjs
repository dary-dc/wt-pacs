// node client/decode/decoder.test.mjs — decoder.js and htj2k.js as built, over a stand-in OpenJPH glue: the frame's buffer and its transfer list.
const GLUE = `var OpenJPHModule = () => ({ HTJ2KDecoder: class {
  getEncodedBuffer(n) { return (this.coded = new Uint8Array(n)); }
  readHeader() {}
  getFrameInfo() { return { width: 2, height: 1, componentCount: 1, bitsPerSample: 12, isSigned: false }; }
  decode() {}
  getDecodedBuffer() { return this.coded.slice(0, 4); }
} });`;
globalThis.fetch = async () => new Response(GLUE);

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};

let reply = null;
globalThis.postMessage = (m) => reply?.(m);
globalThis.onmessage = null;
await import("./decoder.js");
const next = () => new Promise((r) => { reply = r; });

/** Frames decoded under `pixels`, each stand-in frame's samples its coded bytes: what reached the consumer, and the
 *  transfer list each rode with. */
async function framesUnder(pixels, coded = [[1, 0, 2, 0]]) {
  const sent = [];
  const ready = next();
  onmessage({ data: { kind: "init", toConsumer: { postMessage: (m, transfer = []) => sent.push({ m, transfer }) }, decoder: { glue: "g", wasm: "w" }, pixels } });
  check((await ready).kind === "ready", `the decoder starts under pixels=${pixels}`);
  for (const [index, bytes] of coded.entries()) {
    const done = next();
    onmessage({ data: { kind: "decode", index, gen: 0, bytes: Uint8Array.from(bytes), stamps: {} } });
    check((await done).kind === "done", `frame ${index} decodes under pixels=${pixels}`);
  }
  return sent;
}
const frameUnder = async (pixels) => (await framesUnder(pixels))[0];

/** By default a frame is a SharedArrayBuffer, shared, never transferred. */
{
  const { m, transfer } = await frameUnder(undefined);
  check(m.pixels instanceof SharedArrayBuffer, "the default frame is a SharedArrayBuffer");
  check(transfer.length === 0, "the default frame rides no transfer list");
}

/** Under "transfer" a frame is an ArrayBuffer in its message's transfer list, so the decoder keeps none of it. */
{
  const { m, transfer } = await frameUnder("transfer");
  check(m.pixels instanceof ArrayBuffer, "under transfer the frame is an ArrayBuffer");
  check(transfer.length === 1 && transfer[0] === m.pixels, "under transfer the frame is in its transfer list");
  check(new Uint16Array(m.pixels).join() === "1,2" && m.min === 1 && m.max === 2, "under transfer the samples and range are the decoder's");
}

/** A posted frame's memory is never written again: the next frame lands in a buffer of its own, so a reader of the
 *  shared buffer (the store worker under C with shared memory) sees the samples as decoded. */
{
  const [first, second] = await framesUnder(undefined, [[1, 0, 2, 0], [3, 0, 4, 0]]);
  check(first.m.pixels !== second.m.pixels, "each frame has a buffer of its own");
  check(new Uint16Array(first.m.pixels).join() === "1,2", "a posted frame's samples are unchanged by the next decode");
}

/** A decoder started again without the setting goes back to shared frames. */
check((await frameUnder(undefined)).m.pixels instanceof SharedArrayBuffer, "a later start without the setting is shared again");

console.log(failed ? `${failed} failed` : "decoder frame buffer: ok");
process.exit(failed ? 1 : 0);
