// A split frame behind decoder.js's protocol: its top and low temporal units decoded, merged as
// (top << shift | low) - offset into a SharedArrayBuffer with the range, as the contract returns.
// mode "webcodecs": two VideoDecoders, the two units in flight together; mode "dav1d": one
// dav1d-WASM instance, unit after unit. Frame file: [u32le top length][top][low].
let d = null;
let toConsumer = null;
const abs = () => performance.timeOrigin + performance.now();

function units(bytes) {
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
  return [bytes.subarray(4, 4 + n), bytes.subarray(4 + n)];
}

async function webcodecs(codec) {
  let pending = null;
  const dec = new VideoDecoder({ output: (f) => pending.resolve(f), error: (e) => pending.reject(e) });
  dec.configure({ codec, hardwareAcceleration: "prefer-software" });
  return async (unit) => {
    const out = new Promise((resolve, reject) => (pending = { resolve, reject }));
    dec.decode(new EncodedVideoChunk({ type: "key", timestamp: 0, data: unit }));
    await dec.flush();
    const frame = await out;
    const wide = frame.format === "I420P10";
    if (!wide && frame.format !== "I420") throw new Error(`undecodable: ${frame.format}`);
    const buf = new ArrayBuffer(frame.allocationSize());
    const [luma] = await frame.copyTo(buf);
    // copyTo's layout is in bytes.
    const s = wide ? 1 : 0;
    const plane = { width: frame.codedWidth, height: frame.codedHeight, offset: luma.offset >> s, stride: luma.stride >> s };
    frame.close();
    return { ...plane, heap: wide ? new Uint16Array(buf) : new Uint8Array(buf) };
  };
}

async function dav1d(m) {
  const src = await (await fetch(m.glue)).text();
  const factory = new Function(`${src}\nreturn Dav1dModule;`).call(self);
  const M = await factory({ locateFile: (f) => m.dir + "/" + f, wasmBinary: await (await fetch(m.wasm)).arrayBuffer() });
  if (M._av1_open(1) < 0) throw new Error("dav1d_open");
  let ptr = 0;
  let cap = 0;
  return (unit) => {
    if (unit.length > cap) {
      if (ptr) M._free(ptr);
      cap = unit.length;
      ptr = M._malloc(cap);
    }
    M.HEAPU8.set(unit, ptr);
    M._av1_flush();
    const r = M._av1_decode(ptr, unit.length);
    if (r < 0) throw new Error(`undecodable: dav1d ${r}`);
    const wide = M._av1_bits() > 8;
    const s = wide ? 1 : 0;
    // A view of the decoder's picture: valid until the next decode.
    return { width: M._av1_width(), height: M._av1_height(), offset: M._av1_plane(0) >> s,
      stride: Number(M._av1_stride(0)) >> s, heap: wide ? M.HEAPU16 : M.HEAPU8 };
  };
}

/** out = top << shift on the first plane, then (out | low) - offset and the range on the second. */
function merge(out, p, shift, offset, range) {
  const { width, height, heap, stride } = p;
  for (let y = 0; y < height; y++) {
    let s = p.offset + y * stride;
    let o = y * width;
    if (!range) for (let x = 0; x < width; x++) out[o++] = heap[s++] << shift;
    else {
      for (let x = 0; x < width; x++) {
        const v = (out[o] | heap[s++]) - offset;
        out[o++] = v;
        if (v < range.min) range.min = v;
        if (v > range.max) range.max = v;
      }
    }
  }
}

async function decodeFrame(bytes) {
  const [top, low] = units(bytes);
  // WebCodecs decodes both at once; dav1d's second decode replaces the first's picture, so it waits.
  const lowDone = d.parallel ? d.low(low) : null;
  const a = await d.top(top);
  const sab = new SharedArrayBuffer(a.width * a.height * 2);
  const out = d.signed ? new Int16Array(sab) : new Uint16Array(sab);
  merge(out, a, d.shift, 0, null);
  const range = { min: Infinity, max: -Infinity };
  merge(out, await (lowDone ?? d.low(low)), 0, d.offset, range);
  return { sab, width: a.width, height: a.height, range };
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    const c = m.decoder;
    try {
      const [top, low] = c.mode === "webcodecs"
        ? await Promise.all([webcodecs(c.codecs[0]), webcodecs(c.codecs[1])])
        : await dav1d(c).then((one) => [one, one]);
      d = { top, low, parallel: c.mode === "webcodecs", shift: c.shift, offset: c.offset, signed: c.signed };
      postMessage({ kind: "ready" });
    } catch (err) {
      postMessage({ kind: "init-failed", reason: String(err?.message ?? err) });
    }
    return;
  }
  const stamps = { decodeStart: abs() };
  try {
    const { sab, width, height, range } = await decodeFrame(m.bytes);
    stamps.decodeEnd = abs();
    toConsumer.postMessage({ kind: "frame", index: m.index, pixels: sab, width, height, min: range.min, max: range.max, stamps });
  } catch (err) {
    postMessage({ kind: "failed", index: m.index, reason: String(err?.message ?? err) });
  }
};
