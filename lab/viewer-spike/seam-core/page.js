/** The spike's page: two core viewports on one served series, and Cornerstone3D's tools on them. */
import { seen } from "./instrument.js";
import { init as initCore, RenderingEngine, registerViewportType, getRenderingEngine, metaData, imageLoader, cache, Enums as CoreEnums } from "@cornerstonejs/core";
import * as tools from "@cornerstonejs/tools";
import { CoreViewport, CORE_VIEWPORT } from "./core-viewport.js";
import { built } from "/client/decode/wasm-glue.js";
import { windowTable, tableShape } from "/client/paint/voi.js";

const IDS = ["vp1", "vp2"];
/** Every metadata module the tools ask for, and every image Cornerstone3D's loader is asked to load. */
const asked = { metadata: new Set(), loads: [] };

async function start() {
  const [meta, transport] = await Promise.all(["/series/metadata", "/wt/dev-transport.json"].map((u) => fetch(u).then((r) => r.json())));
  transport.module = "/client/transport/ts/dist/session.js";
  const decoder = await built("openjph");
  await initCore();
  tools.init();
  metaData.addProvider((type) => void asked.metadata.add(type), 10_000);
  imageLoader.registerImageLoader("wtp", (imageId) => (asked.loads.push(imageId), { promise: new Promise(() => {}) }));
  registerViewportType({ type: CORE_VIEWPORT, ViewportClass: CoreViewport });
  const engine = new RenderingEngine("spike");
  const imageIds = Array.from({ length: meta.frameCount }, (_, k) => `wtp:series/${k}`);
  const viewports = {};
  for (const id of IDS) {
    engine.enableElement({ viewportId: id, type: CORE_VIEWPORT, element: document.getElementById(id) });
    viewports[id] = engine.getViewport(id);
  }
  await Promise.all(IDS.map((id) => viewports[id].open({ meta, transport, decoder, imageIds })));

  const { ToolGroupManager, SynchronizerManager, synchronizers, LengthTool, AngleTool, ProbeTool, WindowLevelTool, StackScrollTool, ZoomTool, PanTool, Enums } = tools;
  const PRIMARY = [LengthTool, AngleTool, ProbeTool, WindowLevelTool, ZoomTool, PanTool];
  for (const T of [...PRIMARY, StackScrollTool]) tools.addTool(T);
  const group = ToolGroupManager.createToolGroup("spike");
  for (const T of [...PRIMARY, StackScrollTool]) group.addTool(T.toolName);
  for (const id of IDS) group.addViewport(id, "spike");
  group.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: Enums.MouseBindings.Wheel }] });

  /** Linked views: Cornerstone3D's own callbacks, or ours on its synchronizer machinery. */
  const LINKS = {
    stockVoi: () => synchronizers.createVOISynchronizer("link"),
    stockZoomPan: () => synchronizers.createZoomPanSynchronizer("link"),
    ourVoi: () => SynchronizerManager.createSynchronizer("link", CoreEnums.Events.VOI_MODIFIED, (_s, _from, to, e) => {
      const target = getRenderingEngine(to.renderingEngineId).getViewport(to.viewportId);
      target.voiRange = { ...e.detail.range };
      target.render();
    }),
    ourZoomPan: () => SynchronizerManager.createSynchronizer("link", CoreEnums.Events.CAMERA_MODIFIED, (_s, from, to) => {
      const engine = getRenderingEngine(to.renderingEngineId);
      const source = engine.getViewport(from.viewportId), target = engine.getViewport(to.viewportId);
      [target.scale, target.corner] = [source.scale, [...source.corner]];
      target.render();
    }),
  };

  const vp = viewports.vp1;
  /** The runner's handle. */
  window.spike = {
    viewports,
    seen,
    asked: () => ({ metadata: [...asked.metadata].sort(), loads: asked.loads.length, cacheBytes: cache.getCacheSize() }),
    activate(name) {
      for (const T of PRIMARY) if (T.toolName !== name) group.setToolPassive(T.toolName);
      group.setToolActive(name, { bindings: [{ mouseButton: Enums.MouseBindings.Primary }] });
    },
    annotations: (name) => (tools.annotation.state.getAnnotations(name, vp.element) ?? []).map((a) => ({ points: a.data.handles.points, stats: a.data.cachedStats })),
    /** How many of the tool's annotations the SVG layer of `id` draws now. */
    drawn: (id = "vp1") => document.querySelectorAll(`#${id} svg [data-annotation-uid]`).length,
    clear: () => tools.annotation.state.removeAllAnnotations(),
    link(kind) {
      SynchronizerManager.destroy();
      const s = LINKS[kind]();
      for (const id of IDS) s.add({ renderingEngineId: "spike", viewportId: id });
    },
    unlink: () => SynchronizerManager.destroy(),
    prefetch: () => tools.utilities.stackPrefetch.enable(vp.element),
    /** Slice 0, the fit, the metadata's window, no annotations, no link, both viewports. */
    async reset() {
      tools.annotation.state.removeAllAnnotations();
      SynchronizerManager.destroy();
      for (const v of Object.values(viewports)) {
        await v.pause();
        const { center, width } = { center: meta.window.center[0], width: meta.window.width[0] };
        v.voiRange = { lower: center - width / 2, upper: center + width / 2 };
        v.index = 0;
        v.resetCamera();
        v.render();
      }
      await spike.shownAll();
    },
    /** Resolves once each viewport's view worker has painted what the viewport last asked. */
    shownAll: () => Promise.all(Object.values(viewports).map((v) => v.view.repaint())),
    origin: (id = "vp1") => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left, r.top]; },
    /** Canvas point of the centre of pixel (i, j), from the camera alone, not from the viewport's transforms. */
    pixelCentre: (i, j, id = "vp1") => { const v = viewports[id]; return [v.corner[0] + (i + 0.5) * v.scale, v.corner[1] + (j + 0.5) * v.scale]; },
    /** What our window table makes of a code under the window the viewport's tools last set. */
    expectedCode(code, id = "vp1") {
      const { lower, upper } = viewports[id].getProperties().voiRange;
      const f = { bits: 16, signed: false, components: 1 };
      const table = windowTable(f, { voi: { center: (lower + upper) / 2, width: upper - lower, function: "LINEAR_EXACT" } });
      return table[code + tableShape(f).offset];
    },
    meta,
  };
  window.spikeReady = true;
}

start().catch((e) => { window.spikeError = String(e?.stack ?? e); });
