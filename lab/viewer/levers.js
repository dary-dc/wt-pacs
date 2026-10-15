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
      for (const [i, f] of frames) sha[i] = await digest(f.info.pixels);
      send("result", { issuedAt: origin === "navigation" ? performance.timeOrigin : issuedAt, firstShown: issuedAt + firstShownMs,
        frames: [...frames].map(([i, f]) => ({ i, page: f.arrived, lastByte: f.info.stamps.lastByte, exact: f.info.exact })),
        failures: errors.map((reason) => ({ reason })), sha, previews: [], previewSha: {}, after: [], resumes: stats.resumedAt.length, checked: stats.exact }).catch(() => {});
    },
  };
}

async function digest(sab) {
  const copy = new Uint8Array(sab.byteLength);
  copy.set(new Uint8Array(sab));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copy)), (b) => b.toString(16).padStart(2, "0")).join("");
}
