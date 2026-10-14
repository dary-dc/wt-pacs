/** The viewer's lab parameters, honoured only on a host that serves this file: client/README.md §The viewer */
export function levers(q) {
  return {
    opts: q.get("opts") ? JSON.parse(q.get("opts")) : {},
    transport: q.get("wt") ? { wt_url: q.get("wt"), cert_sha256: q.get("hash") } : undefined,
    metadata: q.get("metadata") ?? undefined,
    post: q.get("post") ?? undefined,
    origin: q.get("origin") ?? undefined,
  };
}
