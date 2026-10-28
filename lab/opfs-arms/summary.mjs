// The pre-registered rule over run.mjs's rows: docs/adr/frame-path.md §The cache I/O in the view worker, *The rule*.
//
//   node lab/opfs-arms/summary.mjs DIR    every DIR/*.jsonl
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const rows = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).flatMap((f) =>
  readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const median = (v) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const missP50 = (r) => median((r.misses ?? []).map((m) => (m.error || m.exact === false ? NaN : m.paintedAt - m.sentAt)));
const missOk = (r) => (r.misses ?? []).length > 0 && r.misses.every((m) => !m.error && m.exact !== false);

const mutants = rows.filter((r) => r.unit && r.mutant);
for (const r of mutants) {
  const caught = r.mutant === "drop-writes" ? r.checks.writesVerified === false : r.missedTicks > 0 && r.lateAsPredicted;
  console.log(`mutant ${r.mutant} · ${r.engine} ${r.cell} ${r.size} ${r.throttle}× ${r.unit}: ${caught ? "caught" : "NOT CAUGHT"}`);
}

const cells = new Map();
for (const r of rows.filter((r) => r.unit && !r.mutant)) {
  const key = `${r.engine} ${r.cell} ${r.size} ${r.throttle}×`;
  if (!cells.has(key)) cells.set(key, { engine: r.engine, cell: r.cell, rounds: new Map() });
  const rounds = cells.get(key).rounds;
  if (!rounds.has(r.round)) rounds.set(r.round, {});
  rounds.get(r.round)[r.unit] = r;
}

/** Per cell and arm, the rounds that pass its check, and whether the cell is VOID or saturated. */
function judge({ cell, rounds }) {
  const rs = [...rounds.values()];
  const aa = { late: (r) => r.missedShare, rate: (r) => r.writeMBps, miss: missP50 }[cell];
  const pairs = rs.filter((r) => r.C && r.C2).map((r) => [aa(r.C), aa(r.C2)]);
  const voided = cell === "late" ? median(pairs.map(([a, b]) => Math.abs(b - a))) > 0.01
    : !(median(pairs.map(([a, b]) => b / a)) >= 0.9 && median(pairs.map(([a, b]) => b / a)) <= 1.1);
  const saturated = cell === "late" && median(rs.map((r) => r.none?.missedShare)) > 0.05;
  const pass = {
    late: (r, a) => r.none && r[a].missedShare - r.none.missedShare <= 0.01 && r[a].paintDelayP99 - r.none.paintDelayP99 <= 4,
    rate: (r, a) => r[a].checks.writesVerified && r[a].writeMBps >= 125,
    miss: (r, a) => missOk(r[a]),
  }[cell];
  const bounded = (r, a) => r[a].checks.writesVerified && r[a].backlogLastThirdMax <= r[a].backlogFirstThirdMax + 2;
  const arms = Object.keys(rs[0] ?? {}).filter((a) => a !== "none");
  const per = Object.fromEntries(arms.map((a) => [a, {
    pass: rs.filter((r) => r[a] && pass(r, a)).length,
    bounded: cell === "late" ? rs.filter((r) => r[a] && bounded(r, a)).length : null,
    median: median(rs.map((r) => r[a] && aa(r[a]))),
  }]));
  return { n: rs.length, voided, saturated, per };
}

const enough = (k, n) => n > 0 && k >= Math.ceil(0.75 * n);
const verdicts = new Map();
for (const [key, c] of cells) {
  const j = judge(c);
  console.log(`${key}: ${j.n} rounds${j.voided ? " · VOID" : ""}${j.saturated ? " · saturated" : ""}`);
  for (const [a, p] of Object.entries(j.per)) console.log(`  ${a.padEnd(9)} median ${p.median.toFixed(3)} · pass ${p.pass}/${j.n}${p.bounded === null ? "" : ` · bounded ${p.bounded}/${j.n}`}`);
  if (!verdicts.has(c.engine)) verdicts.set(c.engine, []);
  verdicts.get(c.engine).push({ cell: c.cell, ...j });
}

for (const [engine, js] of verdicts) {
  const counted = js.filter((j) => !j.voided && !j.saturated);
  const passes = (arm) => ["late", "rate"].every((cell) => counted.some((j) => j.cell === cell)) &&
    counted.filter((j) => j.cell !== "miss").every((j) => j.per[arm] && enough(j.per[arm].pass, j.n) && (j.cell !== "late" || enough(j.per[arm].bounded, j.n)));
  const ok = ["A-paint", "A-arrival", "B-paint", "B-arrival", "C"].filter(passes);
  const a = ok.find((x) => x.startsWith("A"));
  const b = ok.find((x) => x.startsWith("B"));
  const missR = counted.filter((j) => j.cell === "miss");
  const rateR = counted.filter((j) => j.cell === "rate");
  const bBeats = missR.length && missR.every((j) => j.per["B-arrival"]?.median <= 0.9 * j.per["A-arrival"]?.median) &&
    rateR.every((j) => j.per[b]?.median >= 0.9 * j.per[a]?.median);
  const pick = a && b ? (bBeats ? b : a) : a ?? b ?? (ok.includes("C") ? "C" : null);
  console.log(`${engine}: passing ${ok.join(", ") || "none"} → ${pick ?? "no arm passes: to the owner as measured"}` +
    ` (${counted.length} of ${js.length} cells counted)`);
}
