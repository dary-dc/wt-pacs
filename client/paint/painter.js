/** The painter's page half: the canvas to the paint worker, one promise a paint. client/paint/README.md */
export class Painter {
  #worker;
  #canvas;
  #next = 0;
  #pending = new Map();
  #lost = null;
  #last = null;

  /** `renderer` resolves to the WebGL renderer string, or rejects with why nothing can be painted. */
  constructor(canvas, { workerUrl = new URL("./paint-worker.js", import.meta.url), onLost = () => {} } = {}) {
    this.#canvas = canvas;
    this.#worker = new Worker(workerUrl, { type: "module" });
    const offscreen = canvas.transferControlToOffscreen();
    this.renderer = new Promise((resolve, reject) => {
      this.#worker.onerror = (e) => {
        this.#lost = `the paint worker did not start: ${e.message ?? "load failed"}`;
        reject(new Error(this.#lost));
        onLost(this.#lost);
      };
      this.#worker.onmessage = ({ data }) => {
        if (data.kind === "ready") return resolve(data.renderer);
        if (data.kind === "lost") {
          this.#lost = data.reason;
          reject(new Error(data.reason));
          for (const p of this.#pending.values()) p.reject(new Error(data.reason));
          this.#pending.clear();
          return onLost(data.reason);
        }
        const p = this.#pending.get(data.id);
        this.#pending.delete(data.id);
        if (data.error) p.reject(new Error(data.error));
        else p.resolve({ ms: data.ms, uploaded: data.uploaded, pixels: data.pixels });
      };
    });
    this.#worker.postMessage({ kind: "start", canvas: offscreen }, [offscreen]);
  }

  /** At the canvas's CSS size × devicePixelRatio; `read` returns the RGBA, rows top-down. README §The contract */
  paint(frame, display, { read = false } = {}) {
    if (this.#lost) return Promise.reject(new Error(this.#lost));
    const dpr = self.devicePixelRatio || 1;
    const width = Math.round(this.#canvas.clientWidth * dpr);
    const height = Math.round(this.#canvas.clientHeight * dpr);
    const id = this.#next++;
    // A SharedArrayBuffer arrives in the worker as a new object each time, so sameness is decided here.
    const l = this.#last;
    const same = l !== null && l.pixels === frame.pixels && l.width === frame.width && l.height === frame.height &&
      l.bits === frame.bits && l.signed === frame.signed && l.components === frame.components && l.byteOffset === frame.byteOffset;
    this.#last = frame;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ kind: "paint", id, frame, same, display, width, height, dpr, read });
    });
  }

  close() {
    this.#worker.terminate();
  }
}
