// A decoder worker as the product's: a frame decoded, copied into a SharedArrayBuffer, then hashed by one arm.
let d, hw;
const hashers = {};
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Each arm's digest of a frame's samples as lowercase hex, compared with make_truth.py's of the encoder's input. */
const ARMS = {
  // WebCrypto refuses a view of shared memory, so this arm pays a copy out of it.
  "sha256-webcrypto": async (v) => hex(await crypto.subtle.digest("SHA-256", v.slice())),
  "sha256-wasm": (v) => hashers.sha256.init().update(v).digest("hex"),
  "blake3-wasm": (v) => hashers.blake3.init().update(v).digest("hex"),
  "xxh3-wasm": (v) => hashers.xxh3.init().update(v).digest("hex"),
  "crc32-wasm": (v) => hashers.crc32.init().update(v).digest("hex"),
};
const TRUTH = { "sha256-webcrypto": "truth", "sha256-wasm": "truth", "blake3-wasm": "blake3", "xxh3-wasm": "xxh3", "crc32-wasm": "crc32" };

async function load(glue, hashWasm) {
  if (d) return;
  importScripts(glue, hashWasm);
  const M = await (typeof Module !== "undefined" ? Module : OpenJPHModule)({ locateFile: (f) => glue.replace(/[^/]*$/, f), mainScriptUrlOrBlob: glue });
  d = new M.HTJ2KDecoder();
  hw = globalThis.hashwasm;
  Object.assign(hashers, { sha256: await hw.createSHA256(), blake3: await hw.createBLAKE3(),
    xxh3: await hw.createXXHash3(), crc32: await hw.createCRC32() });
}

/** The codestream to samples in shared memory, as decodeFrame hands them to the consumer. */
function decode(bytes) {
  d.getEncodedBuffer(bytes.length).set(bytes);
  d.readHeader();
  d.decode();
  const heap = d.getDecodedBuffer();
  const out = new Uint8Array(new SharedArrayBuffer(heap.length));
  out.set(heap);
  return out;
}

/** One set: every arm's digest of every frame checked, then `passes` timed passes an arm, arms in `order`. */
async function bench({ urls, raw, frames, order, passes, mutate }) {
  const coded = await Promise.all(urls.map(async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer())));
  const samples = raw ? coded.map((b) => { const s = new Uint8Array(new SharedArrayBuffer(b.length)); s.set(b); return s; })
    : coded.map(decode);
  if (mutate) for (const s of samples) s[s.length >> 1] ^= 1;
  const exact = {}, ms = {};
  for (const a of order) {
    exact[a] = 0;
    ms[a] = [];
    if (a === "decode") {
      if (raw) continue;
      for (let i = 0; i < coded.length; i++) {
        const s = decode(coded[i]);
        if (mutate) s[s.length >> 1] ^= 1;
        if ((await ARMS["sha256-webcrypto"](s)) === frames[i].truth) exact.decode++;
      }
      for (let p = 0; p < passes; p++) for (const c of coded) { const t0 = performance.now(); decode(c); ms.decode.push(performance.now() - t0); }
      continue;
    }
    for (let i = 0; i < samples.length; i++) if ((await ARMS[a](samples[i])) === frames[i][TRUTH[a]]) exact[a]++;
    for (let p = 0; p < passes; p++) for (const s of samples) { const t0 = performance.now(); await ARMS[a](s); ms[a].push(performance.now() - t0); }
  }
  return { exact, ms };
}

/** A pool decoder: one frame, decoded, hashed by `arm` before it is handed on (none: not checked). */
async function one({ bytes, arm, frame, mutate }) {
  const s = decode(bytes);
  if (mutate) s[s.length >> 1] ^= 1;
  const decoded = performance.timeOrigin + performance.now();
  const ok = arm === "none" ? null : (await ARMS[arm](s)) === frame[TRUTH[arm]];
  return { decoded, handed: performance.timeOrigin + performance.now(), ok };
}

onmessage = async ({ data: m }) => {
  try {
    await load(m.glue, m.hashWasm);
    postMessage(m.kind === "bench" ? await bench(m) : m.kind === "one" ? await one(m) : {});
  } catch (e) { postMessage({ error: String(e?.stack ?? e) }); }
};
