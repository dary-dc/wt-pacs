/** Option A for the proxy: Cornerstone3D's stack viewport, painted on the page, its images from our core on the page. */
import "./instrument.js";
import { init as initCore, RenderingEngine, Enums, imageLoader, metaData, utilities, eventTarget } from "@cornerstonejs/core";
import * as tools from "@cornerstonejs/tools";
import { DownloaderClient } from "/client/transport/consumer.js";
import { built } from "/client/decode/wasm-glue.js";
import { measure } from "./measure.js";

async function start() {
  const [meta, transport] = await Promise.all(["/series/metadata", "/wt/dev-transport.json"].map((u) => fetch(u).then((r) => r.json())));
  await initCore();
  tools.init();
  const { width, height, pixelSpacing } = meta;
  const n = meta.frameCount;
  const arrived = Array.from({ length: n }, () => Promise.withResolvers());
  imageLoader.registerImageLoader("wtpa", (imageId) => {
    const k = Number(imageId.split("/")[1]);
    const promise = arrived[k].promise.then((info) => {
      const scalarData = new Uint16Array(info.pixels);
      return {
        imageId, rows: height, columns: width, height, width, minPixelValue: info.min, maxPixelValue: info.max, slope: 1, intercept: 0,
        windowCenter: meta.window.center[0], windowWidth: meta.window.width[0], getPixelData: () => scalarData, color: false, rgba: false,
        numberOfComponents: 1, columnPixelSpacing: pixelSpacing[0], rowPixelSpacing: pixelSpacing[1], invert: false, sizeInBytes: scalarData.byteLength,
        dataType: "Uint16Array", voxelManager: utilities.VoxelManager.createImageVoxelManager({ width, height, scalarData }),
      };
    });
    return { promise };
  });
  const MODULES = {
    imagePlaneModule: (k) => ({ rows: height, columns: width, pixelSpacing, rowPixelSpacing: pixelSpacing[1], columnPixelSpacing: pixelSpacing[0],
      imagePositionPatient: [0, 0, k], imageOrientationPatient: [1, 0, 0, 0, 1, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0], frameOfReferenceUID: "wtp:series", sliceThickness: 1 }),
    imagePixelModule: () => ({ bitsAllocated: 16, bitsStored: 16, highBit: 15, pixelRepresentation: 0, photometricInterpretation: "MONOCHROME2", samplesPerPixel: 1 }),
    generalSeriesModule: () => ({ modality: meta.modality }),
    voiLutModule: () => ({ windowCenter: meta.window.center, windowWidth: meta.window.width }),
    modalityLutModule: () => ({ rescaleSlope: 1, rescaleIntercept: 0 }),
  };
  metaData.addProvider((type, imageId) => (imageId?.startsWith("wtpa:") ? MODULES[type]?.(Number(imageId.split("/")[1])) : undefined), 10_000);

  const engine = new RenderingEngine("standard");
  const element = document.getElementById("vp1");
  engine.enableElement({ viewportId: "vp1", type: Enums.ViewportType.STACK, element });
  const viewport = engine.getViewport("vp1");
  const imageIds = Array.from({ length: n }, (_, k) => `wtpa:series/${k}`);
  const m = measure();
  element.addEventListener(Enums.Events.IMAGE_RENDERED, () => m.painted(viewport.getCurrentImageIdIndex(), performance.now()));
  const decoder = await built("openjph");
  await DownloaderClient.connect(transport.wt_url, transport.cert_sha256, {
    transport: "/client/transport/ts/dist/session.js", fill: [...Array(n).keys()], digests: meta.digests.frames, decoder,
    onFrame: (f) => f.info.exact === true && arrived[f.frameIndex].resolve(f.info),
    onError: ({ frameIndex, reason }) => console.error(frameIndex, reason),
  });
  await viewport.setStack(imageIds, 0);
  viewport.render();
  Promise.all(arrived.map((a) => a.promise)).then(() => m.filled());

  window.proxy = m.handle({
    step: (i) => viewport.setImageIdIndex(i),
    play: (fps) => tools.utilities.cine.playClip(element, { framesPerSecond: fps, loop: true }),
    pause: () => tools.utilities.cine.stopClip(element),
  });
  window.spikeReady = true;
}

start().catch((e) => { window.spikeError = String(e?.stack ?? e); });
