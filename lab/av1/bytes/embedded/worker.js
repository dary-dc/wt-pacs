// One arm of EMBED's decode timing in a worker of its own: a set's frames decoded in order, the
// clock from the first codestream handed over to the last frame's samples copied out. Hashed after.
import { createJxl, createOpj } from "./codecs.mjs";

const fetchBytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());

async function hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Decoded samples (coded values) to the stored layout the checksums are of. */
function stored({ bits, signed, shift }, samples) {
  if (bits <= 8) return samples;
  const v = new Uint16Array(samples.buffer, samples.byteOffset, samples.length / 2);
  const out = signed ? new Int16Array(v.length) : new Uint16Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] - shift;
  return new Uint8Array(out.buffer);
}

async function loadScript(url, name) {
  const src = await (await fetch(url)).text();
  return new Function(`${src}\nreturn ${name};`).call(self);
}

async function module(base, file, name) {
  const factory = await loadScript(`${base}/${file}.js`, name);
  return { factory, wasmBinary: await (await fetch(`${base}/${file}.wasm`)).arrayBuffer() };
}

const ARMS = {
  async htj2k({ base }) {
    const { factory, wasmBinary } = await module(base, "client/decode/wasm/vendor/openjph/openjphjs", "Module");
    const M = await factory({ wasmBinary });
    const d = new M.HTJ2KDecoder();
    return (units) => units.map((u) => {
      d.getEncodedBuffer(u.length).set(u);
      d.readHeader();
      d.decode();
      return d.getDecodedBuffer().slice();
    });
  },

  async opj({ base }) {
    const { factory, wasmBinary } = await module(base, "lab/.av1-build/out/openjpeg", "OpjModule");
    const dec = await createOpj(factory, { wasmBinary });
    return (units) => units.map((u) => dec(u, 0).samples);
  },

  async jxl({ base }) {
    const { factory, wasmBinary } = await module(base, "lab/.av1-build/out/jxl", "JxlModule");
    const dec = await createJxl(factory, { wasmBinary });
    return (units) => units.map((u) => dec(u).samples);
  },
};

onmessage = async ({ data: o }) => {
  try {
    const units = (await Promise.all(o.urls.map(fetchBytes))).map((u, i) => (o.lengths ? u.subarray(0, o.lengths[i]) : u));
    const run = await ARMS[o.arm](o);
    run(units.slice(0, 1));  // warm-up: the first frame, untimed
    const t0 = performance.now();
    const frames = run(units);
    const ms = performance.now() - t0;
    const hashes = [];
    for (const f of frames) hashes.push(await hex(f ? stored(o, f) : new Uint8Array()));
    postMessage({ ms, hashes });
  } catch (e) {
    postMessage({ error: String(e?.message ?? e) });
  }
};
