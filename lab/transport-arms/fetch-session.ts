/**
 * Lab only: a session's frames by `fetch` from the lab GET path (`series-server --lab-get-port`), behind the
 * downloader's transport seam. `?shape=frame`: one GET a frame, `k` in flight in the fill's order; `?shape=fill`:
 * one GET a run, which an ask aborts. The protocol is the browser's choice: each frame response's
 * `nextHopProtocol` is posted on the `transport-arms` channel. docs/transport/evidence/stacks.md §5.1, lab/transport-arms/README.md
 */

import { FrameSession, type ConnectOptions } from "../../client/transport/ts/frame-session.ts";
import type { FodMsg } from "../../client/transport/ts/wire.ts";

export type { ConnectOptions, FrameResult, OpeningFill } from "../../client/transport/ts/frame-session.ts";

type Shape = "frame" | "fill";

const report = new BroadcastChannel("transport-arms");
// An entry lands once its response has ended, which can be after the body's last read.
new PerformanceObserver((list) => {
  for (const e of list.getEntries() as PerformanceResourceTiming[]) {
    if (new URL(e.name).pathname.startsWith("/frames/")) report.postMessage({ path: e.name, protocol: e.nextHopProtocol });
  }
}).observe({ type: "resource", buffered: true });

export class TransportSession extends FrameSession {
  /** Fill frames not yet asked for (frame shape), and every GET a fill has open, by its first frame. */
  private queue: number[] = [];
  private open = new Map<number, AbortController>();
  private closedAt: string | null = null;

  private constructor(
    private readonly base: string,
    private readonly shape: Shape,
    private readonly k: number,
    options: ConnectOptions,
  ) {
    super(options);
  }

  /** `url` is the GET path's origin, `?shape=frame|fill&k=6`; there is no dial, so nothing to pin or wait for. */
  static async connect(url: string, _certSha256: string, options: ConnectOptions = {}): Promise<TransportSession> {
    const u = new URL(url);
    const shape = u.searchParams.get("shape") ?? "frame";
    if (shape !== "frame" && shape !== "fill") throw new Error(`refused: shape ${JSON.stringify(shape)} — frame or fill`);
    const session = new TransportSession(u.origin, shape, Number(u.searchParams.get("k") ?? 6), options);
    const fill = options.fill;
    if (fill) {
      session.armFill(fill.from, fill.to, fill.onFrame, fill.onError);
      await session.sendFod({ op: "stream_frames", from: fill.from, to: fill.to });
    }
    return session;
  }

  protected async sendFod(msg: FodMsg) {
    if (this.closedAt) throw new Error(this.closedAt);
    if (msg.op === "request_frame") return this.ask(msg.frame);
    if (msg.op === "stream_frames") return this.startFill(msg.from ?? 0, msg.to ?? msg.from ?? 0);
    if (msg.op === "end_stream") this.endFill();
  }

  /** An ask goes at once; under `fill` it first ends the running fill, whose rest the downloader asks again. */
  private ask(frame: number) {
    if (this.shape === "fill") this.endFill();
    else if (this.open.has(frame)) return;
    const abort = new AbortController();
    void this.get(`/frames/${frame}`, abort).catch((e) => abort.signal.aborted || this.failWaiter(frame, String(e?.message ?? e)));
  }

  /** A new fill replaces the old one, as `stream_frames` does on the server; it returns once its GET is issued. */
  private startFill(from: number, to: number) {
    if (this.shape === "fill") {
      this.endFill();
      return void this.issue(`/frames/${from}-${to}`, from);
    }
    for (const [frame, abort] of this.open) if (frame < from || frame > to) (abort.abort(), this.open.delete(frame));
    this.queue = [];
    for (let i = from; i <= to; i++) if (!this.open.has(i)) this.queue.push(i);
    this.next();
  }

  private endFill() {
    this.queue = [];
    for (const abort of this.open.values()) abort.abort();
    this.open.clear();
  }

  private next() {
    while (this.open.size < this.k && this.queue.length) {
      const frame = this.queue.shift()!;
      this.issue(`/frames/${frame}`, frame).finally(() => this.next());
    }
  }

  /** A fill's GET; an abort leaves its frames owed without failing them, as the server ending a fill does. */
  private issue(path: string, key: number): Promise<void> {
    const abort = new AbortController();
    this.open.set(key, abort);
    return this.get(path, abort)
      .catch(() => {})
      .finally(() => this.open.get(key) === abort && this.open.delete(key));
  }

  private async get(path: string, abort: AbortController) {
    const url = `${this.base}${path}`;
    const response = await fetch(url, { cache: "no-store", signal: abort.signal });
    if (!response.ok || !response.body) throw new Error(`GET ${path}: HTTP ${response.status}`);
    // An aborted body errors its reader, which the envelope reader ends on without naming a frame.
    await this.pumpFramedStream(response.body);
  }

  close() {
    this.closedAt ??= "session closed";
    this.endFill();
    this.failAll(this.closedAt);
  }
}
