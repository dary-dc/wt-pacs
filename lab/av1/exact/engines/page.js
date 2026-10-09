/**
 * One engine's share of a round, run by the page itself so any browser that opens a URL can take it:
 * what the engine offers, then every set's every arm through the product's decoder worker, each frame
 * timed by the worker's stamps and hashed against its truth. run.mjs serves and drives it.
 */
import { order } from "/lab/order.mjs";

const post = (path, body) => fetch(path, { method: "POST", body: JSON.stringify(body) });

/** wasm-feature-detect's SIMD probe: a function returning a v128. */
const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const CODECS = ["av01.0.04M.08", "av01.0.04M.10", "av01.1.04M.08", "av01.1.04M.10", "av01.2.04M.12"];

async function caps() {
  const c = { ua: navigator.userAgent, isolated: crossOriginIsolated, sab: typeof SharedArrayBuffer === "function",
    simd: WebAssembly.validate(SIMD), videoDecoder: typeof VideoDecoder === "function", configs: {} };
  let tick = Infinity;
  for (let i = 0, a = performance.now(); i < 1e6 && tick === Infinity; i++) {
    const b = performance.now();
    if (b > a) tick = b - a;
  }
  c.clockMs = tick;
  c.worker = await new Promise((resolve) => {
    const w = new Worker("probe-worker.js", { type: "module" });
    w.onmessage = (e) => (resolve(e.data), w.terminate());
    w.onerror = (e) => resolve({ error: e.message });
  });
  for (const codec of c.videoDecoder ? CODECS : []) {
    // The product's own configuration: decode-av1-webcodecs.js.
    const config = { codec, hardwareAcceleration: "prefer-software", optimizeForLatency: true };
    c.configs[codec] = await VideoDecoder.isConfigSupported(config).then((r) => r.supported, (e) => `throws ${e.name}`);
  }
  return c;
}

const MUTATE = { sample: false, truth: false };

async function sha256(sab) {
  // SubtleCrypto refuses a view on shared memory.
  const copy = new Uint8Array(sab.byteLength);
  copy.set(new Uint8Array(sab));
  if (MUTATE.sample) copy[copy.length >> 1] ^= 1;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A decoder worker as the downloader drives one: init, then one frame in flight at a time. */
async function start(decoder) {
  const worker = new Worker("worker.js", { type: "module" });
  const { port1, port2 } = new MessageChannel();
  let frame = null;
  let reply = null;
  const wait = () => {
    const f = new Promise((resolve) => (frame = resolve));
    const r = new Promise((resolve, reject) => (reply = { resolve, reject }));
    return { f, r };
  };
  worker.onmessage = ({ data: m }) => {
    if (m.kind === "ready" || m.kind === "done") reply.resolve(m);
    if (m.kind === "init-failed" || m.kind === "failed") reply.reject(Object.assign(new Error(m.reason), { units: m.webcodecsUnits }));
  };
  worker.onerror = (e) => reply.reject(new Error(`worker: ${e.message}`));
  port2.onmessage = ({ data: m }) => m.kind === "frame" && !m.preview && frame(m);
  const init = wait();
  worker.postMessage({ kind: "init", toConsumer: port1, decoder }, [port1]);
  await init.r;
  return {
    async decode(bytes, index) {
      const w = wait();
      const copy = bytes.slice();
      worker.postMessage({ kind: "decode", index, gen: 0, key: true, bytes: copy, stamps: {} }, [copy.buffer]);
      const done = await w.r;
      const f = await w.f;
      return { ms: f.stamps.decodeEnd - f.stamps.decodeStart, pixels: f.pixels, units: done.webcodecsUnits };
    },
    close: () => (worker.terminate(), port2.close()),
  };
}

const decoderOf = (name, arm) => {
  const { ext, ...fields } = arm;
  if (name === "htj2k") {
    const dir = `${location.origin}/client/decode/wasm/vendor/openjph`;
    return { glue: `${dir}/openjphjs.js`, wasm: `${dir}/openjphjs.wasm`, dir };
  }
  const dir = `${location.origin}/lab/.av1-build/out`;
  return { codec: "av1", glue: `${dir}/simd.js`, wasm: `${dir}/simd.wasm`, dir, ...fields };
};

/** rows: { set, arm, ms[], exact, frames, units, error? }; `units` is how many reached WebCodecs. */
async function run({ frames: dir, round, mutate = [], warm = 1 }) {
  for (const k of mutate) MUTATE[k] = true;
  const manifest = await (await fetch(`/${dir}/manifest.json`)).json();
  const rows = [];
  for (const set of order(manifest, round)) {
    const truth = set.frames.map((f) => (MUTATE.truth ? f.truth.replace(/^./, (c) => (c === "0" ? "1" : "0")) : f.truth));
    for (const name of order(Object.keys(set.arms), round)) {
      const arm = set.arms[name];
      const bytes = await Promise.all(set.frames.map((_, i) =>
        fetch(`/${dir}/${set.name}/${String(i).padStart(3, "0")}.${arm.ext ?? name}`)
          .then((x) => x.arrayBuffer()).then((b) => new Uint8Array(b))));
      const row = { set: set.name, arm: name, ms: [], exact: 0, frames: bytes.length, units: 0 };
      let dec = null;
      try {
        dec = await start(decoderOf(name, arm));
        for (let i = 0; i < warm; i++) await dec.decode(bytes[0], -1);
        for (let i = 0; i < bytes.length; i++) {
          const { ms, pixels, units } = await dec.decode(bytes[i], i);
          row.ms.push(ms);
          row.units = units;
          if ((await sha256(pixels)) === truth[i]) row.exact++;
        }
      } catch (e) {
        row.error = String(e?.message ?? e);
        if (e?.units !== undefined) row.units = e.units;
      }
      dec?.close();
      rows.push(row);
    }
  }
  return rows;
}

const hex = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Each WebCodecs arm's first frame straight into VideoDecoder: what the engine returns, and an 8-bit RGB frame's samples against the truth. */
async function probe({ frames: dir }) {
  const manifest = await (await fetch(`/${dir}/manifest.json`)).json();
  const controls = await fetch(`/${dir}/control.json`).then((r) => (r.ok ? r.json() : []));
  const sets = [{ name: "control", arms: Object.fromEntries(controls.map((c) => [c, { ext: "obu", depth: 10 }])) }, ...manifest];
  const rows = [];
  for (const set of sets) {
    for (const [name, arm] of Object.entries(set.arms)) {
      if (!(arm.depth <= 10)) continue;
      const file = set.name === "control" ? `control/${name}.obu` : `${set.name}/000.${arm.ext}`;
      const bytes = new Uint8Array(await (await fetch(`/${dir}/${file}`)).arrayBuffer());
      const n = arm.split ? new DataView(bytes.buffer).getUint32(0, true) : bytes.length;
      const units = arm.split ? [bytes.subarray(4, 4 + n), bytes.subarray(4 + n)] : [bytes];
      for (const [k, unit] of units.entries()) {
        const row = { set: set.name, arm: name, unit: k ? "low" : "top" };
        try {
          const frame = await new Promise((resolve, reject) => {
            const vd = new VideoDecoder({ output: resolve, error: reject });
            vd.configure({ codec: "av01.0.04M.10", hardwareAcceleration: "prefer-software", optimizeForLatency: true });
            vd.decode(new EncodedVideoChunk({ type: "key", timestamp: 0, data: unit }));
            vd.flush().catch(reject);
          });
          Object.assign(row, { format: frame.format, coded: `${frame.codedWidth}x${frame.codedHeight}`, matrix: frame.colorSpace.matrix });
          if (/^(BGRX|RGBX|BGRA|RGBA)$/.test(frame.format) && !arm.rct && set.ch === 3) {
            const px = new Uint8Array(frame.allocationSize());
            await frame.copyTo(px);
            const rgb = new Uint8Array((px.length / 4) * 3);
            const [r, g, b] = frame.format.startsWith("BGR") ? [2, 1, 0] : [0, 1, 2];
            for (let i = 0, o = 0; i < px.length; i += 4, o += 3) (rgb[o] = px[i + r]), (rgb[o + 1] = px[i + g]), (rgb[o + 2] = px[i + b]);
            row.exactAsRgb = (await hex(rgb)) === set.frames[0].truth;
          }
          frame.close();
        } catch (e) {
          row.error = `${e?.name}: ${e?.message}`;
        }
        rows.push(row);
      }
    }
  }
  return rows;
}

try {
  const opts = await (await post("/xb/hello", await caps())).json();
  if (opts.probe) await post("/xb/result", { probe: await probe(opts) });
  else await post("/xb/result", opts.frames ? { rows: await run(opts) } : {});
} catch (e) {
  await post("/xb/result", { error: String(e?.stack ?? e) });
}
