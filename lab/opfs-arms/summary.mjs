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

/** Decode ms of one frame at 1× / 4× (exactness-in-production.md §3, measured); 3328×4096 has none. */
const DECODE_MS = { 512: { 1: 3.1, 4: 14.6 }, 2560: { 1: 47, 4: 210 } };
const FRAME_MB = { 512: 0.524288, 2560: 17.03936, 3328: 27.262976 };
const FILL_MBPS = 125;
const DECODERS = 3;
const PERIOD_MS = 16.7;

const mutants = rows.filter((r) => r.unit && r.mutant);
for (const r of mutants) {
  const caught = r.mutant === "drop-writes" ? r.checks.writesVerified === false
    : r.mutant === "late-input" ? r.dragInputs > 0 && r.checks.lateInputAsPredicted
    : r.missedTicks > 0 && r.lateAsPredicted;
  console.log(`mutant ${r.mutant} · ${r.engine} ${r.cell} ${r.size} ${r.throttle}× ${r.unit}: ${caught ? "caught" : "NOT CAUGHT"}`);
}

const cells = new Map();
for (const r of rows.filter((r) => r.unit && !r.mutant)) {
  const key = `${r.engine} ${r.cell} ${r.size} ${r.throttle}×`;
  if (!cells.has(key)) cells.set(key, { engine: r.engine, cell: r.cell, size: r.size, throttle: r.throttle, rounds: new Map() });
  const rounds = cells.get(key).rounds;
  if (!rounds.has(r.round)) rounds.set(r.round, {});
  rounds.get(r.round)[r.unit] = r;
}

/** D's write on a decoder's clock, judged only where the fill is decode-bound: the decoders' rate under the fill's. */
function decoderClock({ size, throttle }, rs) {
  const decode = DECODE_MS[size]?.[throttle];
  const d = rs.filter((r) => r.D);
  if (!decode || !d.length) return { judged: false, pass: true, why: decode ? "no D rows" : "decode not measured" };
  const onClock = median(d.map((r) => r.D.decoderWriteMsP50 + Math.max(0, r.D.decoderHandleMsP50 - decode)));
  const bound = (DECODERS * FRAME_MB[size] * 1000) / decode < FILL_MBPS;
  return { judged: bound, onClock, decode, pass: !bound || onClock <= 0.1 * decode };
}

/** Per cell and arm, the rounds that pass its check, and whether the cell is VOID or saturated. */
function judge({ cell, size, throttle, rounds }) {
  const rs = [...rounds.values()];
  const aa = { late: (r) => r.missedShare, rate: (r) => r.writeMBps, miss: missP50, drag: (r) => r.dragMsP99 }[cell];
  const pairs = rs.filter((r) => r.C && r.C2).map((r) => [aa(r.C), aa(r.C2)]);
  const ratio = median(pairs.map(([a, b]) => b / a));
  const voided = cell === "late" ? median(pairs.map(([a, b]) => Math.abs(b - a))) > 0.01
    : cell === "drag" ? median(pairs.map(([a, b]) => Math.abs(b - a))) > 4
    : !(ratio >= 0.9 && ratio <= 1.1);
  const saturated = (cell === "late" || cell === "drag") && median(rs.map((r) => r.none?.missedShare)) > 0.05;
  const pass = {
    late: (r, a) => r.none && r[a].missedShare - r.none.missedShare <= 0.01 && r[a].paintDelayP99 - r.none.paintDelayP99 <= 4,
    rate: (r, a) => r[a].checks.writesVerified && r[a].writeMBps >= FILL_MBPS,
    miss: (r, a) => missOk(r[a]),
    drag: (r, a) => r.none && r[a].dragInputs > 0 && r[a].dragMsP99 - r.none.dragMsP99 <= 4,
  }[cell];
  const bounded = (r, a) => r[a].checks.writesVerified && r[a].backlogLastThirdMax <= r[a].backlogFirstThirdMax + 2;
  const arms = Object.keys(rs[0] ?? {}).filter((a) => a !== "none");
  const per = Object.fromEntries(arms.map((a) => [a, {
    pass: rs.filter((r) => r[a] && pass(r, a)).length,
    bounded: cell === "late" ? rs.filter((r) => r[a] && bounded(r, a)).length : null,
    median: median(rs.map((r) => r[a] && aa(r[a]))),
  }]));
  return { n: rs.length, voided, saturated, per, clock: cell === "rate" ? decoderClock({ size, throttle }, rs) : null };
}

const enough = (k, n) => n > 0 && k >= Math.ceil(0.75 * n);
const verdicts = new Map();
for (const [key, c] of cells) {
  const j = judge(c);
  console.log(`${key}: ${j.n} rounds${j.voided ? " · VOID" : ""}${j.saturated ? " · saturated" : ""}`);
  for (const [a, p] of Object.entries(j.per)) console.log(`  ${a.padEnd(9)} median ${p.median.toFixed(3)} · pass ${p.pass}/${j.n}${p.bounded === null ? "" : ` · bounded ${p.bounded}/${j.n}`}`);
  if (j.clock) console.log(`  D on a decoder's clock: ${j.clock.judged ? `${j.clock.onClock.toFixed(2)} ms against a ${j.clock.decode} ms decode → ${j.clock.pass ? "pass" : "FAIL"}` : `not judged (${j.clock.why ?? "not decode-bound"})`}`);
  if (!verdicts.has(c.engine)) verdicts.set(c.engine, []);
  verdicts.get(c.engine).push({ cell: c.cell, ...j });
}

/** The amended rule: among A paint-first, C and D, D first unless its miss paints a period after A's, then A paint-first, then C. */
for (const [engine, js] of verdicts) {
  const counted = js.filter((j) => !j.voided && !j.saturated);
  const has = (cell) => counted.some((j) => j.cell === cell);
  const passes = (arm) => ["late", "rate", "drag"].every(has) &&
    counted.filter((j) => j.cell !== "miss").every((j) => j.per[arm] && enough(j.per[arm].pass, j.n) && (j.cell !== "late" || enough(j.per[arm].bounded, j.n))) &&
    (arm !== "D" || counted.filter((j) => j.clock).every((j) => j.clock.pass));
  const ok = ["A-paint", "C", "D"].filter(passes);
  const reported = ["A-arrival", "B-arrival", "B-paint"].filter(passes);
  const missR = counted.filter((j) => j.cell === "miss");
  const dReadsSlower = missR.some((j) => j.per.D?.median >= j.per["A-arrival"]?.median + PERIOD_MS);
  const pick = ok.includes("D") && !(ok.includes("A-paint") && dReadsSlower) ? "D" : ok.includes("A-paint") ? "A-paint" : ok.includes("C") ? "C" : null;
  console.log(`${engine}: passing ${ok.join(", ") || "none"}${reported.length ? ` (reported only: ${reported.join(", ")})` : ""} → ` +
    `${pick ?? "no arm passes: to the owner as measured"} (${counted.length} of ${js.length} cells counted)`);
}
