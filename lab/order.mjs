// The variant order of the lab's interleaved campaigns, and the check that it held.
// docs/rig-limits.md §6 Interleave the variants.

/** A Williams square's rows: over them every unit sits at every position, and follows every other, equally often. */
export function williams(n) {
  const first = [0];
  for (let k = 1; first.length < n; k++) {
    first.push(k);
    if (first.length < n) first.push(n - k);
  }
  const rows = first.map((_, r) => first.map((u) => (u + r) % n));
  // Odd n needs each row's mirror too; alternating them keeps a campaign cut short near balance.
  return n % 2 ? rows.flatMap((row) => [row, [...row].reverse()]) : rows;
}

/** The units in the order they run in `round`; the period is n rounds, 2n for odd n. */
export function order(units, round) {
  const rows = williams(units.length);
  return rows[round % rows.length].map((i) => units[i]);
}

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function counts(rows, unit, units) {
  const n = new Map([["first", 0], ...units.filter((u) => u !== unit).map((u) => [u, 0])]);
  for (const r of rows) if (r.unit === unit) n.set(r.prev ?? "first", (n.get(r.prev ?? "first") ?? 0) + 1);
  return n;
}

/** Whether `unit` followed each possible predecessor (or ran first) a number of times within one of the others. */
export function balanced(rows, unit, units) {
  const n = [...counts(rows, unit, units).values()];
  return Math.max(...n) - Math.min(...n) <= 1;
}

/** Each pair's lead, `unit` − `ref` in one round, by `unit`'s predecessor; flagged when either is unbalanced.
 *  rows: { round, unit, prev (null when first), v }. */
export function leadsByPredecessor(rows, units, pairs, digits = 0) {
  const lines = [];
  for (const [unit, ref] of pairs) {
    const at = new Map(rows.filter((r) => r.unit === ref && Number.isFinite(r.v)).map((r) => [r.round, r.v]));
    const groups = new Map();
    for (const r of rows) {
      if (r.unit !== unit || !Number.isFinite(r.v) || !at.has(r.round)) continue;
      const key = r.prev ?? "first";
      groups.set(key, [...(groups.get(key) ?? []), r.v - at.get(r.round)]);
    }
    const split = [...groups].map(([p, d]) => `${p} ${median(d) >= 0 ? "+" : ""}${median(d).toFixed(digits)} (${d.length})`);
    const flag = balanced(rows, unit, units) && balanced(rows, ref, units) ? "" : "  UNBALANCED predecessors";
    lines.push(`  ${unit} − ${ref} by ${unit}'s predecessor: ${split.join(" · ")}${flag}`);
  }
  return lines;
}
