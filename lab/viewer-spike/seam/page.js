/** The spike's page: three synthetic 16-bit slices in one worker-painted viewport, and Cornerstone3D's tools on it. */
import { init as initCore, RenderingEngine, registerViewportType, getRenderingEngine } from "@cornerstonejs/core";
import * as tools from "@cornerstonejs/tools";
import { WorkerViewport, WORKER_VIEWPORT } from "./worker-viewport.js";
import { windowTable, tableShape } from "/client/paint/voi.js";

export const W = 64, H = 48, SLICES = 3, SPACING = [0.5, 0.5];
/** A ramp, so a one-pixel shift of the painted image moves its windowed code by more than the check's tolerance. */
export const sample = (i, j, k) => 2000 + 40 * i + 25 * j + 3000 * k;

function frames() {
  return Array.from({ length: SLICES }, (_, k) => {
    const pixels = new SharedArrayBuffer(W * H * 2);
    const view = new Uint16Array(pixels);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) view[i + j * W] = sample(i, j, k);
    return { imageId: `wtp:spike/${k}`, pixels, width: W, height: H, bits: 16, components: 1, signed: false, spacing: SPACING };
  });
}

async function start() {
  await initCore();
  tools.init();
  registerViewportType({ type: WORKER_VIEWPORT, ViewportClass: WorkerViewport });
  const engine = new RenderingEngine("spike");
  const element = document.getElementById("vp");
  engine.enableElement({ viewportId: "vp", type: WORKER_VIEWPORT, element });
  const viewport = engine.getViewport("vp");
  viewport.setFrames(frames(), { lower: 2000, upper: 6000 });
  await viewport.painter.renderer;

  const { ToolGroupManager, LengthTool, ProbeTool, WindowLevelTool, StackScrollTool, ZoomTool, PanTool, Enums } = tools;
  for (const T of [LengthTool, ProbeTool, WindowLevelTool, StackScrollTool, ZoomTool, PanTool]) tools.addTool(T);
  const group = ToolGroupManager.createToolGroup("spike");
  for (const T of [LengthTool, ProbeTool, WindowLevelTool, StackScrollTool, ZoomTool, PanTool]) group.addTool(T.toolName);
  group.addViewport("vp", "spike");
  group.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: Enums.MouseBindings.Wheel }] });

  /** The runner's handle. */
  window.spike = {
    viewport,
    activate(name) {
      for (const T of [LengthTool, ProbeTool, WindowLevelTool, ZoomTool, PanTool]) if (T.toolName !== name) group.setToolPassive(T.toolName);
      group.setToolActive(name, { bindings: [{ mouseButton: Enums.MouseBindings.Primary }] });
    },
    annotations: (name) => (tools.annotation.state.getAnnotations(name, element) ?? []).map((a) => ({ points: a.data.handles.points, stats: a.data.cachedStats })),
    clear: () => tools.annotation.state.removeAllAnnotations(),
    /** Slice 0, the fit, the first window, no annotations. */
    reset() {
      tools.annotation.state.removeAllAnnotations();
      viewport.setFrames(viewport.frames, { lower: 2000, upper: 6000 });
      viewport.render();
    },
    /** The element's offset on the page, so the runner can point at canvas coordinates. */
    origin: () => { const r = element.getBoundingClientRect(); return [r.left, r.top]; },
    /** Canvas point of the centre of pixel (i, j), from the camera alone, not from the viewport's transforms. */
    pixelCentre: (i, j) => [viewport.corner[0] + (i + 0.5) * viewport.scale, viewport.corner[1] + (j + 0.5) * viewport.scale],
    async painted(x, y) {
      await getRenderingEngine("spike").render();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await viewport.painted;
      const dpr = devicePixelRatio, w = Math.round(element.clientWidth * dpr);
      const { pixels } = await viewport.readback();
      return pixels[(Math.floor(y * dpr) * w + Math.floor(x * dpr)) * 4];
    },
    /** What our window table makes of a code under the window the tools last set (`getProperties`). */
    expectedCode(code) {
      const { lower, upper } = viewport.getProperties().voiRange;
      const f = viewport.frame;
      const table = windowTable(f, { voi: { center: (lower + upper) / 2, width: upper - lower, function: "LINEAR_EXACT" } });
      return table[code + tableShape(f).offset];
    },
    sample,
  };
  window.spikeReady = true;
}

start().catch((e) => { window.spikeError = String(e?.stack ?? e); });
