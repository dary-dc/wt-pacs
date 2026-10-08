/**
 * The painter's worker half: WebGL2 on the page's transferred canvas. Pass 1 windows the frame
 * through the table into an RGBA8 texture at source size; pass 2 draws one quad that samples it
 * bilinearly. client/paint/README.md §How it paints
 */
import { tableShape, windowTable } from "./voi.js";

const VERT_FULL = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const WINDOW = (sampler, rgb) => `#version 300 es
precision highp float;
precision highp int;
precision highp ${sampler};
precision highp usampler2D;
uniform ${sampler} samples;
uniform usampler2D table;
uniform int offset;
out vec4 frag;
float lookup(int s) {
  int i = s + offset;
  return float(texelFetch(table, ivec2(i & 255, i >> 8), 0).r) / 255.0;
}
void main() {
  ivec4 t = ivec4(texelFetch(samples, ivec2(gl_FragCoord.xy), 0));
  frag = ${rgb ? "vec4(lookup(t.r), lookup(t.g), lookup(t.b), 1.0)" : "vec4(vec3(lookup(t.r)), 1.0)"};
}`;

const VERT_QUAD = `#version 300 es
uniform vec2 corner[4];
uniform vec2 coord[4];
out vec2 uv;
void main() {
  uv = coord[gl_VertexID];
  gl_Position = vec4(corner[gl_VertexID], 0.0, 1.0);
}`;

const PLACE = `#version 300 es
precision highp float;
uniform sampler2D picture;
in vec2 uv;
out vec4 frag;
void main() {
  frag = vec4(texture(picture, uv).rgb, 1.0);
}`;

let gl = null;
let lost = null;
let canvas = null;
const programs = new Map();
let source = null;
let tableTex = null;
let picture = null;
let fbo = null;
const cached = { frame: null, table: null };

/** The texture format a frame uploads as, from its depth, sign and components. */
function format(f) {
  if (f.components === 3) {
    if (f.bits > 8 || f.signed) throw new Error("RGB is painted only as unsigned 8-bit");
    return { internal: gl.RGB8UI, fmt: gl.RGB_INTEGER, type: gl.UNSIGNED_BYTE, sampler: "usampler2D", View: Uint8Array };
  }
  if (f.bits <= 8 && !f.signed) return { internal: gl.R8UI, fmt: gl.RED_INTEGER, type: gl.UNSIGNED_BYTE, sampler: "usampler2D", View: Uint8Array };
  if (f.bits <= 16 && !f.signed) return { internal: gl.R16UI, fmt: gl.RED_INTEGER, type: gl.UNSIGNED_SHORT, sampler: "usampler2D", View: Uint16Array };
  if (f.bits <= 16 && f.signed && f.bits > 8) return { internal: gl.R16I, fmt: gl.RED_INTEGER, type: gl.SHORT, sampler: "isampler2D", View: Int16Array };
  throw new Error(`${f.bits}-bit ${f.signed ? "signed" : "unsigned"} samples are not painted`);
}

function program(name, vert, frag) {
  if (programs.has(name)) return programs.get(name);
  const compile = (kind, text) => {
    const sh = gl.createShader(kind);
    gl.shaderSource(sh, text);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vert));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const at = (u) => gl.getUniformLocation(p, u);
  const entry = { p, at };
  programs.set(name, entry);
  return entry;
}

function texture(internal, w, h, filter) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** Uploads straight from the shared buffer; skipped when the same frame is painted again. */
function upload(frame, f, same) {
  if (same && source) return false;
  gl.deleteTexture(source);
  source = texture(f.internal, frame.width, frame.height, gl.NEAREST);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, frame.width, frame.height, f.fmt, f.type,
    new f.View(frame.pixels, frame.byteOffset ?? 0, frame.width * frame.height * frame.components));
  gl.deleteTexture(picture);
  picture = texture(gl.RGBA8, frame.width, frame.height, gl.LINEAR);
  cached.frame = { width: frame.width, height: frame.height };
  return true;
}

function windowPass(frame, display, f) {
  const table = windowTable(frame, display);
  const { entries, offset } = tableShape(frame);
  gl.deleteTexture(tableTex);
  tableTex = texture(gl.R8UI, 256, entries / 256, gl.NEAREST);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, entries / 256, gl.RED_INTEGER, gl.UNSIGNED_BYTE, table);
  const { p, at } = program(`window:${f.sampler}:${frame.components}`, VERT_FULL, WINDOW(f.sampler, frame.components === 3));
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, picture, 0);
  gl.viewport(0, 0, frame.width, frame.height);
  gl.useProgram(p);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, source);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, tableTex);
  gl.uniform1i(at("samples"), 0);
  gl.uniform1i(at("table"), 1);
  gl.uniform1i(at("offset"), offset);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/**
 * The image's box on the canvas, in device pixels, and the source coordinate at each corner:
 * centred, rounded down to a whole pixel, then panned; the display is the image turned clockwise, then flipped.
 */
export function placement(frame, view, width, height, dpr) {
  const v = { fit: true, zoom: 1, panX: 0, panY: 0, rotate: 0, flipH: false, flipV: false, ...view };
  const q = ((v.rotate / 90) % 4 + 4) % 4;
  if (!Number.isInteger(q)) throw new Error(`rotation ${v.rotate} is not a quarter turn`);
  const { width: w, height: h } = frame;
  const dw = q % 2 ? h : w;
  const dh = q % 2 ? w : h;
  const s = (v.fit ? Math.min(width / dw, height / dh) : 1) * v.zoom;
  const x0 = Math.floor((width - s * dw) / 2) + v.panX * dpr;
  const y0 = Math.floor((height - s * dh) / 2) + v.panY * dpr;
  // Corners in strip order: top-left, top-right, bottom-left, bottom-right of the display box.
  const display = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const corner = display.map(([cx, cy]) => [((x0 + cx * s * dw) / width) * 2 - 1, 1 - ((y0 + cy * s * dh) / height) * 2]);
  // Image-space (u, v) in [0, 1] at a display corner: undo the flips, then the clockwise turn.
  const coord = display.map(([cx, cy]) => {
    const a = v.flipH ? 1 - cx : cx;
    const b = v.flipV ? 1 - cy : cy;
    return [[a, b], [b, 1 - a], [1 - a, 1 - b], [1 - b, a]][q];
  });
  return { corner, coord };
}

function placePass(display, width, height, dpr) {
  const { corner, coord } = placement(cached.frame, display.view, width, height, dpr);
  const { p, at } = program("place", VERT_QUAD, PLACE);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(p);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, picture);
  gl.uniform1i(at("picture"), 0);
  gl.uniform2fv(at("corner"), corner.flat());
  gl.uniform2fv(at("coord"), coord.flat());
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function readback(width, height) {
  const bottomUp = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
  const rows = new Uint8ClampedArray(bottomUp.length);
  const stride = width * 4;
  for (let y = 0; y < height; y++) rows.set(bottomUp.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
  return rows;
}

function start(offscreen) {
  canvas = offscreen;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = "the WebGL2 context was lost";
    self.postMessage({ kind: "lost", reason: lost });
  });
  gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  if (!gl) {
    lost = "WebGL2 is not available";
    return self.postMessage({ kind: "lost", reason: lost });
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  fbo = gl.createFramebuffer();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  self.postMessage({ kind: "ready", renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) });
}

/** One paint: upload if the frame is new, window if the frame or the window changed, place always. */
function paint({ id, frame, same, display, width, height, dpr, read }) {
  if (lost) return self.postMessage({ kind: "painted", id, error: lost });
  try {
    const t0 = performance.now();
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const f = format(frame);
    const fresh = upload(frame, f, same);
    const key = JSON.stringify([display.photometric, display.invert, display.rescale, display.voi]);
    if (fresh || cached.table !== key) {
      windowPass(frame, display, f);
      cached.table = key;
    }
    placePass(display, width, height, dpr);
    const pixels = read ? readback(width, height) : null;
    // A one-pixel read waits for the draw to execute; gl.finish() alone did not on SwiftShader.
    if (!read) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    self.postMessage({ kind: "painted", id, ms: performance.now() - t0, uploaded: fresh, pixels }, pixels ? [pixels.buffer] : []);
  } catch (e) {
    self.postMessage({ kind: "painted", id, error: e.message });
  }
}

self.onmessage = ({ data }) => (data.kind === "start" ? start(data.canvas) : paint(data));
