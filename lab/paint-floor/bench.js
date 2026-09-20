/**
 * The instrument: loads decoded sample sets, paints them both ways, and answers the two
 * questions — are the routes pixel-equal, and what does each cost. lab/paint-floor/README.md.
 */
import { Canvas2DRoute, WebGL2Route, windows } from "./routes.js";

const state = { sets: null, frames: {}, routes: null, canvases: null };

const viewOf = (set, buffer) =>
  set.bits > 8
    ? (set.signed ? new Int16Array(buffer) : new Uint16Array(buffer))
    : new Uint8Array(buffer);

async function load(dir) {
  state.sets = await (await fetch(`${dir}/manifest.json`)).json();
  for (const [name, set] of Object.entries(state.sets)) {
    state.frames[name] = [];
    for (let i = 0; i < set.frames; i++) {
      const bytes = await (await fetch(`${dir}/${name}/${String(i).padStart(3, "0")}.raw`)).arrayBuffer();
      const shared = new SharedArrayBuffer(bytes.byteLength);
      new Uint8Array(shared).set(new Uint8Array(bytes));
      state.frames[name].push({ ...set, samples: viewOf(set, shared) });
    }
  }
}

function size(out) {
  for (const c of state.canvases) {
    if (c.width !== out.w || c.height !== out.h) {
      c.width = out.w;
      c.height = out.h;
    }
    c.style.width = `${out.w / devicePixelRatio}px`;
    c.style.height = `${out.h / devicePixelRatio}px`;
  }
}

const display = (set, css) => ({
  w: Math.round(css.w * devicePixelRatio),
  h: Math.round(css.h * devicePixelRatio),
});

const heap = () => performance.memory?.usedJSHeapSize ?? NaN;

/**
 * The source coordinate lands exactly on a texel edge, where canvas 2D's float arithmetic and the
 * shader's exact integers may pick either side. Never true at 1:1 or any integer magnification.
 */
const onEdge = (i, dst, src) => ((2 * i + 1) * src) % (2 * dst) === 0;

/** One paint per animation frame, so `raf` is what the paint costs the next frame, not phase. */
function inFrame(fn) {
  return new Promise((resolve) =>
    requestAnimationFrame(() => {
      const h0 = heap();
      const t0 = performance.now();
      fn();
      const t1 = performance.now();
      const used = heap() - h0;
      requestAnimationFrame(() => resolve({ main: t1 - t0, raf: performance.now() - t1, used }));
    }));
}

function check(name, which, out, smooth = false) {
  const set = state.sets[name];
  out ??= { w: set.width, h: set.height };
  size(out);
  const frame = state.frames[name][0];
  const win = windows(set)[which];
  const [two, gl] = state.routes;
  two.paint(frame, win, out, smooth);
  const a = two.readback(out);
  gl.paint(frame, win, out);
  const b = gl.readback(out);

  const cols = Array.from({ length: out.w }, (_, x) => onEdge(x, out.w, set.width));
  const rows = Array.from({ length: out.h }, (_, y) => onEdge(y, out.h, set.height));
  let mismatched = 0;
  let decided = 0;
  let onEdges = 0;
  let worst = 0;
  let first = null;
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const edge = cols[x] || rows[y];
      if (edge) onEdges += 3;
      for (let c = 0; c < 3; c++) {
        const i = (y * out.w + x) * 4 + c;
        const d = Math.abs(a[i] - b[i]);
        if (d === 0) continue;
        mismatched++;
        if (!edge) decided++;
        if (d > worst) worst = d;
        if (!first) first = { x, y, channel: c, edge, "2d": a[i], gl: b[i] };
      }
    }
  }
  return {
    set: name, window: which, src: `${set.width}x${set.height}`, ...out,
    samples: (a.length / 4) * 3, onEdges, mismatched, decided, worst, first,
  };
}

async function run(opts) {
  const set = state.sets[opts.set];
  const out = display(set, opts.css);
  size(out);
  const win = windows(set)[opts.window];
  const rows = { "2d": [], gl: [] };
  const step = (i) => (opts.drag
    ? { lo: set.min + Math.round((set.max - set.min) * 0.6 * i / opts.paints), range: win.range }
    : win);

  for (const r of state.routes) await inFrame(() => r.paint(state.frames[opts.set][0], win, out, opts.smooth));

  for (let i = 0; i < opts.paints; i++) {
    const frame = state.frames[opts.set][i % set.frames];
    const w = step(i);
    const order = i % 2 ? [state.routes[1], state.routes[0]] : state.routes;
    for (const r of order) {
      rows[r.constructor.label].push(await inFrame(() => r.paint(frame, w, out, opts.smooth)));
    }
  }
  return { ...opts, dpr: devicePixelRatio, out, rows };
}

globalThis.__paint = {
  ready: (async () => {
    await load("./frames");
    state.canvases = [document.getElementById("two"), document.getElementById("gl")];
    state.routes = [new Canvas2DRoute(state.canvases[0]), new WebGL2Route(state.canvases[1])];
    return { renderer: state.routes[1].renderer(), sets: state.sets, dpr: devicePixelRatio };
  })(),
  check,
  run,
};
