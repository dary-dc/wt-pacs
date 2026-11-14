// One cell of D0's hardware-decode probe, in a worker the page ends if a call blocks it. lab/devices/README.md
import { codecString, sequence } from "/client/decode/av1-payload.js";
import { hasher } from "/client/decode/xxh3.js";

const REPEATS = 4;
const WAIT_MS = 5000;

const failure = (e) => ({ name: e?.name ?? typeof e, message: e?.message ?? String(e) });
const settle = (f) => Promise.resolve().then(f).then((value) => ({ value }), (e) => ({ error: failure(e) }));
let mutate = null;
let xxh = null;
let gpuDevice = null;
// The first frame `decode` kept, its unit and the unit's source planes.
let frame = null, unit = null, src = null;

function pattern(w, h, depth) {
  const top = (1 << depth) - 1;
  const v = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    v[y * w + x] = Math.min(Math.floor(((x + 3 * y) * (top + 1)) / (4 * w)) + ((x * y) & 7), top);
  }
  return v;
}

function ramp(w, h) {
  const v = new Uint16Array(w * h);
  for (let i = 0; i < v.length; i++) v[i] = Math.floor((i * 1024) / (w * h));
  return v;
}

/** The unit's source planes, at its depth; chroma is null where the stream has none (4:0:0). */
function source(u) {
  const Y = (u.samples === "ramp" ? ramp : pattern)(u.width, u.height, u.depth);
  const c = Math.ceil(u.width / 2) * Math.ceil(u.height / 2);
  const chroma = u.layout === "420" ? new Uint16Array(c).fill(1 << (u.depth - 1)) : null;
  return { Y, U: chroma, V: chroma };
}

const bytesOf = (samples, depth) => depth > 8 ? new Uint8Array(new Uint16Array(samples).buffer) : Uint8Array.from(samples);

/** The planes a copy in `format` holds: each its size, samples a pixel, depth, and the source samples it should equal. */
function planesOf(format, u, src) {
  const scale = (v, d) => (d === u.depth ? v : Math.round((v * ((1 << d) - 1)) / ((1 << u.depth) - 1)));
  const want = (p, d) => p && Array.from(p, (v) => scale(v, d));
  const cw = Math.ceil(u.width / 2), ch = Math.ceil(u.height / 2);
  if (/^(RGB|BGR)[AX]$/.test(format)) {
    const [r, b] = format.startsWith("RGB") ? [0, 2] : [2, 0];
    const Y = want(src.Y, 8);
    return [r, 1, b].map((at, k) => ({ name: "RGB"[k], w: u.width, h: u.height, every: 4, at, depth: 8, want: Y, plane: 0 }));
  }
  if (format === "NV12") {
    return [{ name: "Y", w: u.width, h: u.height, every: 1, at: 0, depth: 8, want: want(src.Y, 8) },
      { name: "U", w: cw, h: ch, every: 2, at: 0, depth: 8, want: want(src.U, 8) },
      { name: "V", w: cw, h: ch, every: 2, at: 1, depth: 8, want: want(src.V, 8), plane: 1 }];
  }
  const m = /^I4(20|22|44)(A?)(?:P(1[02]))?$/.exec(format);
  if (!m) return null;
  const d = Number(m[3] ?? 8);
  const [sx, sy] = { 20: [2, 2], 22: [2, 1], 44: [1, 1] }[m[1]];
  const c = { w: Math.ceil(u.width / sx), h: Math.ceil(u.height / sy), every: 1, at: 0, depth: d };
  // Only 4:2:0 chroma has a source to equal; another subsampling's chroma is reported, not judged.
  const sub = sx === 2 && sy === 2;
  return [{ name: "Y", w: u.width, h: u.height, every: 1, at: 0, depth: d, want: want(src.Y, d) },
    { name: "U", ...c, want: sub ? want(src.U, d) : null }, { name: "V", ...c, want: sub ? want(src.V, d) : null },
    ...(m[2] ? [{ name: "A", w: u.width, h: u.height, every: 1, at: 0, depth: d, want: null }] : [])];
}

/** One plane out of a copy: its samples, how they compare with the source, and the XXH3 of each. */
function judge(buf, layout, p, i, xxh) {
  const l = layout[p.plane ?? i];
  const bps = p.depth > 8 ? 2 : 1;
  const got = new Uint16Array(p.w * p.h);
  const view = new DataView(buf.buffer);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const o = l.offset + y * l.stride + (x * p.every + p.at) * bps;
    got[y * p.w + x] = bps === 2 ? view.getUint16(o, true) : buf[o];
  }
  const out = { plane: p.name, depth: p.depth, xxh3: xxh.hash(bytesOf(got, p.depth)), ...spread(got) };
  if (!p.want) return out;
  let differing = 0, maxDiff = 0, first = -1;
  for (let k = 0; k < got.length; k++) {
    const e = Math.abs(got[k] - p.want[k]);
    if (e) { differing++; maxDiff = Math.max(maxDiff, e); if (first < 0) first = k; }
  }
  const expected = xxh.hash(bytesOf(p.want, p.depth));
  return { ...out, expected, exact: out.xxh3 === expected, differing, maxDiff, firstDiffering: first };
}

function spread(values) {
  let min = Infinity, max = -Infinity;
  const seen = new Set();
  for (const v of values) { seen.add(v); if (v < min) min = v; if (v > max) max = v; }
  return { distinct: seen.size, min, max };
}

/** One copy of the kept frame: its layout and every plane judged, or the exception. */
async function copy(format) {
  const options = format ? { format } : {};
  const row = { as: format ?? frame.format };
  try {
    const buf = new Uint8Array(frame.allocationSize(options));
    const layout = await frame.copyTo(buf, options);
    if (mutate === "plane") buf[layout[0].offset + 1] ^= 1;
    const planes = planesOf(row.as, unit, src);
    Object.assign(row, { ok: true, size: buf.length, layout: layout.map((l) => ({ offset: l.offset, stride: l.stride })) });
    row.planes = planes ? planes.map((p, i) => judge(buf, layout, p, i, xxh)) : `no plane map for ${row.as}`;
  } catch (e) {
    Object.assign(row, { ok: false, error: failure(e) });
  }
  return row;
}

/** Red, read back as floats from a paint path, against the source's luma: levels kept and the error in its steps. */
function levels(red, u, src) {
  const top = (1 << u.depth) - 1;
  const r = mutate === "paint" ? red.map((v) => Math.round(v * 255) / 255) : red;
  let exact = 0, maxDiff = 0;
  for (let i = 0; i < r.length; i++) {
    const e = Math.abs(r[i] * top - src.Y[i]);
    if (Math.round(r[i] * top) === src.Y[i]) exact++;
    maxDiff = Math.max(maxDiff, e);
  }
  return { distinct: new Set(r).size, exact, of: r.length, maxDiff: Math.round(maxDiff * 1000) / 1000 };
}

function webgl2() {
  const [u, gl] = [unit, new OffscreenCanvas(1, 1).getContext("webgl2")];
  if (!gl) return { error: { name: "absent", message: "no webgl2 context" } };
  const colourFloat = !!gl.getExtension("EXT_color_buffer_float");
  const out = {};
  for (const [name, internal, type] of [["RGBA16F", gl.RGBA16F, gl.HALF_FLOAT], ["RGBA32F", gl.RGBA32F, gl.FLOAT]]) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, gl.RGBA, type, frame);
    } catch (e) {
      out[name] = { error: failure(e) };
      continue;
    }
    const upload = gl.getError();
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (upload || status !== gl.FRAMEBUFFER_COMPLETE) {
      out[name] = { error: { name: "gl", message: `texImage2D error 0x${upload.toString(16)}, framebuffer 0x${status.toString(16)}` } };
      continue;
    }
    const px = new Float32Array(u.width * u.height * 4);
    gl.readPixels(0, 0, u.width, u.height, gl.RGBA, gl.FLOAT, px);
    const read = gl.getError();
    out[name] = read ? { error: { name: "gl", message: `readPixels error 0x${read.toString(16)}` } }
      : levels(px.filter((_, i) => i % 4 === 0), u, src);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
  }
  return { colourFloat, ...out };
}

const LOAD = `@group(0) @binding(0) var t: texture_external;
@group(0) @binding(1) var<storage, read_write> o: array<f32>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  let d = textureDimensions(t);
  if (g.x < d.x && g.y < d.y) { o[g.y * d.x + g.x] = textureLoad(t, g.xy).r; }
}`;

async function webgpu() {
  const u = unit;
  const gpu = await (gpuDevice ??= adapterDevice());
  if (!gpu.device) return { error: gpu.error };
  const { device } = gpu;
  const n = u.width * u.height * 4;
  device.pushErrorScope("validation");
  device.pushErrorScope("internal");
  try {
    const texture = device.importExternalTexture({ source: frame });
    const pipeline = device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code: LOAD }), entryPoint: "main" } });
    const store = device.createBuffer({ size: n, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const back = device.createBuffer({ size: n, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture }, { binding: 1, resource: { buffer: store } }] });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(u.width / 8), Math.ceil(u.height / 8));
    pass.end();
    enc.copyBufferToBuffer(store, 0, back, 0, n);
    device.queue.submit([enc.finish()]);
    const internal = await device.popErrorScope();
    const validation = await device.popErrorScope();
    if (internal || validation) return { error: { name: "gpu", message: (validation ?? internal).message } };
    await back.mapAsync(GPUMapMode.READ);
    const red = new Float32Array(back.getMappedRange().slice(0));
    back.unmap();
    return levels(red, u, src);
  } catch (e) {
    await device.popErrorScope().catch(() => {});
    await device.popErrorScope().catch(() => {});
    return { error: failure(e) };
  }
}

const describe = (f) => ({ format: f.format, codedWidth: f.codedWidth, codedHeight: f.codedHeight,
  displayWidth: f.displayWidth, displayHeight: f.displayHeight, visibleRect: f.visibleRect?.toJSON?.() ?? null,
  colorSpace: f.colorSpace?.toJSON?.() ?? null, timestamp: f.timestamp });

/** Support, configure and REPEATS key decodes timed, the first frame kept for the other tasks. */
async function decode({ u, acceleration }) {
  const data = Uint8Array.from(atob(u.unit), (c) => c.charCodeAt(0));
  const codec = mutate === "codec" ? "av01.9.99Z.99" : codecString(sequence(data));
  if (mutate === "unit") data.fill(0x55, data.length >> 1);
  const config = { codec, codedWidth: u.width, codedHeight: u.height, hardwareAcceleration: acceleration, optimizeForLatency: true };
  const row = { unit: u.name, acceleration, config };
  const support = await settle(() => VideoDecoder.isConfigSupported(config));
  row.isConfigSupported = support.error ? { error: support.error } : { supported: support.value.supported, config: support.value.config };
  const events = [];
  let wake = () => {};
  const push = (e) => { events.push({ ...e, at: performance.now() }); wake(); };
  const vd = new VideoDecoder({ output: (frame) => push({ frame }), error: (e) => push({ error: failure(e) }) });
  try {
    vd.configure(config);
    row.configure = { ok: true };
  } catch (e) {
    row.configure = { ok: false, error: failure(e) };
    return row;
  }
  const next = () => events.length ? Promise.resolve(events.shift())
    : new Promise((r) => { wake = r; setTimeout(r, WAIT_MS); }).then(() => events.shift() ?? { timeout: WAIT_MS });
  row.decodes = [];
  let first = null;
  for (let i = 0; i < REPEATS && vd.state === "configured"; i++) {
    const t0 = performance.now();
    try {
      vd.decode(new EncodedVideoChunk({ type: "key", timestamp: i, data }));
    } catch (e) {
      row.decodes.push({ outcome: "decode threw", error: failure(e) });
      break;
    }
    vd.flush().catch((e) => push({ flush: failure(e) }));
    const ev = await next();
    if (ev.frame) {
      row.decodes.push({ outcome: "frame", ms: ev.at - t0 });
      if (first) ev.frame.close();
      else first = ev.frame;
    } else {
      row.decodes.push({ outcome: ev.error ? "error" : ev.flush ? "flush rejected" : "timeout", ms: (ev.at ?? performance.now()) - t0,
        error: ev.error ?? ev.flush ?? null });
    }
  }
  row.stateAfter = vd.state;
  if (vd.state !== "closed") vd.close();
  await new Promise((r) => setTimeout(r, 0));
  row.later = events.splice(0).map((e) => e.frame ? (e.frame.close(), "frame") : e.error ?? e.flush ?? e);
  if (!first) return row;
  [frame, unit, src] = [first, u, source(u)];
  row.frame = describe(first);
  return row;
}

async function adapterDevice() {
  if (!navigator.gpu) return { error: { name: "absent", message: "no navigator.gpu" } };
  const adapter = await settle(() => navigator.gpu.requestAdapter());
  if (adapter.error || !adapter.value) return { error: adapter.error ?? { name: "absent", message: "requestAdapter gave null" } };
  const device = await settle(() => adapter.value.requestDevice());
  return device.error ? { adapter: adapter.value, error: device.error } : { adapter: adapter.value, device: device.value };
}

/** The source planes against make_hw_units.py's digests, so a wrong expectation cannot pass for a decoder's fault. */
function sources({ units }) {
  return units.map((u) => {
    const s = source(u);
    const ok = (k) => (s[k] ? xxh.hash(bytesOf(s[k], u.depth)) : null) === (mutate === "expected" ? "0" : u.planes[k]);
    return { unit: u.name, Y: ok("Y"), U: ok("U"), V: ok("V") };
  });
}

/** The GPU as WebGPU names it, and the frame check's SIMD path. */
async function environment() {
  const gpu = await (gpuDevice ??= adapterDevice());
  const info = gpu.adapter?.info;
  return {
    webgpu: gpu.adapter ? { info: info && { vendor: info.vendor, architecture: info.architecture, device: info.device,
      description: info.description, isFallbackAdapter: info.isFallbackAdapter }, features: [...gpu.adapter.features] } : gpu.error,
    xxh3Vector: xxh.vector,
  };
}

const TASKS = { decode, copy: ({ format }) => copy(format), webgl2, webgpu, sources, environment };

self.onmessage = async ({ data }) => {
  mutate = data.mutate;
  if (!xxh) {
    const h = await hasher();
    xxh = { hash: (bytes) => h.init().update(bytes).digest(), vector: h.vector };
  }
  const r = await settle(() => TASKS[data.task](data));
  postMessage(r);
};
