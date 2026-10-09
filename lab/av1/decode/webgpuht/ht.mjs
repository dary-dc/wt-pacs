// HTJ2K frames decoded on WebGPU: the code-blocks parsed here, everything after on the device; a batch of
// frames is one set of dispatches and one read-back. lab/av1/decode/webgpuht/README.md
import { parse } from "./codestream.mjs";

const SCAN_WORKGROUP = /* wgsl */ `
fn scan(t: u32, c: u32) -> vec2u {
  scan_buf[t] = c;
  workgroupBarrier();
  for (var d = 1u; d < 32u; d <<= 1u) {
    let v = scan_buf[t] + select(0u, scan_buf[max(t, d) - d], t >= d);
    workgroupBarrier();
    scan_buf[t] = v;
    workgroupBarrier();
  }
  return vec2u(scan_buf[t] - c, scan_buf[31]);
}`;

// Lanes are assumed to be consecutive invocations; each lane found otherwise is counted in faults[1].
const SCAN_SUBGROUP = /* wgsl */ `
fn scan(t: u32, c: u32) -> vec2u {
  let incl = subgroupInclusiveAdd(c);
  let size = subgroupAdd(1u);
  let lane = subgroupExclusiveAdd(1u);
  if subgroupBroadcastFirst(t) + lane != t { atomicAdd(&faults[1], 1u); }
  if lane == size - 1u { scan_buf[t / size] = incl; }
  workgroupBarrier();
  var before = 0u;
  var total = 0u;
  for (var s = 0u; s < 32u / size; s++) {
    total += scan_buf[s];
    if s < t / size { before += scan_buf[s]; }
  }
  return vec2u(before + incl - c, total);
}`;

const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
const MAX_GROUPS = 65535;

/** x × y × z workgroups covering n, x and z each within the device's limit. */
const spread = (n) => (n <= MAX_GROUPS ? [n, 1] : [MAX_GROUPS, Math.ceil(n / MAX_GROUPS)]);

export async function decoder(device, wgsl, tables, { subgroups }) {
  const code = (subgroups ? "enable subgroups;\n" : "") + wgsl + (subgroups ? SCAN_SUBGROUP : SCAN_WORKGROUP);
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === "error");
  if (errors.length) throw new Error(errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join("\n"));

  const layout = (types) => device.createBindGroupLayout({
    entries: Object.entries(types).map(([binding, type]) => ({
      binding: Number(binding), visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    })),
  });
  const cleanupLayout = layout({ 0: "read-only-storage", 1: "read-only-storage", 2: "read-only-storage",
    3: "storage", 4: "storage", 5: "storage", 6: "storage", 7: "storage" });
  const synthLayout = layout({ 8: "read-only-storage", 9: "storage", 10: "read-only-storage", 11: "uniform" });
  const packLayout = layout({ 12: "read-only-storage", 13: "read-only-storage", 14: "storage" });
  const pipeline = (entryPoint, bgl) => device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }), compute: { module, entryPoint },
  });
  const vlc = pipeline("cleanup_vlc", cleanupLayout);
  const magsgn = pipeline("cleanup_magsgn", cleanupLayout);
  const synth = pipeline("synth", synthLayout);
  const pack = pipeline("pack", packLayout);
  const tbl = upload(device, tables);

  /** Decodes frames (Uint8Array codestreams) as one batch: their samples, as OpenJPH emits them. */
  async function decode(codestreams) {
    const parsed = codestreams.map(parse);
    let srcBytes = 0, planeWords = 0, quadWords = 0, msWords = 0, outWords = 0;
    const blocks = [], jobs = [], frames = [];
    const L = Math.max(...parsed.map((p) => p.L));
    for (const [f, p] of parsed.entries()) {
      const N = p.W * p.H, C = p.comps.length, bits = p.comps[0].bits;
      if (p.comps.some((c) => c.bits !== bits || c.signed !== p.comps[0].signed)) throw new Error("mixed components");
      for (const cb of p.blocks) {
        blocks.push(srcBytes + cb.offset, cb.lcup, cb.w, cb.h, cb.missing, cb.kmax,
          planeWords + cb.comp * N + cb.y * p.W + cb.x, p.W, quadWords, msWords);
        quadWords += ((cb.w + 1) >> 1) * ((cb.h + 1) >> 1);
        msWords += (cb.lcup >> 2) + 3;
      }
      for (let c = 0; c < C; c++) jobs.push({ L: p.L, off: planeWords + c * N, W: p.W, H: p.H });
      const words = Math.ceil((N * C * (bits > 8 ? 2 : 1)) / 4);
      frames.push(planeWords, N, C, bits, p.comps[0].signed ? 1 : 0, p.rct ? 1 : 0, outWords, words);
      p.out = outWords;
      p.bytes = N * C * (bits > 8 ? 2 : 1);
      srcBytes += (codestreams[f].length + 3) & ~3;
      planeWords += N * C;
      outWords += words;
    }
    const src = new Uint8Array(srcBytes);
    let at = 0;
    for (const c of codestreams) { src.set(c, at); at += (c.length + 3) & ~3; }

    const buf = {
      src: upload(device, src),
      blocks: upload(device, new Uint32Array(blocks)),
      quads: empty(device, quadWords * 4),
      ms: empty(device, msWords * 4),
      msBits: empty(device, blocks.length / 10 * 4),
      planes: empty(device, planeWords * 4),
      tmp: empty(device, planeWords * 4),
      faults: empty(device, 8),
      frames: upload(device, new Uint32Array(frames)),
      packed: empty(device, outWords * 4),
    };
    const bind = (bgl, entries) => device.createBindGroup({
      layout: bgl, entries: Object.entries(entries).map(([binding, buffer]) => ({ binding: Number(binding), resource: { buffer } })),
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    let dispatches = 0;
    const dispatch = (p, group, [x, y, z = 1]) => { pass.setPipeline(p); pass.setBindGroup(0, group); pass.dispatchWorkgroups(x, y, z); dispatches++; };

    const nBlocks = blocks.length / 10;
    const cleanup = bind(cleanupLayout, { 0: buf.src, 1: tbl, 2: buf.blocks, 3: buf.quads, 4: buf.ms, 5: buf.msBits, 6: buf.planes, 7: buf.faults });
    dispatch(vlc, cleanup, spread(Math.ceil(nBlocks / 64)));
    dispatch(magsgn, cleanup, spread(nBlocks));

    // levels from the coarsest; a frame with fewer levels has none to do in the first steps
    const levelJobs = [];
    for (let r = 1; r <= L; r++) {
      for (const j of jobs) {
        const lr = r - (L - j.L);
        if (lr < 1) continue;
        const w = Math.ceil(j.W / 2 ** (j.L - lr)), h = Math.ceil(j.H / 2 ** (j.L - lr));
        levelJobs.push({ r, off: j.off, stride: j.W, w, h });
      }
    }
    buf.jobs = upload(device, new Uint32Array(levelJobs.flatMap((j) => [j.off, j.stride, j.w, j.h])));
    const uniforms = [];
    for (let r = 1; r <= L; r++) {
      const first = levelJobs.findIndex((j) => j.r === r), these = levelJobs.filter((j) => j.r === r);
      for (const cols of [0, 1]) {
        const u = upload(device, new Uint32Array([first, these.length, cols, 0]), GPUBufferUsage.UNIFORM);
        uniforms.push(u);
        const group = bind(synthLayout, cols
          ? { 8: buf.tmp, 9: buf.planes, 10: buf.jobs, 11: u }
          : { 8: buf.planes, 9: buf.tmp, 10: buf.jobs, 11: u });
        const lines = Math.max(...these.map((j) => (cols ? j.w : j.h)));
        dispatch(synth, group, [Math.ceil(lines / 64), these.length]);
      }
    }
    const maxWords = Math.max(...parsed.map((p) => Math.ceil(p.bytes / 4)));
    const [x, z] = spread(Math.ceil(maxWords / 64));
    dispatch(pack, bind(packLayout, { 12: buf.planes, 13: buf.frames, 14: buf.packed }), [x, parsed.length, z]);
    pass.end();

    const back = device.createBuffer({ size: outWords * 4 + 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    enc.copyBufferToBuffer(buf.packed, 0, back, 0, outWords * 4);
    enc.copyBufferToBuffer(buf.faults, 0, back, outWords * 4, 8);
    device.queue.submit([enc.finish()]);
    await back.mapAsync(GPUMapMode.READ);
    const all = new Uint8Array(back.getMappedRange());
    const out = parsed.map((p) => all.slice(p.out * 4, p.out * 4 + p.bytes));
    const faults = [...new Uint32Array(all.buffer, outWords * 4, 2)];
    back.unmap();
    back.destroy();
    for (const b of [...Object.values(buf), ...uniforms]) b.destroy();
    return { out, dispatches, readbacks: 1, faults };
  }

  return { decode };
}

function upload(device, data, usage = STORAGE) {
  const b = device.createBuffer({ size: Math.max(16, (data.byteLength + 3) & ~3), usage: usage | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(b, 0, data.buffer, data.byteOffset, data.byteLength);
  return b;
}

const empty = (device, bytes) => device.createBuffer({ size: Math.max(16, bytes), usage: STORAGE });
