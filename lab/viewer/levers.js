/** The viewer's lab parameters, honoured only on a host that serves this file: client/README.md §The viewer */
import { Cine, now } from "../../client/view/clock.js";
import { busyPage } from "../frame-clock/busy.js";
import { sawtooth, STEP_MS, waits } from "./trace.js";

export function levers(q) {
  if (q.get("trace") && q.get("trace") !== "sawtooth") throw new Error(`refused: trace ${JSON.stringify(q.get("trace"))} — sawtooth`);
  const opts = q.get("opts") ? JSON.parse(q.get("opts")) : {};
  // docs/adr/frame-path.md §7: the page busy from here, and after the fill a cine of `cine` seconds.
  const tasks = q.get("busy") === "1" ? busyPage() : [];
  const seconds = Number(q.get("cine") ?? 0);
  return {
    opts,
    transport: q.get("wt") ? { wt_url: q.get("wt"), cert_sha256: q.get("hash") } : undefined,
    metadata: q.get("metadata") ?? undefined,
    writer: q.get("writer") ?? undefined,
    ...(q.get("post") && totalTime(q.get("post"), q.get("origin"), opts, q.get("fill") === "0" ? Number(q.get("after") ?? 0) : 0, Boolean(q.get("trace")), tasks)),
    ...(seconds && { cine: cineOf(seconds * 1000) }),
    ...(q.get("trace") && { trace: { steps: sawtooth, everyMs: STEP_MS } }),
  };
}

/**
 * The page's hooks for lab/av1/delivery/total-time/run.mjs: `hello` before the fill, then page.js's result shape.
 * On demand, frames 1 … `after` are stepped to one at a time once frame 0 is shown; under `traced`, the steps are the trace's.
 */
function totalTime(post, origin, opts, after, traced, tasks) {
  const send = (what, body) => fetch(`${post}${what}`, { method: "POST", body: body && JSON.stringify(body) });
  return {
    // The rig times "shown", so under the worker view its paint waits for the GPU as the paint worker's does.
    settlePaint: true,
    steps: Array.from({ length: after }, (_, k) => k + 1),
    started: () => send("hello"),
    filled: () => send("filled"),
    async finished({ error, issuedAt, firstShownMs, fillMs, frames, errors, stats, stepped = [], cine }) {
      if (error) return send("result", { error }).catch(() => {});
      // Each frame's digest is taken where the frame is held, so no pixel need reach the page: client/view/controller.js.
      const sha = Object.fromEntries(frames.map((f) => [f.i, f.sha]));
      const reads = (fs) => Math.max(0, ...fs.map((f) => f.mediaReads ?? 0));
      const mediaReads = reads(frames);
      const arrived = new Map(frames.map((f) => [f.i, f.page]));
      const byIndex = new Map(frames.map((f) => [f.i, f]));
      const asked = traced ? [] : stepped;
      send("result", { issuedAt: origin === "navigation" ? performance.timeOrigin : issuedAt, firstShown: issuedAt + firstShownMs, fillMs,
        // A half-held store's fill counts from its last held frame: docs/adr/frame-path.md §Experiment 1.
        mediaReads, fillReads: mediaReads - (opts.holdEveryOther ? reads(frames.filter((f) => f.i % 2 === 0)) : 0),
        frames: asked.length ? [] : frames.map(({ i, page, lastByte, exact }) => ({ i, page, lastByte, exact })),
        failures: errors.map((reason) => ({ reason })), sha, previews: [], previewSha: {},
        after: asked.map(({ i, at }) => ({ i, ms: arrived.get(i) - at, screen: byIndex.get(i).painted - byIndex.get(i).decoded })), tasks, cine, resumes: stats.resumedAt.length, checked: stats.exact,
        ...(traced && { trace: waits(stepped, arrived) }) }).catch(() => {});
    },
  };
}

/** Cine on the thread that holds the frames, the phase worker started with the page: docs/adr/frame-path.md §7 */
function cineOf(ms) {
  const phase = new Worker(new URL("../frame-clock/phase.js", import.meta.url));
  return ({ worker, controller, fps }) => cine({ worker, controller, fps, ms, phase });
}

async function cine({ worker, controller, fps, ms, phase }) {
  const heard = () => new Promise((r) => (phase.onmessage = ({ data }) => r(data)));
  const aligned = heard();
  phase.postMessage({ at: now() + 500 });
  const t0 = await aligned;
  const page = !worker && new Cine({ fps, t0, source: "timeout", show: async (i) => (await controller.show(i), controller.lastPaint?.drawn) });
  if (worker) worker.play(fps, t0, "timeout");
  await new Promise((r) => setTimeout(r, t0 + ms - now()));
  if (worker) worker.pause();
  else page.stop();
  const vsyncs = heard();
  phase.postMessage({});
  return { t0, ms, period: 1000 / fps, draws: worker ? await worker.cine() : page.log, vsyncs: await vsyncs };
}
