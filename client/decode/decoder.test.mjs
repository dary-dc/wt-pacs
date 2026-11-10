// node client/decode/decoder.test.mjs — decoder.js over stand-in OpenJPH and dav1d glues: the frame's buffer and its transfer list, and the route an optimal-quality frame names.
import { readFileSync } from "node:fs";

const GLUE = `var OpenJPHModule = () => ({ HTJ2KDecoder: class {
  getEncodedBuffer(n) { return new Uint8Array(n); }
  readHeader() {}
  getFrameInfo() { return { width: 2, height: 1, componentCount: 1, bitsPerSample: 12, isSigned: false }; }
  decode() {}
  getDecodedBuffer() { return new Uint8Array([1, 0, 2, 0]); }
} });`;
// A 1×1 10-bit grey dav1d: every unit decodes to sample 7.
const DAV1D = `var Dav1dModule = () => ({ HEAPU8: new Uint8Array(1 << 16), HEAPU16: Uint16Array.of(7), _malloc: () => 0, _free() {},
  _av1_open: () => 0, _av1_flush() {}, _av1_decode: () => 0, _av1_top_layer: () => 0, _av1_layer: () => 0, _av1_layout: () => 0,
  _av1_bits: () => 10, _av1_plane: () => 0, _av1_stride: () => 1, _av1_width: () => 1, _av1_height: () => 1, _av1_matrix: () => 0 });`;
globalThis.fetch = async (url) => new Response(String(url).includes("dav1d") ? DAV1D : GLUE);

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

/** An optimal-quality frame dav1d decoded reaches the consumer with why WebCodecs did not take it, for the overlay. */
{
  const sent = [];
  const ready = next();
  onmessage({ data: { kind: "init", toConsumer: { postMessage: (m) => sent.push(m) }, decoder: { codec: "av1", lossy: true, glue: "dav1d.js", wasm: "dav1d.wasm" } } });
  check((await ready).kind === "ready", "an optimal-quality AV1 decoder starts");
  const bytes = new Uint8Array(readFileSync(new URL("../contract/av1/payloads/plain/g10.av1", import.meta.url)));
  const done = next();
  onmessage({ data: { kind: "decode", index: 0, gen: 0, key: true, bytes, stamps: {} } });
  const d = await done;
  check(d.kind === "done", `the optimal-quality frame decodes (${d.reason})`);
  check(sent[0]?.path === "av1-dav1d" && sent[0]?.refusal === "no VideoDecoder", `its frame names the route and the refusal (${sent[0]?.path}; ${sent[0]?.refusal})`);
}

console.log(failed ? `${failed} failed` : "decoder frame buffer: ok");
process.exit(failed ? 1 : 0);
