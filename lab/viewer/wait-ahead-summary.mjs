// docs/adr/frame-path.md §3, *Experiment 2*: its guards and rule over run.mjs's rows, fill and on-demand alike.
//   node lab/viewer/wait-ahead-summary.mjs rows.jsonl [more.jsonl ...]
import { readFileSync } from "node:fs";

/** ms: one 60 Hz frame, the bar; the A/A pair's bound on its paired median. */
const BAR_MS = 16.7;
const AA_MS = 8;
const ROUNDS_NEEDED = 9;
const KEPT_NEEDED = 10;
const LIVE_SHARE = 0.1;
export const ARMS = { off: undefined, offaa: undefined, k1: 1, k2: 2, k4: 4, k8: 8 };

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Each cell's guards, and per arm against `off` and against k = 1, paired by round. */
export function cells(rows) {
  const byCell = new Map();
  for (const r of rows) {
    const key = [r.engine, r.set, r.link, r.impairment ?? "clean", r.throttle, r.owed ? "fill" : "on demand"].join(" ");
    if (!byCell.has(key)) byCell.set(key, { key, engine: r.engine, fill: Boolean(r.owed), frames: r.owed, rows: [] });
    byCell.get(key).rows.push(r);
  }
  return [...byCell.values()].map((c) => {
    const exact = c.rows.every((r) => r.exact === r.owed && !r.failures);
    const kept = (arm) => new Map(c.rows.filter((r) => r.variant === arm && !r.void && r.trace).map((r) => [r.round, r]));
    const arms = Object.fromEntries(Object.keys(ARMS).map((a) => [a, kept(a)]));
    const figure = (r) => (c.fill ? r.trace.forwardMs : r.trace.missingMs);
    const paired = (a, b, f) => [...arms[a].keys()].filter((k) => arms[b].has(k)).map((k) => f(arms[a].get(k), arms[b].get(k)));
    const saturated = Object.values(arms).some((m) => m.size < KEPT_NEEDED);
    const live = arms.off.size ? median([...arms.off.values()].map((r) => r.trace.live)) : 0;
    const aa = paired("offaa", "off", (x, y) => figure(x) - figure(y));
    const aaFill = c.fill ? paired("offaa", "off", (x, y) => x.fillMs / y.fillMs) : [];
    const noisy = !aa.length || Math.abs(median(aa)) > AA_MS || (c.fill && (median(aaFill) < 0.98 || median(aaFill) > 1.02));
    const vs = Object.fromEntries(Object.keys(ARMS).filter((a) => ARMS[a]).map((a) => [a, {
      // A cell whose trace never climbs k frames cannot tell waiting from never asking.
      votes: !c.fill || ARMS[a] < Math.floor(c.frames / 3),
      noLaterThanK1: paired(a, "k1", (x, y) => figure(x) <= figure(y)).filter(Boolean).length,
      beats: paired(a, "off", (x, y) => figure(y) - figure(x) >= BAR_MS).filter(Boolean).length,
      laterForward: paired(a, "off", (x, y) => figure(x) - figure(y) >= BAR_MS).filter(Boolean).length,
      laterBackward: c.fill ? paired(a, "off", (x, y) => x.trace.backwardMs - y.trace.backwardMs >= BAR_MS).filter(Boolean).length : 0,
      onDemandMs: c.fill ? null : median(paired(a, "off", (x, y) => figure(x) - figure(y))),
      fill: c.fill ? median(paired(a, "off", (x, y) => x.fillMs / y.fillMs)) : null,
    }]));
    return { ...c, exact, saturated, live, dead: c.fill && live < LIVE_SHARE, aa: aa.length ? median(aa) : null, noisy, vs };
  });
}

/** The rule: k*, then whether `on` at k* is adopted, a trade-off, or `off` stays. */
export function decide(rows) {
  const all = cells(rows);
  const decided = all.filter((c) => c.fill && !c.saturated && !c.dead && !c.noisy);
  const ks = Object.keys(ARMS).filter((a) => ARMS[a]);
  const star = ks.filter((a) => a === "k1" || decided.filter((c) => c.vs[a].votes).every((c) => c.vs[a].noLaterThanK1 >= ROUNDS_NEEDED)).at(-1);
  const at = decided.filter((c) => c.vs[star].votes);
  const engines = [...new Set(all.map((c) => c.engine))];
  const faster = engines.every((e) => at.some((c) => c.engine === e && c.vs[star].beats >= ROUNDS_NEEDED));
  const slowerForward = at.some((c) => c.vs[star].laterForward >= ROUNDS_NEEDED);
  const slowerBackward = at.some((c) => c.vs[star].laterBackward >= ROUNDS_NEEDED);
  const fillHolds = at.every((c) => c.vs[star].fill <= 1.02);
  const onDemand = all.filter((c) => !c.fill);
  const onDemandHolds = onDemand.length > 0 && onDemand.every((c) => c.aa !== null && Math.abs(c.vs[star].onDemandMs) <= Math.max(AA_MS, Math.abs(c.aa)));
  const exact = all.every((c) => c.exact);
  const verdict = !exact ? "rejected: a frame not exact" : !at.length ? "undecided: no live, decided cell"
    : faster && !slowerForward && !slowerBackward && fillHolds && onDemandHolds ? `adopt ${star}`
    : faster && slowerBackward && !slowerForward && fillHolds && onDemandHolds ? `trade-off at ${star}: the owner's` : "off stays";
  return { cells: all, star, verdict };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
  const { cells: all, star, verdict } = decide(rows);
  for (const c of all) {
    const guards = [c.saturated && "saturated", c.dead && "dead", c.noisy && "A/A too noisy", !c.exact && "NOT EXACT"].filter(Boolean).join(", ") || "decided";
    const arms = Object.entries(c.vs).map(([a, v]) => `${a}${v.votes ? "" : " (no vote)"} ≤k1 ${v.noLaterThanK1} beats ${v.beats} later ${v.laterForward}/${v.laterBackward}` +
      (c.fill ? ` fill ×${v.fill?.toFixed(3)}` : ` Δ ${v.onDemandMs?.toFixed(1)} ms`)).join(" · ");
    console.log(`${c.key}: ${guards}; live ${(c.live * 100).toFixed(0)} %, A/A ${c.aa?.toFixed(1)} ms; ${arms}`);
  }
  console.log(`k* ${star}: ${verdict}`);
}
