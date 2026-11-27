/** The settle check's worker: a heavy draw, then each settle timed, then a read timed after it. settle-check.mjs */
import { settled } from "./settle.js";

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const FRAG = `#version 300 es
precision highp float;
uniform int n;
uniform float seed;
out vec4 frag;
void main() {
  float a = seed + gl_FragCoord.x * 0.001 + gl_FragCoord.y;
  for (int k = 0; k < n; k++) a = fract(sin(a * 12.9898 + float(k)) * 43758.5453);
  frag = vec4(a, a, a, 1.0);
}`;

const now = () => performance.now();
const pixel = new Uint8Array(4);
const read = (gl) => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
const SETTLES = { read, fence: settled, finish: (gl) => gl.finish(), none: (gl) => gl.flush() };

function heavy(canvas, n) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  const p = gl.createProgram();
  for (const [kind, text] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
    const s = gl.createShader(kind);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  gl.useProgram(p);
  gl.uniform1i(gl.getUniformLocation(p, "n"), n);
  const seed = gl.getUniformLocation(p, "seed");
  return { gl, draw: (k) => (gl.uniform1f(seed, k), gl.drawArrays(gl.TRIANGLES, 0, 3)) };
}

/** Each trial, each settle: `settle`, ms from the draw's issue to the settle's return; `after`, ms of a read just after. */
onmessage = async ({ data: { canvas, n, trials, settles } }) => {
  try {
    const { gl, draw } = heavy(canvas, n);
    draw(-1);
    read(gl);
    const out = [];
    for (let t = 0; t < trials; t++) {
      for (const [k, name] of settles.entries()) {
        const t0 = now();
        draw(t * settles.length + k);
        await SETTLES[name](gl);
        const t1 = now();
        read(gl);
        out.push({ name, settle: t1 - t0, after: now() - t1 });
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    postMessage({ renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), out });
  } catch (e) {
    postMessage({ error: String(e?.message ?? e) });
  }
};
