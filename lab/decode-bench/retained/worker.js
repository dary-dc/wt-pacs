// One decoder instance and everything it retains. docs/decode/README.md §Retained-frame residency.
let M = null;
let reused = null;
const kept = [];    // arrangement "heap": the decoder objects, never deleted
const copies = [];  // arrangements "plain" / "shared": buffers outside the WASM heap

function decodeFrame(bytes, arrangement, lifetime) {
  const d = lifetime === "reused" ? (reused ||= new M.HTJ2KDecoder()) : new M.HTJ2KDecoder();
  d.getEncodedBuffer(bytes.length).set(bytes);
  d.readHeader();
  d.decode();
  if (arrangement === "heap") { kept.push(d); return; }
  const view = d.getDecodedBuffer();
  if (arrangement === "plain") {
    copies.push(view.slice());
  } else {
    const sab = new SharedArrayBuffer(view.length);
    new Uint8Array(sab).set(view);
    copies.push(new Uint8Array(sab));
  }
  if (lifetime !== "reused") d.delete();
}

// The source build exports no HEAPU8; an emscripten typed_memory_view is backed by the WASM
// memory itself, so its buffer measures the heap on either build, the same way.
function heapBytes() {
  const d = new M.HTJ2KDecoder();
  try { return d.getEncodedBuffer(1).buffer.byteLength; } finally { d.delete(); }
}

async function sha256(bytes) {
  // A view into WASM memory or a SharedArrayBuffer is not a valid digest source; copy first.
  const flat = new Uint8Array(bytes.length);
  flat.set(bytes);
  const h = await crypto.subtle.digest("SHA-256", flat);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    importScripts(m.glue);
    const factory = self.Module || self.OpenJPHModule;
    // The source build is linked ENVIRONMENT=node,worker and has no browser path to its own
    // .wasm, so hand it the bytes, as decoder.mjs does in Node.
    const wasmBinary = await (await fetch(m.wasm)).arrayBuffer();
    M = await factory({ wasmBinary, locateFile: (f) => m.dir + "/" + f });
    postMessage({ kind: "ready", heap: heapBytes() });
    return;
  }
  if (m.kind === "decode") {
    const t = performance.now();
    decodeFrame(m.bytes, m.arrangement, m.lifetime);
    postMessage({ kind: "decoded", seq: m.seq, heap: heapBytes(), ms: performance.now() - t });
    return;
  }
  if (m.kind === "verify") {
    // Re-derive every heap view now: growth detaches the ones taken at decode time.
    const out = [];
    for (const [i, d] of kept.entries()) out.push([m.seqs[i], await sha256(d.getDecodedBuffer())]);
    for (const [i, b] of copies.entries()) out.push([m.seqs[i], await sha256(b)]);
    postMessage({ kind: "verified", hashes: out });
  }
};
