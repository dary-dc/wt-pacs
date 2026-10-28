// Option B: Cornerstone3D paints today's client's frames, through a 'wtp:' loader, at 1:1. docs/viewer/architecture.md §The spike
import { Enums, RenderingEngine, imageLoader, init, initTools, metaData, toolUtilities, utilities } from "./dist/cs.js";
import { windowTable } from "/client/paint/voi.js";
import { open, sleep, windowOf } from "../source.js";

const { q, meta, n, frame, summary } = await open();
const views = n === 4 ? 4 : 1;
document.body.classList.toggle("quad", views === 4);
const elements = [...Array(views)].map(() => document.body.appendChild(document.createElement("div")));
const ids = [...Array(n).keys()].map((i) => `wtp:${i}`);

async function load(imageId) {
  const i = Number(imageId.slice(4));
  const f = await frame(i);
  if (f.exact !== true) throw new Error(`frame ${i} is not exact`);
  const pixels = new Uint16Array(f.pixels);
  const voi = windowOf(meta, f, "first");
  const { width, height } = f;
  return {
    imageId, width, height, rows: height, columns: width, minPixelValue: f.min, maxPixelValue: f.max, slope: 1, intercept: 0,
    windowCenter: voi.center, windowWidth: voi.width, voiLUTFunction: voi.function, color: false, rgba: false, invert: false,
    numberOfComponents: 1, columnPixelSpacing: 1, rowPixelSpacing: 1, sizeInBytes: pixels.byteLength, dataType: "Uint16Array",
    photometricInterpretation: "MONOCHROME2", getPixelData: () => pixels,
    voxelManager: utilities.VoxelManager.createImageVoxelManager({ width, height, numberOfComponents: 1, scalarData: pixels }),
  };
}

/** The modules a stack reads, from the series metadata: one plane per frame, 1 mm apart. */
function provide(type, imageId) {
  if (!imageId?.startsWith("wtp:")) return undefined;
  const i = Number(imageId.slice(4));
  const f = { rows: meta.height, columns: meta.width };
  const voi = windowOf(meta, {}, "first");
  return {
    imagePixelModule: { samplesPerPixel: 1, photometricInterpretation: "MONOCHROME2", ...f, bitsAllocated: 16,
      bitsStored: meta.bitsStored, highBit: meta.bitsStored - 1, pixelRepresentation: 0 },
    generalSeriesModule: { modality: meta.modality ?? "MG" },
    imagePlaneModule: { ...f, frameOfReferenceUID: "spike", imageOrientationPatient: [1, 0, 0, 0, 1, 0], rowCosines: [1, 0, 0],
      columnCosines: [0, 1, 0], imagePositionPatient: [0, 0, i], pixelSpacing: [1, 1], rowPixelSpacing: 1, columnPixelSpacing: 1 },
    voiLutModule: { windowCenter: [voi.center], windowWidth: [voi.width], voiLUTFunction: voi.function },
    modalityLutModule: { rescaleSlope: 1, rescaleIntercept: 0 },
  }[type];
}

init();
initTools();
imageLoader.registerImageLoader("wtp", (imageId) => ({ promise: load(imageId) }));
metaData.addProvider(provide, 10000);
const engine = new RenderingEngine("spike");
const oneToOne = { type: "SCALE", scale: 1, storeAsInitialCamera: true };
engine.setViewports(elements.map((element, v) => ({ viewportId: `v${v}`, type: Enums.ViewportType.STACK, element,
  defaultOptions: { displayArea: oneToOne } })));
const viewports = elements.map((_, v) => engine.getViewport(`v${v}`));

/** The next render of viewport v showing stack index i. */
const rendered = (v, i) => new Promise((resolve) => {
  const on = () => viewports[v].getCurrentImageIdIndex() === i && (elements[v].removeEventListener(Enums.Events.IMAGE_RENDERED, on), resolve());
  elements[v].addEventListener(Enums.Events.IMAGE_RENDERED, on);
});

async function show(v, i) {
  const done = rendered(v, i);
  if (viewports[v].getCurrentImageIdIndex() === i) viewports[v].render();
  else await viewports[v].setImageIdIndex(i);
  await done;
}

const first = Promise.all(viewports.map(async (vp, v) => {
  const done = rendered(v, 0);
  await vp.setStack(views === 4 ? [ids[v]] : ids, 0);
  vp.setDisplayArea(oneToOne);
  vp.render();
  await done;
})).then(() => ({ ms: performance.now() }));

/** Frame i's readback at 1:1 against our table: each canvas pixel's sample, where Cornerstone3D says it is. */
async function readback(i, which) {
  const [v, index] = views === 4 ? [i, 0] : [0, i];
  const vp = viewports[v];
  const f = await frame(i);
  const voi = windowOf(meta, f, which);
  vp.setProperties({ voiRange: utilities.windowLevel.toLowHighRange(voi.width, voi.center, voi.function), VOILUTFunction: voi.function });
  await show(v, index);
  const at = (x, y) => utilities.worldToImageCoords(ids[views === 4 ? v : i], vp.canvasToWorld([x, y]));
  const [p0, p1] = [at(0.5, 0.5), at(1.5, 1.5)];
  const step = [p1[0] - p0[0], p1[1] - p0[1]];
  if (q.get("mutate") === "row") {
    const cam = vp.getCamera();
    const up = cam.viewUp.map((u) => u * vp.getImageData().spacing[1]);
    vp.setCamera({ focalPoint: cam.focalPoint.map((c, k) => c + up[k]), position: cam.position.map((c, k) => c + up[k]) });
    await show(v, index);
  }
  const canvas = vp.getCanvas();
  const { width: w, height: h } = canvas;
  const got = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const table = windowTable({ bits: 16, signed: false, components: 1 }, { photometric: "MONOCHROME2", voi, rescale: { slope: 1, intercept: 0 } });
  const samples = new Uint16Array(f.pixels);
  let worst = 0;
  let differing = 0;
  let compared = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [col, row] = [Math.floor(p0[0] + x + 1e-6), Math.floor(p0[1] + y + 1e-6)];
      if (col < 0 || row < 0 || col >= f.width || row >= f.height) continue;
      const want = table[samples[row * f.width + col]];
      const k = (y * w + x) * 4;
      const d = Math.max(Math.abs(got[k] - want), Math.abs(got[k + 1] - want), Math.abs(got[k + 2] - want));
      worst = Math.max(worst, d);
      if (d) differing++;
      compared++;
    }
  }
  if (q.get("mutate") === "row") vp.resetCamera();
  return { worst, differing, compared, step, origin: p0 };
}

const sweeps = () => [...[...Array(n).keys()], ...[...Array(n).keys()].reverse(), ...[...Array(n).keys()]];

/** Three sweeps, each step once the previous image has rendered. */
async function scroll() {
  const t0 = performance.now();
  const order = sweeps();
  for (const i of order) await show(0, i);
  return { fps: order.length / ((performance.now() - t0) / 1000), rendered: order };
}

/** One sweep by Cornerstone3D's own cine at the image's rate, every render's index recorded. */
async function cine() {
  const ms = meta.frameTimeMs ?? (meta.cineRate ? 1000 / meta.cineRate : 100);
  await show(0, 0);
  const rendered = [0];
  const on = () => rendered.push(viewports[0].getCurrentImageIdIndex());
  elements[0].addEventListener(Enums.Events.IMAGE_RENDERED, on);
  toolUtilities.cine.playClip(elements[0], { framesPerSecond: 1000 / ms, loop: false });
  const until = performance.now() + n * ms * 4 + 10000;
  while (rendered.at(-1) !== n - 1 && performance.now() < until) await sleep(ms);
  toolUtilities.cine.stopClip(elements[0]);
  elements[0].removeEventListener(Enums.Events.IMAGE_RENDERED, on);
  return { rendered, ms };
}

globalThis.spike = { option: "b", views, first, summary, readback, scroll, cine };
