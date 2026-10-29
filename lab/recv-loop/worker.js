// The receive loop, the disk cine and the drag, in whichever worker the arm puts them. README.md
import { TransportSession } from "/client/transport/ts/dist/session.js";

// 2560 × 3328 × 16-bit: 17 MB, the frame of docs/adr/frame-path.md §The receive loop beside the paint.
const W = 2560;
const H = 3328;
const STORED = 4;
const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const FRAG = `#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D samples;
uniform float level;
out vec4 frag;
void main() {
  frag = vec4(vec3(float(texelFetch(samples, ivec2(gl_FragCoord.xy), 0).r) / 65535.0 + level), 1.0);
}`;

const clock = () => performance.timeOrigin + performance.now();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

let gl = null;
let level = null;
let samples = null;
let handles = [];
let digests = [];
let xxh3 = null;
let load = null;

async function hasher() {
  const src = await (await fetch("/client/decode/wasm/vendor/hash-wasm/xxhash3.umd.min.js")).text();
  new Function(src).call(globalThis);
  const h = await globalThis.hashwasm.createXXHash3();
  return (bytes) => h.init().update(bytes).digest("hex");
}

function program() {
  const p = gl.createProgram();
  for (const [kind, text] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
    const s = gl.createShader(kind);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

async function prepare({ canvas }) {
  canvas.width = W;
  canvas.height = H;
  gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) throw new Error("no WebGL2 in this worker");
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const p = program();
  gl.useProgram(p);
  level = gl.getUniformLocation(p, "level");
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16UI, W, H);
  gl.viewport(0, 0, W, H);
  xxh3 = await hasher();
  samples = new Uint8Array(W * H * 2);
  const dir = await navigator.storage.getDirectory();
  for (let i = 0; i < STORED; i++) {
    for (let at = 0; at < samples.length; at += 65536) crypto.getRandomValues(samples.subarray(at, at + 65536));
    const h = await (await dir.getFileHandle(`frame-${i}`, { create: true })).createSyncAccessHandle();
    h.truncate(0);
    h.write(samples, { at: 0 });
    h.flush();
    handles.push(h);
    digests.push(xxh3(samples));
  }
  return { renderer: gl.getParameter(gl.RENDERER), userAgent: navigator.userAgent };
}

/** One step of the cine: read a stored frame, check it, upload it, draw it; all synchronous, as one task. */
function step(i) {
  const n = handles[i].read(samples, { at: 0 });
  if (n !== samples.length || xxh3(samples) !== digests[i]) throw new Error(`stored frame ${i} read back wrong`);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array(samples.buffer));
  gl.uniform1f(level, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function drag(k) {
  gl.uniform1f(level, (k % 64) / 256);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function go({ load: kind, fps }) {
  load = { kind, busy: [], late: [], running: true, started: clock() };
  const period = 1000 / fps;
  let next = 0;
  let k = 0;
  const tick = (t) => {
    if (!load.running) return;
    const s = clock();
    if (kind === "drag") drag(k++);
    else if (t >= next) {
      if (next) load.late.push(t - next);
      next = Math.max((next || t) + period, t);
      step(k++ % STORED);
    } else return void requestAnimationFrame(tick);
    load.busy.push([s, clock()]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
}

function stop() {
  load.running = false;
  const { busy, late, started } = load;
  return { busy, late, steps: busy.length, loadMs: clock() - started };
}

async function fill({ url, hash, count, mutant }) {
  if (mutant === "leak") return leak({ url, hash, count });
  const arrivals = [];
  const frames = new Array(count);
  const dialed = clock();
  let session = null;
  await new Promise((resolve, reject) => {
    let got = 0;
    const onFrame = ({ frameIndex, bytes }) => {
      arrivals.push(clock());
      frames[frameIndex] = bytes;
      if (++got === count) resolve();
    };
    const onError = (i, reason) => reject(new Error(`frame ${i}: ${reason}`));
    TransportSession.connect(url, hash, { fill: { from: 0, to: count - 1, onFrame, onError } })
      .then((s) => (session = s), reject);
  });
  session.close();
  if (mutant === "corrupt") frames[0][0] ^= 1;
  const sha256 = [];
  for (const f of frames) sha256.push(hex(await crypto.subtle.digest("SHA-256", f)));
  return { dialed, arrivals, sha256 };
}

/** The mutant the same-thread check exists for: the merged arm's receive loop quietly moved to a second worker. */
function leak(args) {
  const w = new Worker(import.meta.url, { type: "module" });
  return new Promise((resolve, reject) => {
    w.onmessage = ({ data }) => (data.error ? reject(new Error(data.error)) : resolve(data.result));
    w.postMessage({ id: 0, kind: "fill", ...args });
  });
}

const kinds = { prepare, go, stop, fill };
onmessage = async ({ data: { id, kind, ...args } }) => {
  try {
    postMessage({ id, result: await kinds[kind](args) });
  } catch (e) {
    postMessage({ id, error: String(e?.stack ?? e) });
  }
};
