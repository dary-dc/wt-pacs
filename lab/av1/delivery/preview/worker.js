// One arm of PREVIEW's decode timing in a worker of its own: a whole cine decoded in order, the
// clock from the first chunk handed over to the last frame's planes copied out. Hashed after.
import { createDecoder } from "../../../../client/decode/wasm/dav1d/dav1d.mjs";

const fetchBytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());

async function hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Planes tightly packed, one buffer a frame: Y alone for grey, Y U V for colour. */
function packed(planes) {
  const out = new Uint8Array(planes.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of planes) {
    out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), at);
    at += p.byteLength;
  }
  return out;
}

async function loadScript(url, name) {
  const src = await (await fetch(url)).text();
  return new Function(`${src}\nreturn ${name};`).call(self);
}

const ARMS = {
  async dav1d({ base }) {
    const factory = await loadScript(`${base}/lab/.av1-build/out/simd.js`, "Dav1dModule");
    const wasmBinary = await (await fetch(`${base}/lab/.av1-build/out/simd.wasm`)).arrayBuffer();
    const dec = await createDecoder(factory, { wasmBinary });
    return async (units) => units.map((u) => packed(dec.decode(u).planes));
  },

  async webcodecs({ codec, grey }) {
    return async (units, group) => {
      const frames = [];
      const copies = [];
      let failure = null;
      const decoder = new VideoDecoder({
        output: (f) => {
          const n = grey ? 1 : 3;
          const rects = [];
          for (let p = 0; p < n; p++) {
            const w = p ? Math.ceil(f.codedWidth / 2) : f.codedWidth;
            const h = p ? Math.ceil(f.codedHeight / 2) : f.codedHeight;
            rects.push([w, h]);
          }
          const bps = f.format.endsWith("P10") ? 2 : 1;
          const buf = new Uint8Array(f.allocationSize());
          copies.push(f.copyTo(buf).then((layout) => {
            f.close();
            const out = new Uint8Array(rects.reduce((s, [w, h]) => s + w * h * bps, 0));
            let at = 0;
            rects.forEach(([w, h], p) => {
              for (let y = 0; y < h; y++, at += w * bps) {
                const s = layout[p].offset + y * layout[p].stride;
                out.set(buf.subarray(s, s + w * bps), at);
              }
            });
            frames.push(out);
          }));
        },
        error: (e) => (failure = e),
      });
      decoder.configure({ codec, hardwareAcceleration: "prefer-software" });
      units.forEach((u, i) => decoder.decode(new EncodedVideoChunk(
        { type: i % group ? "delta" : "key", timestamp: i * 40000, data: u })));
      await decoder.flush();
      await Promise.all(copies);
      decoder.close();
      if (failure) throw failure;
      return frames;
    };
  },

  async htj2k({ base, level }) {
    const factory = await loadScript(`${base}/client/decode/wasm/vendor/openjph/openjphjs.js`, "Module");
    const wasmBinary = await (await fetch(`${base}/client/decode/wasm/vendor/openjph/openjphjs.wasm`)).arrayBuffer();
    const M = await factory({ wasmBinary });
    const d = new M.HTJ2KDecoder();
    return async (units) => units.map((u) => {
      d.getEncodedBuffer(u.length).set(u);
      d.readHeader();
      if (level) d.decodeSubResolution(level);
      else d.decode();
      return d.getDecodedBuffer().slice();
    });
  },
};

onmessage = async ({ data: o }) => {
  try {
    const units = (await Promise.all(o.urls.map(fetchBytes))).map((u, i) => (o.lengths ? u.subarray(0, o.lengths[i]) : u));
    const run = await ARMS[o.arm](o);
    await run(units.slice(0, o.group), o.group);  // warm-up: the first group, untimed
    const t0 = performance.now();
    const frames = await run(units, o.group);
    const ms = performance.now() - t0;
    const hashes = [];
    for (const f of frames) hashes.push(await hex(f));
    postMessage({ ms, hashes });
  } catch (e) {
    postMessage({ error: String(e?.message ?? e) });
  }
};
