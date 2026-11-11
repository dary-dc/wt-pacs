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
// The frame check's hasher and the build manifest are the repository's own files.
globalThis.fetch = async (url) => {
  const path = String(url).replace(/^file:\/\//, "");
  return new Response(path.startsWith("/") ? readFileSync(path) : path.includes("dav1d") ? DAV1D : GLUE);
};

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

/**
 * An optimal-quality frame with a reconstruction digest: matched, `asCoded` true and `exact` still "unchecked"; not matched,
 * `asCoded` false with the route's digest named. Inside a group the decoder keeps the group's payloads from its keyframe for
 * the second decode. docs/av1/payload-format.md §Integrity
 */
{
  const { hasher } = await import("./xxh3.js");
  const seven = (await hasher()).init().update(Uint8Array.of(7, 0)).digest("hex");
  const wrong = "0123456789abcdef";
  const bytes = new Uint8Array(readFileSync(new URL("../contract/av1/payloads/plain/g10.av1", import.meta.url)));
  const run = async (checks, frames, groupLength = 1) => {
    const sent = [];
    const ready = next();
    onmessage({ data: { kind: "init", toConsumer: { postMessage: (m) => sent.push(m) }, decoder: { codec: "av1", lossy: true, glue: "dav1d.js", wasm: "dav1d.wasm" }, groupLength, ...checks } });
    await ready;
    for (const [index, key] of frames) {
      const done = next();
      onmessage({ data: { kind: "decode", index, gen: 0, key, bytes: bytes.slice(), stamps: {} } });
      await done;
    }
    return sent.at(-1) ?? {};
  };
  let f = await run({ reconstruction: [seven] }, [[0, true]]);
  check(f.asCoded === true && f.exact === "unchecked", `a matched reconstruction digest: as coded, still not exact (${f.asCoded}, ${f.exact})`);
  f = await run({ reconstruction: [wrong] }, [[0, true]]);
  check(f.asCoded === false && f.exact === "unchecked" && f.reason?.includes(`av1-dav1d gave ${seven}, not ${wrong}`) && f.reason?.includes("no WebCodecs decoder"),
    `an unmatched one: not as coded, each route named (${f.asCoded}; ${f.reason})`);
  f = await run({}, [[0, true]]);
  check(f.asCoded === undefined && f.exact === "unchecked", `no reconstruction digest: unchecked, nothing said of coding (${f.asCoded}, ${f.exact})`);
  f = await run({ digests: [seven] }, [[0, true]]);
  check(f.exact === true && f.asCoded === undefined, `a frame digest still makes a frame exact, and says nothing of coding (${f.exact}, ${f.asCoded})`);
  f = await run({ reconstruction: [seven, wrong, seven, wrong] }, [[0, true], [1, false]], 4);
  check(f.asCoded === false && f.reason?.includes("decoded again on dav1d only"), `inside a group, its payloads were kept for the second decode (${f.reason})`);
  f = await run({ digests: [seven, wrong] }, [[0, true], [1, false]], 4);
  check(f.exact === false && f.reason?.includes("group was not kept"), `without a reconstruction digest no group is kept (${f.reason})`);
}

console.log(failed ? `${failed} failed` : "decoder frame buffer: ok");
process.exit(failed ? 1 : 0);
