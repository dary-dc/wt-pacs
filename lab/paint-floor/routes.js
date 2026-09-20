/**
 * Two routes from decoded samples to the screen, and the window mapping both owe.
 * lab/paint-floor/README.md; docs/paint-floor.md holds the numbers.
 */

/** Integer, so the two routes agree bit for bit — the dividend and `range` are never negative. */
export const code = (v, lo, range) =>
  ((((v < lo ? lo : v > lo + range ? lo + range : v) - lo) * 255 + (range >> 1)) / range) | 0;

export function windows(frame) {
  const span = frame.max - frame.min;
  return {
    identity: { lo: frame.signed ? -(1 << (frame.bits - 1)) : 0, range: (1 << frame.bits) - 1 },
    tight: { lo: frame.min + Math.round(span * 0.45), range: Math.max(1, Math.round(span * 0.12)) },
  };
}

/**
 * The route a viewer built on the reference implementation takes, rebuilt without it: a lookup
 * table per paint, every sample into a new RGBA `ImageData` at source size, an `OffscreenCanvas`
 * at source size, a scale onto a second one, `transferToImageBitmap`, a main-thread `drawImage`.
 * The two canvases are created once rather than per paint — README §Fairness.
 */
export class Canvas2DRoute {
  static label = "2d";

  constructor(canvas) {
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.src = new OffscreenCanvas(1, 1);
    this.srcCtx = this.src.getContext("2d", { alpha: false });
    this.scaled = new OffscreenCanvas(1, 1);
    this.scaledCtx = this.scaled.getContext("2d", { alpha: false });
  }

  paint(frame, win, out, smooth) {
    const base = frame.signed ? -(1 << (frame.bits - 1)) : 0;
    const lut = new Uint8Array(1 << frame.bits);
    for (let k = 0; k < lut.length; k++) lut[k] = code(base + k, win.lo, win.range);

    const img = new ImageData(frame.width, frame.height);
    const rgba = img.data;
    const s = frame.samples;
    const n = frame.width * frame.height;
    if (frame.components === 3) {
      for (let i = 0, j = 0, k = 0; i < n; i++, j += 3, k += 4) {
        rgba[k] = lut[s[j] - base];
        rgba[k + 1] = lut[s[j + 1] - base];
        rgba[k + 2] = lut[s[j + 2] - base];
        rgba[k + 3] = 255;
      }
    } else {
      for (let i = 0, k = 0; i < n; i++, k += 4) {
        const g = lut[s[i] - base];
        rgba[k] = g;
        rgba[k + 1] = g;
        rgba[k + 2] = g;
        rgba[k + 3] = 255;
      }
    }

    if (this.src.width !== frame.width || this.src.height !== frame.height) {
      this.src.width = frame.width;
      this.src.height = frame.height;
    }
    if (this.scaled.width !== out.w || this.scaled.height !== out.h) {
      this.scaled.width = out.w;
      this.scaled.height = out.h;
    }
    this.srcCtx.putImageData(img, 0, 0);
    this.scaledCtx.imageSmoothingEnabled = smooth;
    this.scaledCtx.drawImage(this.src, 0, 0, out.w, out.h);
    const bitmap = this.scaled.transferToImageBitmap();
    this.ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  }

  readback(out) {
    return new Uint8ClampedArray(this.ctx.getImageData(0, 0, out.w, out.h).data);
  }
}

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * `(2i+1)*src / (2*dst)` is the texel canvas 2D's nearest scale picks, so at 1:1 and at any
 * integer magnification the two routes land on the same sample — README §Equality.
 */
const FRAG = (sampler, grey) => `#version 300 es
precision highp float;
precision highp int;
precision highp ${sampler};
uniform ${sampler} tex;
uniform ivec2 src;
uniform ivec2 dst;
uniform int lo;
uniform int range;
out vec4 frag;
int code(int v) {
  return ((clamp(v, lo, lo + range) - lo) * 255 + (range >> 1)) / range;
}
void main() {
  ivec2 d = ivec2(gl_FragCoord.xy);
  ivec2 at = ivec2(((2 * d.x + 1) * src.x) / (2 * dst.x),
                   ((2 * (dst.y - 1 - d.y) + 1) * src.y) / (2 * dst.y));
  ivec4 t = ivec4(texelFetch(tex, at, 0));
  vec3 rgb = ${grey
    ? "vec3(float(code(t.r)))"
    : "vec3(float(code(t.r)), float(code(t.g)), float(code(t.b)))"} / 255.0;
  frag = vec4(rgb, 1.0);
}`;

const key = (frame) => `${frame.bits > 8 ? 16 : 8}${frame.signed ? "i" : "u"}${frame.components}`;

/** A texture of the decoded samples, window/level in the shader, one draw at display size. */
export class WebGL2Route {
  static label = "gl";

  constructor(canvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false, antialias: false, depth: false, stencil: false,
    });
    if (!gl) throw new Error("no webgl2");
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.gl = gl;
    this.formats = {
      "8u3": { internal: gl.RGB8UI, format: gl.RGB_INTEGER, type: gl.UNSIGNED_BYTE, sampler: "usampler2D" },
      "16u1": { internal: gl.R16UI, format: gl.RED_INTEGER, type: gl.UNSIGNED_SHORT, sampler: "usampler2D" },
      "16i1": { internal: gl.R16I, format: gl.RED_INTEGER, type: gl.SHORT, sampler: "isampler2D" },
    };
    this.programs = new Map();
    this.texture = null;
    this.allocated = null;
  }

  renderer() {
    const dbg = this.gl.getExtension("WEBGL_debug_renderer_info");
    return dbg
      ? this.gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      : this.gl.getParameter(this.gl.RENDERER);
  }

  program(frame) {
    const k = key(frame);
    if (this.programs.has(k)) return this.programs.get(k);
    const gl = this.gl;
    const compile = (kind, source) => {
      const sh = gl.createShader(kind);
      gl.shaderSource(sh, source);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG(this.formats[k].sampler, frame.components === 1)));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const at = { program: p };
    for (const u of ["tex", "src", "dst", "lo", "range"]) at[u] = gl.getUniformLocation(p, u);
    this.programs.set(k, at);
    return at;
  }

  paint(frame, win, out) {
    const gl = this.gl;
    const f = this.formats[key(frame)];
    const want = `${key(frame)}:${frame.width}x${frame.height}`;
    if (this.allocated !== want) {
      gl.deleteTexture(this.texture);
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, f.internal, frame.width, frame.height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.allocated = want;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, frame.width, frame.height, f.format, f.type, frame.samples);

    const at = this.program(frame);
    gl.useProgram(at.program);
    gl.uniform1i(at.tex, 0);
    gl.uniform2i(at.src, frame.width, frame.height);
    gl.uniform2i(at.dst, out.w, out.h);
    gl.uniform1i(at.lo, win.lo);
    gl.uniform1i(at.range, win.range);
    gl.viewport(0, 0, out.w, out.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  readback(out) {
    const gl = this.gl;
    const bottomUp = new Uint8Array(out.w * out.h * 4);
    gl.readPixels(0, 0, out.w, out.h, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
    const rows = new Uint8ClampedArray(bottomUp.length);
    const stride = out.w * 4;
    for (let y = 0; y < out.h; y++) {
      rows.set(bottomUp.subarray((out.h - 1 - y) * stride, (out.h - y) * stride), y * stride);
    }
    return rows;
  }
}
