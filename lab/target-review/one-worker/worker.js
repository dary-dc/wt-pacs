// One dedicated worker holding WebGL2, OPFS sync handles, rAF and WebTransport at once. README.md
const SIZES = { "512x512": [512, 512], "614x1359": [614, 1359], "2560x3328": [2560, 3328] };
const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const FRAG = `#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D samples;
out vec4 frag;
void main() {
  frag = vec4(vec3(float(texelFetch(samples, ivec2(gl_FragCoord.xy), 0).r) / 65535.0), 1.0);
}`;

let gl = null;
let canvas = null;
let program = null;
let dir = null;
let buffer = null;
const textures = {};
const pixel = new Uint8Array(4);
const loop = { ticks: 0, intervals: 0 };
const now = () => performance.now();

function compile(kind, text) {
  const sh = gl.createShader(kind);
  gl.shaderSource(sh, text);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function texture(w, h) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16UI, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return t;
}

async function start(offscreen) {
  canvas = offscreen;
  gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
  let renderer = null;
  if (gl) {
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    for (const [name, [w, h]] of Object.entries(SIZES)) textures[name] = texture(w, h);
  }
  dir = await navigator.storage.getDirectory();
  const probe = await (await dir.getFileHandle("probe", { create: true })).createSyncAccessHandle();
  const syncHandle = typeof probe.read === "function";
  probe.close();
  return {
    renderer,
    webgl2: Boolean(gl),
    syncHandle,
    requestAnimationFrame: typeof requestAnimationFrame,
    WebTransport: typeof WebTransport,
    userAgent: navigator.userAgent,
  };
}

async function prepare({ frames }) {
  buffer = new ArrayBuffer(Math.max(...Object.values(SIZES).map(([w, h]) => w * h * 2)));
  for (const [name, [w, h]] of Object.entries(SIZES)) {
    const bytes = new Uint8Array(buffer, 0, w * h * 2);
    for (let i = 0; i < frames; i++) {
      for (let at = 0; at < bytes.length; at += 65536) crypto.getRandomValues(bytes.subarray(at, Math.min(at + 65536, bytes.length)));
      const h = await (await dir.getFileHandle(`${name}-${i}`, { create: true })).createSyncAccessHandle();
      h.truncate(0);
      h.write(bytes, { at: 0 });
      h.flush();
      h.close();
    }
  }
  return { bytes: buffer.byteLength };
}

function upload(name) {
  const [w, h] = SIZES[name];
  const t0 = now();
  gl.bindTexture(gl.TEXTURE_2D, textures[name]);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array(buffer, 0, w * h));
  return now() - t0;
}

function draw(name) {
  const [w, h] = SIZES[name];
  const t0 = now();
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  gl.viewport(0, 0, w, h);
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textures[name]);
  gl.uniform1i(gl.getUniformLocation(program, "samples"), 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  // A one-pixel read waits for the draw; gl.finish() alone did not on SwiftShader (client/paint/paint-worker.js).
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return now() - t0;
}

async function step({ size, i }) {
  const [w, h] = SIZES[size];
  const bytes = w * h * 2;
  const t0 = now();
  const handle = await (await dir.getFileHandle(`${size}-${i}`)).createSyncAccessHandle();
  const t1 = now();
  const n = handle.read(new Uint8Array(buffer, 0, bytes), { at: 0 });
  const t2 = now();
  handle.close();
  const t3 = now();
  if (n !== bytes) throw new Error(`read ${n} of ${bytes} bytes`);
  const parts = { open: t1 - t0, read: t2 - t1, close: t3 - t2, upload: upload(size), draw: draw(size) };
  const memory = upload(size) + draw(size);
  return { ...parts, disk: parts.open + parts.read + parts.close + parts.upload + parts.draw, memory };
}

function animate() {
  const tick = () => {
    upload("512x512");
    draw("512x512");
    loop.ticks++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setInterval(() => loop.intervals++, 16);
  return true;
}

function mark({ pingIn }) {
  if (pingIn) setTimeout(() => self.postMessage({ kind: "ping", t: now() }), pingIn);
  return { ...loop, t: now() };
}

const calls = { start: ({ canvas: c }) => start(c), prepare, step, animate, mark };

self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ id: data.id, result: await calls[data.kind](data) });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message });
  }
};
