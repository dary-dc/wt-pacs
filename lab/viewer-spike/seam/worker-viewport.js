/** A Cornerstone3D viewport whose pixels our paint worker draws. docs/viewer/integration.md §A seam for our painter */
import { Viewport, triggerEvent, Enums } from "@cornerstonejs/core";
import { Painter } from "/client/paint/painter.js";

export const WORKER_VIEWPORT = "wtp:worker";

/**
 * Canvas units are CSS px. Image pixel (i, j) covers [corner + i·scale, corner + (i+1)·scale);
 * world is index × spacing in mm, so a pixel's centre (i + ½) is world i·spacing; world z is the slice index.
 */
export class WorkerViewport extends Viewport {
  static get useCustomRenderingPipeline() {
    return true;
  }

  frames = [];
  index = 0;
  voiRange = { lower: 0, upper: 1 };
  scale = 1;
  corner = [0, 0];

  constructor(props) {
    super(props);
    // Cornerstone3D draws its background on its own canvas, so ours is a sibling above it, under the SVG layer.
    this.surface = document.createElement("canvas");
    Object.assign(this.surface.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%" });
    this.canvas.after(this.surface);
    this.painter = new Painter(this.surface);
  }

  /** `frames`: `{ imageId, pixels, width, height, bits, components, signed, spacing }`, one per slice. */
  setFrames(frames, voiRange) {
    this.frames = frames;
    this.index = 0;
    this.voiRange = { ...voiRange };
    this.resetCamera();
  }

  get frame() {
    return this.frames[this.index];
  }

  get size() {
    return [this.element.clientWidth, this.element.clientHeight];
  }

  fitScale() {
    const [w, h] = this.size;
    return Math.min(w / this.frame.width, h / this.frame.height);
  }

  fitCorner(scale) {
    const [w, h] = this.size;
    return [(w - scale * this.frame.width) / 2, (h - scale * this.frame.height) / 2];
  }

  resetCamera = () => {
    this.scale = this.fitScale();
    this.corner = this.fitCorner(this.scale);
    return true;
  };

  canvasToWorld = (p, dest = [0, 0, 0]) => {
    const [sx, sy] = this.frame.spacing;
    dest[0] = ((p[0] - this.corner[0]) / this.scale - 0.5) * sx;
    dest[1] = ((p[1] - this.corner[1]) / this.scale - 0.5) * sy;
    dest[2] = this.index;
    return dest;
  };

  worldToCanvas = (w) => {
    const [sx, sy] = this.frame.spacing;
    return [this.corner[0] + (w[0] / sx + 0.5) * this.scale, this.corner[1] + (w[1] / sy + 0.5) * this.scale];
  };

  getZoom = () => this.scale / this.fitScale();

  setZoom = (zoom, at = this.size.map((v) => v / 2)) => {
    const next = zoom * this.fitScale();
    this.corner = this.corner.map((c, k) => at[k] - ((at[k] - c) * next) / this.scale);
    this.scale = next;
  };

  getPan = () => {
    const fit = this.fitCorner(this.scale);
    return [this.corner[0] - fit[0], this.corner[1] - fit[1]];
  };

  setPan = (pan) => {
    const fit = this.fitCorner(this.scale);
    this.corner = [fit[0] + pan[0], fit[1] + pan[1]];
  };

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
  getFrameOfReferenceUID = () => "wtp:spike";
  getNumberOfSlices = () => this.frames.length;
  getImageIds = () => this.frames.map((f) => f.imageId);
  getCurrentImageIdIndex = () => this.index;
  getSliceIndex = () => this.index;
  getCurrentImageId = () => this.frame?.imageId;
  getViewReferenceId = () => `imageId:${this.getCurrentImageId()}`;
  getViewReference = (spec) => ({ ...super.getViewReference(spec), referencedImageId: this.getCurrentImageId() });
  hasImageURI = (uri) => this.frames.some((f) => f.imageId.endsWith(uri));
  getProperties = () => ({ voiRange: { ...this.voiRange }, VOILUTFunction: "LINEAR", invert: false });

  setProperties = ({ voiRange } = {}) => {
    if (voiRange) this.voiRange = { ...voiRange };
  };

  scroll = (delta) => {
    this.index = Math.min(this.frames.length - 1, Math.max(0, this.index + delta));
    this.render();
  };

  resize = () => this.render();
  resizeForRenderingEngine = () => this.render();

  /** Our painter's display: 1:1 pixels have zoom 1 at DPR 1; the painter centres, floors, then pans. */
  display() {
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = this.size.map((v) => Math.round(v * dpr));
    const zoom = this.scale * dpr;
    const panX = (this.corner[0] * dpr - Math.floor((w - zoom * this.frame.width) / 2)) / dpr;
    const panY = (this.corner[1] * dpr - Math.floor((h - zoom * this.frame.height) / 2)) / dpr;
    const { lower, upper } = this.voiRange;
    return {
      photometric: "MONOCHROME2",
      voi: { center: (lower + upper) / 2, width: upper - lower, function: "LINEAR_EXACT" },
      view: { fit: false, zoom, panX, panY },
    };
  }

  /** The engine calls this on the page; the paint itself runs in the worker and lands a frame or more later. */
  customRenderViewportToCanvas = () => {
    this.sent = { frame: this.frame, display: this.display() };
    this.painted = this.painter.paint(this.sent.frame, this.sent.display);
    triggerEvent(this.element, Enums.Events.STACK_NEW_IMAGE, { element: this.element, viewportId: this.id, viewport: this, imageIdIndex: this.index, imageId: this.getCurrentImageId(), renderingEngineId: this.renderingEngineId });
    return { element: this.element, viewportId: this.id, renderingEngineId: this.renderingEngineId, viewport: this, imageIndex: this.index, numberOfSlices: this.frames.length };
  };

  /** The last paint sent, again, read back: rows top-down, RGBA, at device size. */
  readback() {
    return this.painter.paint(this.sent.frame, this.sent.display, { read: true });
  }

  getImageData() {
    const f = this.frame;
    const [sx, sy] = f.spacing;
    const sampleAt = ([i, j, k]) => new Uint16Array(this.frames[k].pixels)[i + j * f.width];
    const imageData = {
      getDirection: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
      getDimensions: () => [f.width, f.height, 1],
      getSpacing: () => [sx, sy, 1],
      getRange: () => [this.voiRange.lower, this.voiRange.upper],
      worldToIndex: (w) => [w[0] / sx, w[1] / sy, 0],
      indexToWorld: (i, dest = [0, 0, 0]) => Object.assign(dest, [i[0] * sx, i[1] * sy, this.index]),
    };
    return {
      dimensions: [f.width, f.height, 1],
      spacing: [sx, sy, 1],
      origin: [0, 0, 0],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      metadata: { Modality: "MG", FrameOfReferenceUID: "wtp:spike" },
      imageData,
      // The probe puts the slice index in k (ProbeTool's stack branch); the samples are the frame's shared memory.
      voxelManager: { getAtIJKPoint: sampleAt, getAtIJK: (i, j, k) => sampleAt([i, j, k]) },
      hasPixelSpacing: true,
      preScale: { scaled: false },
    };
  }
}
