/** A Cornerstone3D viewport whose frames, digest check, store, paint and cine are our core's. docs/viewer/integration.md §A seam */
import { Viewport, triggerEvent, Enums } from "@cornerstonejs/core";
import { ViewWorker } from "/client/view/view.js";

export const CORE_VIEWPORT = "wtp:core";

/**
 * Canvas units are CSS px. Image pixel (i, j) covers [corner + i·scale, corner + (i+1)·scale); world is index × spacing
 * in mm, so a pixel's centre (i + ½) is world i·spacing; world z is the slice index. The page holds no frame.
 */
export class CoreViewport extends Viewport {
  static get useCustomRenderingPipeline() {
    return true;
  }

  index = 0;
  playing = false;
  voiRange = { lower: 0, upper: 1 };
  scale = 1;
  corner = [0, 0];
  /** The view worker's last `shown`, and every event it sent, for the runner. */
  shown = null;
  heard = [];
  /** Samples the probe asked of the view worker, by `k:i:j`. */
  samples = new Map();
  #sent = { index: -1, display: "" };

  constructor(props) {
    super(props);
    // Cornerstone3D draws its background on its own canvas, so ours is a sibling above it, under the SVG layer.
    this.surface = document.createElement("canvas");
    Object.assign(this.surface.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%" });
    this.canvas.after(this.surface);
  }

  /** The view worker on our canvas, dialled with the whole series as its fill. `transport`: the transport file, with `module`. */
  async open({ meta, transport, decoder, imageIds }) {
    this.meta = meta;
    this.imageIds = imageIds;
    const { center, width } = { center: meta.window.center[0], width: meta.window.width[0] };
    this.voiRange = { lower: center - width / 2, upper: center + width / 2 };
    this.resetCamera();
    this.view = new ViewWorker(this.surface, { meta, fillMode: true, size: this.cssSize(), emit: (type, e) => this.#heard(type, e) });
    const fill = [...Array(meta.frameCount).keys()];
    const digests = meta.digests?.frames;
    await this.view.connect(transport.wt_url, transport.cert_sha256, { transport: transport.module, fill, digests, decoder }, performance.timeOrigin + performance.now());
    this.render();
  }

  #heard(type, e) {
    this.heard.push({ type, at: performance.now(), ...e });
    if (type !== "shown") return;
    const first = !this.shown;
    this.shown = e;
    if (first) return void this.render();
    // During our cine the view worker moves the frame and the tools follow it; otherwise the page does.
    if (this.playing && e.i !== this.index) {
      this.index = e.i;
      this.#sent.index = e.i;
      triggerEvent(this.element, Enums.Events.STACK_NEW_IMAGE, this.#imageEvent());
      this.render();
    }
  }

  cssSize() {
    return { width: this.element.clientWidth, height: this.element.clientHeight, dpr: window.devicePixelRatio || 1 };
  }

  get size() {
    return [this.element.clientWidth, this.element.clientHeight];
  }

  fitScale() {
    const [w, h] = this.size;
    return Math.min(w / this.meta.width, h / this.meta.height);
  }

  fitCorner(scale) {
    const [w, h] = this.size;
    return [(w - scale * this.meta.width) / 2, (h - scale * this.meta.height) / 2];
  }

  resetCamera = () => {
    this.scale = this.fitScale();
    this.corner = this.fitCorner(this.scale);
    return true;
  };

  canvasToWorld = (p, dest = [0, 0, 0]) => {
    const [sx, sy] = this.meta.pixelSpacing;
    dest[0] = ((p[0] - this.corner[0]) / this.scale - 0.5) * sx;
    dest[1] = ((p[1] - this.corner[1]) / this.scale - 0.5) * sy;
    dest[2] = this.index;
    return dest;
  };

  worldToCanvas = (w) => {
    const [sx, sy] = this.meta.pixelSpacing;
    return [this.corner[0] + (w[0] / sx + 0.5) * this.scale, this.corner[1] + (w[1] / sy + 0.5) * this.scale];
  };

  getZoom = () => this.scale / this.fitScale();

  setZoom = (zoom, at = this.size.map((v) => v / 2)) => {
    const next = zoom * this.fitScale();
    this.corner = this.corner.map((c, k) => at[k] - ((at[k] - c) * next) / this.scale);
    this.scale = next;
    this.#cameraModified();
  };

  getPan = () => {
    const fit = this.fitCorner(this.scale);
    return [this.corner[0] - fit[0], this.corner[1] - fit[1]];
  };

  setPan = (pan) => {
    const fit = this.fitCorner(this.scale);
    this.corner = [fit[0] + pan[0], fit[1] + pan[1]];
    this.#cameraModified();
  };

  #cameraModified() {
    const camera = this.getCamera();
    triggerEvent(this.element, Enums.Events.CAMERA_MODIFIED, { previousCamera: camera, camera, element: this.element, viewportId: this.id, renderingEngineId: this.renderingEngineId });
  }

  /** No `position`, so the pan and zoom tools take their canvas-unit path. */
  getCamera = () => ({
    parallelProjection: true,
    focalPoint: this.canvasToWorld(this.size.map((v) => v / 2)),
    viewUp: [0, -1, 0],
    viewPlaneNormal: [0, 0, 1],
    parallelScale: this.size[1] / 2 / this.scale,
  });

  setCamera = () => {};
  getRotation = () => 0;
  getFrameOfReferenceUID = () => "wtp:series";
  getNumberOfSlices = () => this.meta.frameCount;
  getImageIds = () => this.imageIds;
  getCurrentImageIdIndex = () => this.index;
  getSliceIndex = () => this.index;
  getCurrentImageId = () => this.imageIds[this.index];
  getViewReferenceId = () => `imageId:${this.getCurrentImageId()}`;
  getViewReference = (spec) => ({ ...super.getViewReference(spec), referencedImageId: this.getCurrentImageId() });
  hasImageURI = (uri) => this.imageIds.some((id) => id.endsWith(uri));
  getProperties = () => ({ voiRange: { ...this.voiRange }, VOILUTFunction: "LINEAR", invert: false });

  setProperties = ({ voiRange } = {}) => {
    if (!voiRange) return;
    this.voiRange = { ...voiRange };
    triggerEvent(this.element, Enums.Events.VOI_MODIFIED, { viewportId: this.id, range: { ...voiRange }, VOILUTFunction: "LINEAR" });
  };

  scroll = (delta) => {
    this.index = Math.min(this.meta.frameCount - 1, Math.max(0, this.index + delta));
    this.render();
  };

  setImageIdIndex = (i) => {
    this.index = i;
    this.render();
  };

  resize = () => this.#resized();
  resizeForRenderingEngine = () => this.#resized();

  #resized() {
    if (this.shown) this.view.resize(this.cssSize());
    this.render();
  }

  /** The cine is the view worker's own clock, frame 0 due one period from now; the page hears each frame as `shown`. */
  play(fps) {
    this.playing = true;
    this.view.play(fps, performance.timeOrigin + performance.now() + 1000 / fps, "timeout");
  }

  pause() {
    this.playing = false;
    this.view.pause();
  }

  /** Our core's pose: zoom in device px per image px, the pan from where the painter centres and floors. */
  display() {
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = this.size.map((v) => Math.round(v * dpr));
    const zoom = this.scale * dpr;
    const panX = (this.corner[0] * dpr - Math.floor((w - zoom * this.meta.width) / 2)) / dpr;
    const panY = (this.corner[1] * dpr - Math.floor((h - zoom * this.meta.height) / 2)) / dpr;
    const { lower, upper } = this.voiRange;
    return {
      window: { center: (lower + upper) / 2, width: upper - lower, function: "LINEAR_EXACT" },
      pose: { fit: false, zoom, panX, panY, rotate: 0, flipH: false, flipV: false },
    };
  }

  #imageEvent() {
    return { element: this.element, viewportId: this.id, viewport: this, imageIdIndex: this.index, imageId: this.getCurrentImageId(), renderingEngineId: this.renderingEngineId };
  }

  /**
   * The engine calls this on the page; only intents leave it, each sent once, and the view worker paints when it can.
   * None before its first `shown`: a display change before the frame is held stops the core's paint (controller-freeze.test.mjs).
   */
  customRenderViewportToCanvas = () => {
    if (this.shown) {
      const display = this.display();
      const key = JSON.stringify(display);
      if (key !== this.#sent.display) this.view.setDisplay(display);
      if (this.index !== this.#sent.index) {
        this.view.show(this.index);
        triggerEvent(this.element, Enums.Events.STACK_NEW_IMAGE, this.#imageEvent());
      }
      this.#sent = { index: this.index, display: key };
    }
    return { element: this.element, viewportId: this.id, renderingEngineId: this.renderingEngineId, viewport: this, imageIndex: this.index, numberOfSlices: this.meta?.frameCount ?? 0 };
  };

  /**
   * The probe reads a sample synchronously; the samples are in the view worker. Unknown, it answers null and asks
   * `valueAt` at the pixel's centre; the reply renders again, and the tool, which recomputes a null value, reads it.
   */
  #sampleAt([i, j, k]) {
    const key = `${k}:${i}:${j}`;
    if (this.samples.has(key)) return this.samples.get(key);
    const [x, y] = this.worldToCanvas([i * this.meta.pixelSpacing[0], j * this.meta.pixelSpacing[1], k]);
    this.view.valueAt(x, y).then((v) => {
      if (v && v.i === k && v.x === i && v.y === j) {
        this.samples.set(key, v.stored[0]);
        this.render();
      }
    });
    return null;
  }

  getImageData() {
    const { width, height, pixelSpacing: [sx, sy] } = this.meta;
    const imageData = {
      getDirection: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
      getDimensions: () => [width, height, 1],
      getSpacing: () => [sx, sy, 1],
      getRange: () => [this.voiRange.lower, this.voiRange.upper],
      worldToIndex: (w) => [w[0] / sx, w[1] / sy, 0],
      indexToWorld: (i, dest = [0, 0, 0]) => Object.assign(dest, [i[0] * sx, i[1] * sy, this.index]),
    };
    const sampleAt = (ijk) => this.#sampleAt(ijk);
    return {
      dimensions: [width, height, 1],
      spacing: [sx, sy, 1],
      origin: [0, 0, 0],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      metadata: { Modality: this.meta.modality, FrameOfReferenceUID: "wtp:series" },
      imageData,
      // The probe puts the slice index in k (ProbeTool's stack branch).
      voxelManager: { getAtIJKPoint: sampleAt, getAtIJK: (i, j, k) => sampleAt([i, j, k]) },
      hasPixelSpacing: true,
      preScale: { scaled: false },
    };
  }
}
