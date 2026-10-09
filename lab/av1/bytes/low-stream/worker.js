// A frame coded as plane parts behind decoder.js's protocol: each part decoded by its own codec
// (dav1d-WASM, WebCodecs, OpenJPH, or k-bit samples packed raw or deflated), shifted, OR-ed together,
// then the offset undone or the reversible colour transform inverted, with the range.
// Frame file: [u8 n][u32le length × n][part × n]. lab/av1/bytes/low-stream/README.md
let arm = null;
let toConsumer = null;
const abs = () => performance.timeOrigin + performance.now();

function parts(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  const n = bytes[0];
  let at = 1 + 4 * n;
  return Array.from({ length: n }, (_, i) => {
    const len = dv.getUint32(1 + 4 * i, true);
    return bytes.subarray(at, (at += len));
  });
}

const FORMATS = { I420: [8, 1], I420P10: [10, 1], I444: [8, 3], I444P10: [10, 3] };

function webcodecs(codec) {
  let pending = null;
  const dec = new VideoDecoder({ output: (f) => pending.resolve(f), error: (e) => pending.reject(e) });
  dec.configure({ codec, hardwareAcceleration: "prefer-software", optimizeForLatency: true });
  return async (unit) => {
    const out = new Promise((resolve, reject) => (pending = { resolve, reject }));
    dec.decode(new EncodedVideoChunk({ type: "key", timestamp: 0, data: unit }));
    const frame = await out;
    const [bits, components] = FORMATS[frame.format] ?? [];
    if (!bits) throw new Error(`undecodable: ${frame.format}`);
    const buf = new ArrayBuffer(frame.allocationSize());
    const layout = await frame.copyTo(buf);
    const { width, height } = frame.visibleRect;
    frame.close();
    // copyTo's layout is in bytes.
    const s = bits > 8 ? 1 : 0;
    const heap = s ? new Uint16Array(buf) : new Uint8Array(buf);
    return { width, height, planes: layout.slice(0, components).map((p) => ({ heap, offset: p.offset >> s, stride: p.stride >> s, step: 1 })) };
  };
}

async function dav1d(m) {
  const src = await (await fetch(m.glue)).text();
  const factory = new Function(`${src}\nreturn Dav1dModule;`).call(self);
  const M = await factory({ locateFile: (f) => m.dir + "/" + f, wasmBinary: await (await fetch(m.wasm)).arrayBuffer() });
  if (M._av1_open(1) < 0) throw new Error("dav1d_open");
  let ptr = 0;
  let cap = 0;
  return (unit, channels) => {
    if (unit.length > cap) {
      if (ptr) M._free(ptr);
      cap = unit.length;
      ptr = M._malloc(cap);
    }
    M.HEAPU8.set(unit, ptr);
    M._av1_flush();
    const r = M._av1_decode(ptr, unit.length);
    if (r < 0) throw new Error(`undecodable: dav1d ${r}`);
    const s = M._av1_bits() > 8 ? 1 : 0;
    const heap = s ? M.HEAPU16 : M.HEAPU8;
    // Views of the decoder's picture: valid until its next decode.
    const planes = Array.from({ length: channels }, (_, c) => ({ heap, offset: M._av1_plane(c) >> s, stride: Number(M._av1_stride(c)) >> s, step: 1 }));
    return { width: M._av1_width(), height: M._av1_height(), planes };
  };
}

async function openjph(m) {
  const src = await (await fetch(m.glue)).text();
  const factory = new Function(`${src}\nreturn typeof Module !== "undefined" ? Module : OpenJPHModule;`).call(self);
  const M = await factory({ locateFile: (f) => m.dir + "/" + f, wasmBinary: await (await fetch(m.wasm)).arrayBuffer() });
  const dec = new M.HTJ2KDecoder();
  return (unit, channels) => {
    dec.getEncodedBuffer(unit.length).set(unit);
    dec.readHeader();
    const info = dec.getFrameInfo();
    dec.decode();
    const out = dec.getDecodedBuffer();
    const heap = info.bitsPerSample > 8 ? new Uint16Array(out.buffer, out.byteOffset, out.length >> 1) : out;
    const stride = info.width * channels;
    return { width: info.width, height: info.height, planes: Array.from({ length: channels }, (_, c) => ({ heap, offset: c, stride, step: channels })) };
  };
}

/** k-bit samples, MSB first, channels interleaved in raster order. */
function unpack(bytes, k, width, height, channels) {
  const n = width * height * channels;
  const heap = new Uint8Array(n);
  if (k === 2) {
    for (let i = 0, j = 0; i < n; j++) {
      const b = bytes[j];
      heap[i++] = b >> 6;
      heap[i++] = (b >> 4) & 3;
      heap[i++] = (b >> 2) & 3;
      heap[i++] = b & 3;
    }
  } else {
    let acc = 0;
    let have = 0;
    for (let i = 0, j = 0; i < n; i++) {
      if (have < k) {
        acc = ((acc << 8) | bytes[j++]) & 0xffff;
        have += 8;
      }
      have -= k;
      heap[i] = (acc >> have) & ((1 << k) - 1);
    }
  }
  const stride = width * channels;
  return { width, height, planes: Array.from({ length: channels }, (_, c) => ({ heap: heap.subarray(0, n), offset: c, stride, step: channels })) };
}

async function inflate(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
}

/** acc[(y·w + x)·ch + c] |= sample << shift, every plane of the picture. */
function place(acc, pic, shift, first, channels) {
  const { width, height } = pic;
  for (let c = 0; c < channels; c++) {
    const { heap, offset, stride, step } = pic.planes[c];
    for (let y = 0; y < height; y++) {
      let s = offset + y * stride;
      let o = y * width * channels + c;
      if (first) for (let x = 0; x < width; x++, s += step, o += channels) acc[o] = heap[s] << shift;
      else for (let x = 0; x < width; x++, s += step, o += channels) acc[o] |= heap[s] << shift;
    }
  }
}

function finish(acc, a) {
  const range = { min: Infinity, max: -Infinity };
  const n = acc.length;
  if (a.channels === 1) {
    const sab = new SharedArrayBuffer(n * 2);
    const out = a.signed ? new Int16Array(sab) : new Uint16Array(sab);
    for (let i = 0; i < n; i++) {
      const v = acc[i] - a.offset;
      out[i] = v;
      if (v < range.min) range.min = v;
      if (v > range.max) range.max = v;
    }
    return { sab, range };
  }
  // The reversible colour transform's inverse, R G B out of Y, Cb + 256, Cr + 256.
  const sab = new SharedArrayBuffer(n);
  const out = new Uint8Array(sab);
  for (let i = 0; i < n; i += 3) {
    const cb = acc[i + 1] - 256;
    const cr = acc[i + 2] - 256;
    const g = acc[i] - ((cb + cr) >> 2);
    out[i] = cr + g;
    out[i + 1] = g;
    out[i + 2] = cb + g;
  }
  return { sab, range: { min: 0, max: 255 } };
}

async function decodeFrame(bytes) {
  const units = parts(bytes);
  const { width, height, channels } = arm;
  // WebCodecs and the inflates run beside the WASM decoders; a WASM decoder's picture is read before its next decode.
  const async = arm.parts.map((p, i) => (p.codec === "wc" ? p.decode(units[i]) : p.codec === "deflate" ? inflate(units[i]) : null));
  const acc = arm.acc;
  for (const [i, p] of arm.parts.entries()) {
    let pic;
    if (p.codec === "wc") pic = await async[i];
    else if (p.codec === "deflate") pic = unpack(await async[i], p.bits, width, height, channels);
    else if (p.codec === "raw") pic = unpack(units[i], p.bits, width, height, channels);
    else pic = p.decode(units[i], channels);
    place(acc, pic, p.shift, i === 0, channels);
  }
  return finish(acc, arm);
}

onmessage = async (e) => {
  const m = e.data;
  if (m.kind === "init") {
    toConsumer = m.toConsumer;
    const d = m.decoder;
    try {
      const wasm = {};
      for (const p of d.parts) {
        if (p.codec === "dav1d") p.decode = wasm.dav1d ??= await dav1d(d.dav1d);
        if (p.codec === "j2k") p.decode = wasm.j2k ??= await openjph(d.openjph);
        if (p.codec === "wc") p.decode = webcodecs(p.webcodecs);
      }
      arm = { ...d, acc: new Int32Array(d.width * d.height * d.channels) };
      postMessage({ kind: "ready" });
    } catch (err) {
      postMessage({ kind: "init-failed", reason: String(err?.message ?? err) });
    }
    return;
  }
  const stamps = { decodeStart: abs() };
  try {
    const { sab, range } = await decodeFrame(m.bytes);
    stamps.decodeEnd = abs();
    toConsumer.postMessage({ kind: "frame", index: m.index, pixels: sab, width: arm.width, height: arm.height, min: range.min, max: range.max, stamps });
  } catch (err) {
    postMessage({ kind: "failed", index: m.index, reason: String(err?.message ?? err) });
  }
};
