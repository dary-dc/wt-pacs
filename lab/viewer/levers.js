/** The viewer's lab parameters, honoured only on a host that serves this file: client/README.md §The viewer */
import { sawtooth, STEP_MS, waits } from "./trace.js";

export function levers(q) {
  if (q.get("trace") && q.get("trace") !== "sawtooth") throw new Error(`refused: trace ${JSON.stringify(q.get("trace"))} — sawtooth`);
  return {
    opts: q.get("opts") ? JSON.parse(q.get("opts")) : {},
    transport: q.get("wt") ? { wt_url: q.get("wt"), cert_sha256: q.get("hash") } : undefined,
    metadata: q.get("metadata") ?? undefined,
    ...(q.get("post") && totalTime(q.get("post"), q.get("origin"))),
    ...(q.get("trace") && { trace: { steps: sawtooth, everyMs: STEP_MS } }),
  };
}

/** The page's hooks for lab/av1/delivery/total-time/run.mjs: `hello` before the fill, then page.js's result shape. */
function totalTime(post, origin) {
  const send = (what, body) => fetch(`${post}${what}`, { method: "POST", body: body && JSON.stringify(body) });
  return {
    // The rig times "shown", so under the worker view its paint waits for the GPU as the paint worker's does.
    settlePaint: true,
    started: () => send("hello"),
    async finished({ error, issuedAt, firstShownMs, fillMs, frames, errors, stats, stepped }) {
      if (error) return send("result", { error }).catch(() => {});
      // Each frame's digest is taken where the frame is held, so no pixel need reach the page: client/view/controller.js.
      const sha = Object.fromEntries(frames.map((f) => [f.i, f.sha]));
      send("result", { issuedAt: origin === "navigation" ? performance.timeOrigin : issuedAt, firstShown: issuedAt + firstShownMs,
        frames: frames.map(({ i, page, lastByte, exact }) => ({ i, page, lastByte, exact })),
        failures: errors.map((reason) => ({ reason })), sha, previews: [], previewSha: {}, after: [], resumes: stats.resumedAt.length, checked: stats.exact,
        fillMs, ...(stepped && { trace: waits(stepped, new Map(frames.map((f) => [f.i, f.page]))) }) }).catch(() => {});
    },
  };
}
