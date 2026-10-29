// node client/decode/decoder.test.mjs — decoder.js and htj2k.js as built, over a stand-in OpenJPH glue: the frame's buffer and its transfer list.
const GLUE = `var OpenJPHModule = () => ({ HTJ2KDecoder: class {
  getEncodedBuffer(n) { return new Uint8Array(n); }
  readHeader() {}
  getFrameInfo() { return { width: 2, height: 1, componentCount: 1, bitsPerSample: 12, isSigned: false }; }
  decode() {}
  getDecodedBuffer() { return new Uint8Array([1, 0, 2, 0]); }
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

/** One frame decoded under `pixels`: what reached the consumer, and the transfer list it rode with. */
async function frameUnder(pixels) {
  const sent = [];
  const ready = next();
  onmessage({ data: { kind: "init", toConsumer: { postMessage: (m, transfer = []) => sent.push({ m, transfer }) }, decoder: { glue: "g", wasm: "w" }, pixels } });
  check((await ready).kind === "ready", `the decoder starts under pixels=${pixels}`);
  const done = next();
  onmessage({ data: { kind: "decode", index: 0, gen: 0, bytes: new Uint8Array(4), stamps: {} } });
  check((await done).kind === "done", `the frame decodes under pixels=${pixels}`);
  return sent[0];
}

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

/** A decoder started again without the setting goes back to shared frames. */
check((await frameUnder(undefined)).m.pixels instanceof SharedArrayBuffer, "a later start without the setting is shared again");

console.log(failed ? `${failed} failed` : "decoder frame buffer: ok");
process.exit(failed ? 1 : 0);
