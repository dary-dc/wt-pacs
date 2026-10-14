/**
 * The painter's contract computed a second way, on the CPU: each device pixel mapped back to the
 * source, bilinear in float64 over the windowed bytes. The check compares the two. client/paint/README.md §The contract
 */
import { tableShape, windowTable } from "./voi.js";

/** RGBA, rows top-down, `width` × `height` device pixels; opaque black outside the image. */
export function paintReference(frame, display, width, height, dpr = 1) {
  const { width: w, height: h, components } = frame;
  const v = { fit: true, zoom: 1, panX: 0, panY: 0, rotate: 0, flipH: false, flipV: false, ...display.view };
  const quarter = ((v.rotate / 90) % 4 + 4) % 4;
  const turned = quarter % 2 === 1;
  const dw = turned ? h : w;
  const dh = turned ? w : h;
  const s = (v.fit ? Math.min(width / dw, height / dh) : 1) * v.zoom;
  const ox = Math.floor((width - s * dw) / 2) + v.panX * dpr;
  const oy = Math.floor((height - s * dh) / 2) + v.panY * dpr;

  const table = windowTable(frame, display);
  const { offset } = tableShape(frame);
  const samples = frame.samples;
  const windowed = new Uint8Array(w * h * components);
  for (let i = 0; i < windowed.length; i++) windowed[i] = table[samples[i] + offset];

  const out = new Uint8ClampedArray(width * height * 4);
  for (let Y = 0; Y < height; Y++) {
    for (let X = 0; X < width; X++) {
      const o = (Y * width + X) * 4;
      out[o + 3] = 255;
      let a = (X + 0.5 - ox) / s;
      let b = (Y + 0.5 - oy) / s;
      if (!(a >= 0 && a < dw && b >= 0 && b < dh)) continue;
      if (v.flipH) a = dw - a;
      if (v.flipV) b = dh - b;
      // The display is the image turned clockwise by `quarter` quarter turns; undo it.
      const [x, y] = [[a, b], [b, h - a], [w - a, h - b], [w - b, a]][quarter];
      const tx = x - 0.5;
      const ty = y - 0.5;
      const x0 = Math.floor(tx);
      const y0 = Math.floor(ty);
      const fx = tx - x0;
      const fy = ty - y0;
      const cx0 = clamp(x0, w);
      const cx1 = clamp(x0 + 1, w);
      const cy0 = clamp(y0, h);
      const cy1 = clamp(y0 + 1, h);
      for (let c = 0; c < 3; c++) {
        const k = components === 3 ? c : 0;
        const at = (xx, yy) => windowed[(yy * w + xx) * components + k];
        const top = at(cx0, cy0) * (1 - fx) + at(cx1, cy0) * fx;
        const bottom = at(cx0, cy1) * (1 - fx) + at(cx1, cy1) * fx;
        out[o + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return out;
}

const clamp = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);
