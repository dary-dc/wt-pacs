// Option A: today's client and painter at 1:1, one canvas and painter a view. docs/viewer/architecture.md §The spike
import { Painter } from "/client/paint/painter.js";
import { paintReference } from "/client/paint/reference.js";
import { open, sleep, windowOf } from "../source.js";

const { q, meta, n, frame, summary } = await open();
const views = n === 4 ? 4 : 1;
document.body.classList.toggle("quad", views === 4);
const canvases = [...Array(views)].map(() => document.body.appendChild(document.createElement("canvas")));
const painters = canvases.map((c) => new Painter(c));
const view = { fit: false, zoom: 1, panX: 0, panY: 0, rotate: 0, flipH: false, flipV: false };
const display = (info, which) => ({
  photometric: meta.photometric ?? "MONOCHROME2", rescale: meta.rescale ?? { slope: 1, intercept: 0 }, invert: false,
  voi: windowOf(meta, info, which), view,
});
const shown = (info, which) => ({ ...display(info, which), view: { ...view, panY: q.get("mutate") === "row" ? 1 : 0 } });
const asPainted = (f) => ({ pixels: f.pixels, width: f.width, height: f.height, bits: f.bits, components: f.components, signed: f.signed });

async function paint(v, i, which = "first", read = false) {
  const f = await frame(i);
  if (f.exact !== true) throw new Error(`frame ${i} is not exact`);
  return painters[v].paint(asPainted(f), shown(f, which), { read });
}

const first = Promise.all(painters.map((_, v) => paint(v, views === 4 ? v : 0))).then(() => ({ ms: performance.now() }));

/** Frame i's readback at 1:1 against the CPU reference: the worst |Δ| and how many device pixels differ. */
async function readback(i, which) {
  const v = views === 4 ? i : 0;
  const f = await frame(i);
  const { pixels } = await paint(v, i, which, true);
  const [w, h] = [canvases[v].clientWidth, canvases[v].clientHeight];
  const ref = paintReference({ ...asPainted(f), samples: new Uint16Array(f.pixels) }, display(f, which), w, h);
  let worst = 0;
  let differing = 0;
  for (let k = 0; k < ref.length; k += 4) {
    const d = Math.max(...[0, 1, 2].map((c) => Math.abs(ref[k + c] - pixels[k + c])));
    worst = Math.max(worst, d);
    if (d) differing++;
  }
  return { worst, differing, compared: w * h };
}

const sweeps = () => [...[...Array(n).keys()], ...[...Array(n).keys()].reverse(), ...[...Array(n).keys()]];

/** Three sweeps, each step once the previous paint is acknowledged. */
async function scroll() {
  const t0 = performance.now();
  const order = sweeps();
  for (const i of order) await paint(0, i);
  return { fps: order.length / ((performance.now() - t0) / 1000), rendered: order };
}

/** One sweep at the image's rate. `wait` false is today's toggleCine: a timer steps, the paint coalesces behind it. */
async function cine({ wait = true } = {}) {
  const ms = meta.frameTimeMs ?? (meta.cineRate ? 1000 / meta.cineRate : 100);
  const rendered = [];
  if (wait) {
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      await paint(0, i);
      rendered.push(i);
      await sleep(ms - (performance.now() - t));
    }
    return { rendered, ms };
  }
  let current = 0;
  let painting = null;
  const repaint = () => (painting ??= (async () => {
    for (let last = -1; last !== current;) await paint(0, (last = current)).then(() => rendered.push(last));
    painting = null;
  })());
  repaint();
  await new Promise((done) => {
    const t = setInterval(() => (current < n - 1 ? (current++, repaint()) : (clearInterval(t), done())), ms);
  });
  while (painting) await painting;
  return { rendered, ms };
}

globalThis.spike = { option: "a", views, first, summary, readback, scroll, cine };
