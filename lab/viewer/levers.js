import { sha256Hex } from "/client/decode/wasm-glue.js";

/** The viewer's lab parameters, honoured only on a host that serves this file: client/README.md §The viewer */
export function levers(q) {
  return {
    opts: q.get("opts") ? JSON.parse(q.get("opts")) : {},
    transport: q.get("wt") ? { wt_url: q.get("wt"), cert_sha256: q.get("hash") } : undefined,
    metadata: q.get("metadata") ?? undefined,
    ...(q.get("post") && totalTime(q.get("post"), q.get("origin"))),
  };
}

/** The page's hooks for lab/av1/delivery/total-time/run.mjs: `hello` before the fill, then page.js's result shape. */
function totalTime(post, origin) {
  const send = (what, body) => fetch(`${post}${what}`, { method: "POST", body: body && JSON.stringify(body) });
  return {
    started: () => send("hello"),
    async finished({ error, issuedAt, firstShownMs, frames, errors, stats }) {
      if (error) return send("result", { error }).catch(() => {});
      const sha = {};
      for (const [i, f] of frames) sha[i] = await sha256Hex(new Uint8Array(f.info.pixels).slice());
      send("result", { issuedAt: origin === "navigation" ? performance.timeOrigin : issuedAt, firstShown: issuedAt + firstShownMs,
        frames: [...frames].map(([i, f]) => ({ i, page: f.arrived, lastByte: f.info.stamps.lastByte, exact: f.info.exact })),
        failures: errors.map((reason) => ({ reason })), sha, previews: [], previewSha: {}, after: [], resumes: stats.resumedAt.length, checked: stats.exact }).catch(() => {});
    },
  };
}
