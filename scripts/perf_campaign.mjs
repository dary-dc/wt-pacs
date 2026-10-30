// What scripts/perf_nightly.mjs runs in each arm, and the one value a round it judges. README.md §What the nightly times.

/** Each arm's variant and the variants.json that holds them: under a view, every arm on the product's viewer, the head's under it. */
export function arms(view, digests) {
  if (!view) return { names: { base: "htj2k", head: "htj2k", aa: "htj2k" }, variants: { htj2k: { digests } } };
  const viewer = { codec: "htj2k", viewer: "viewer.json", digests };
  return { names: { base: "viewer", head: "head", aa: "viewer" }, variants: { viewer, head: { ...viewer, view } } };
}

/** A row that counts: not VOID, and every frame it owed exact. */
export const kept = (r) => !r.void && r.exact === r.owed;

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** A visit's value for a metric: the fill and the first frame from a fill's visit, the median asked frame from an ask's. */
export function value(row, metric) {
  if (!row || !kept(row)) return null;
  if (metric === "asked") return row.afterMs?.length ? median(row.afterMs) : null;
  return { fill: row.decodedMs, first: row.firstMs }[metric] ?? null;
}
