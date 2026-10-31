/** One settle variant in a loop on an OffscreenCanvas's WebGL2 context, each call timed. lab/paint-read/README.md */
import { now } from "../../client/view/clock.js";

/** ms: a call is due every period; a fence not signalled by the cap is counted as timed out. */
const PERIOD_MS = 20;
const FENCE_CAP_MS = 1000;

const FRAG = `#version 300 es
precision highp float;
out vec4 frag;
void main() { frag = vec4(fract(gl_FragCoord.xy / 64.0), 0.5, 1.0); }`;
const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

let gl = null;

function setup(canvas) {
  gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error("WebGL2 is not available");
  const p = gl.createProgram();
  for (const [kind, text] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
    const s = gl.createShader(kind);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  gl.useProgram(p);
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}

function draw(k) {
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clearColor((k % 7) / 7, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

const yieldTask = () => new Promise((r) => {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => (port1.close(), r());
  port2.postMessage(0);
});

/** Resolves once the draw before it has executed, as the variant tells; `false` for a fence not signalled by the cap. */
const SETTLE = {
  read: () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)),
  finish: () => gl.finish(),
  none: () => {},
  async fence() {
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const t0 = now();
    // A sync object's status changes only between tasks (WebGL 2.0 §5.27), so each poll is its own task.
    for (;;) {
      await yieldTask();
      if (gl.clientWaitSync(sync, 0, 0) !== gl.TIMEOUT_EXPIRED) break;
      if (now() - t0 > FENCE_CAP_MS) return (gl.deleteSync(sync), false);
    }
    gl.deleteSync(sync);
  },
};

/** `{ start, ms }` a call, on `now()`'s clock; each call starts in its own task at the next due time. */
async function loop(variant, t0, ms) {
  const calls = [];
  const settle = SETTLE[variant.replace("′", "")];
  for (let k = 0, slot = 0; ; k++, slot++) {
    // A timer may wake a little early, so the next slot is counted, not read back from the clock.
    slot = Math.max(slot, Math.ceil((now() - t0) / PERIOD_MS));
    const due = t0 + slot * PERIOD_MS;
    if (due >= t0 + ms) return calls;
    while (now() < due) await new Promise((r) => setTimeout(r, due - now()));
    const start = now();
    draw(k);
    const ok = await settle();
    calls.push({ start, ms: now() - start, ...(ok === false && { timedOut: true }) });
  }
}

onmessage = async ({ data: { canvas, variant, t0, ms } }) => {
  try {
    const renderer = setup(canvas);
    postMessage({ renderer, period: PERIOD_MS, calls: await loop(variant, t0, ms) });
  } catch (e) {
    postMessage({ error: String(e?.message ?? e) });
  }
};
