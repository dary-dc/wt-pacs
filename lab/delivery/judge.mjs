// The delivery comparison's judge: each load's VOID reasons and what stops the run (§6), then the model's holds,
// misses and regime misses per (cell, volume, arm) (§8) and the A/A pair's input (§7).
// docs/client/evidence/delivery-comparison.md §6–§8
//   node lab/delivery/judge.mjs PREDICTIONS.json ROWS.jsonl [ROWS.jsonl …]
import { readFileSync, writeFileSync } from "node:fs";
import { balanced } from "../order.mjs";
import { ARMS, DECODERS, VOLUMES } from "./plan.mjs";
import { decodeFloor, digestOf, regime, unitsOf } from "./predict.mjs";

/** fraction of a core over a load */
export const BUSY_VOID = 0.95;
export const PILOT_VOID = 3;
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

/** The most frames decoding at once, from each frame's own decode span: the decoder count the fill really ran. */
export function decodersReadBack(frames) {
  const edges = frames.filter((f) => f.decodedAt && f.decodeMs != null)
    .flatMap((f) => [[f.decodedAt - f.decodeMs, 1], [f.decodedAt, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let [now, most] = [0, 0];
  for (const [, d] of edges) most = Math.max(most, (now += d));
  return most;
}

/** C1's exact-frame latency: the first Lossless press to the first label that reads lossless after it. */
export function exactLatencyOf(records) {
  const press = records.find((r) => r.kind === "lossless");
  const painted = press && records.find((r) => r.kind === "label" && r.quality === "lossless" && r.at >= press.at);
  return painted ? painted.at - press.at : null;
}

/** §4.1's measured side of a fill: the dial to the last byte, against the makespan of its own decodes. */
export function measuredRegime(load, group) {
  const frames = [...load.frames].sort((a, b) => a.i - b.i);
  const wireMs = Math.max(...frames.map((f) => f.lastByte)) - load.fillFrom;
  const units = unitsOf(frames.length, group);
  let k = 0;
  const unitMs = units.map((n) => frames.slice(k, (k += n)).reduce((a, f) => a + f.decodeMs, 0));
  const floorMs = decodeFloor(unitMs, 1, DECODERS);
  return { wireMs, floorMs, regime: regime(wireMs, floorMs) };
}

/** One load's measured clocks, by kind. C2's span is read from its own `exactFill` record, never summed. */
export function measured(row) {
  const out = { fill: row.load?.fillMs ?? null };
  if (row.arm === "C1") out.latency = exactLatencyOf(row.records ?? []);
  if (row.arm === "C2") {
    if (!row.exactFill) throw new Error(`C2 at round ${row.round} ${row.volume}: no exactFill record; C2 reads only its own`);
    out.span = row.exactFill.spanMs;
  }
  return out;
}

/** §6: why a load is VOID, [] when counted; `stop` when the run must stop (a frame that failed its check). */
export function voidOf(row, { pilotMedian } = {}) {
  const why = [];
  if (row.crash) why.push(`crash: ${row.error}`);
  if (row.verdict?.void) why.push(row.verdict.why);
  if (row.relayTally?.late) why.push("the relay's guard p99 over 1 ms");
  for (const [core, name] of [[0, "relay"], [1, "server"]]) {
    if (row.busy?.[core] > BUSY_VOID) why.push(`core ${core} (the ${name}) ${(100 * row.busy[core]).toFixed(0)} % busy`);
  }
  if (pilotMedian && row.load?.fillMs > PILOT_VOID * pilotMedian) why.push(`fill past ${PILOT_VOID}× the pilot's median`);
  const back = row.load?.frames ? decodersReadBack(row.load.frames) : 0;
  if (back > DECODERS) why.push(`${back} decoders read back, not ${DECODERS}`);
  const stop = !row.crash && row.verdict && !row.verdict.ok && !row.verdict.void ? `STOP: ${row.cell} round ${row.round} ${row.volume} ${row.arm}: ${row.verdict.why}` : null;
  return { why, stop };
}

/** §8: the model holds when the median ratio is in the band and at least 8 of the 10 rounds are. */
export function holds(ratios, [lo, hi]) {
  const inBand = ratios.filter((r) => r >= lo && r <= hi).length;
  const m = ratios.length ? median(ratios) : NaN;
  return { n: ratios.length, median: m, inBand, holds: m >= lo && m <= hi && inBand >= 8, side: m < lo ? "below" : m > hi ? "above" : "in" };
}

/** The judge over a cell's rows and the predictions file's text. Refuses a row whose digest is not the file's. */
export async function judge(text, rows, { group = { view: 8, exact: 1 } } = {}) {
  const digest = await digestOf(text);
  const { predictions } = JSON.parse(text);
  const counted = rows.filter((r) => !r.pilot);
  const wrong = counted.find((r) => r.predictionsXxh3 !== digest);
  if (wrong) throw new Error(`refused: round ${wrong.round} ${wrong.volume} ${wrong.arm} carries predictions ${wrong.predictionsXxh3}, the file is ${digest}`);
  const verdicts = [];
  const live = counted.filter((r) => !r.void?.length);
  for (const p of predictions) {
    const mine = counted.filter((r) => r.cell === p.cell && r.volume === p.volume && r.arm === p.arm);
    if (!mine.length) continue;
    const ok = mine.filter((r) => !r.void?.length);
    const ratios = ok.map((r) => measured(r)[p.kind] / p.ms).filter(Number.isFinite);
    const v = { ...p, ...holds(ratios, p.band), void: mine.length - ok.length, strict: (mine.length - ok.length) / mine.length > 0.25 };
    if (p.kind === "fill" && p.regime !== "near") {
      const misses = ok.filter((r) => measuredRegime(r.load, group[r.arm === "B" ? "exact" : "view"]).regime !== p.regime).length;
      v.regimeMisses = misses;
      v.regimeMiss = misses > 2;
    }
    if (v.strict) {
      const paired = ok.filter((r) => ARMS.every((a) => live.some((x) => x.cell === r.cell && x.volume === r.volume && x.round === r.round && x.arm === a)));
      v.roundPaired = holds(paired.map((r) => measured(r)[p.kind] / p.ms).filter(Number.isFinite), p.band);
    }
    verdicts.push(v);
  }
  const unbalanced = [...new Set(counted.map((r) => r.cell))].flatMap((cell) => VOLUMES.flatMap((volume) => {
    const rs = counted.filter((r) => r.cell === cell && r.volume === volume).map((r) => ({ ...r, unit: r.arm }));
    return rs.length ? ARMS.filter((a) => !balanced(rs, a, ARMS)).map((a) => `${cell}/${volume}/${a}`) : [];
  }));
  return { digest, verdicts, unbalanced, aa: aaCells(live) };
}

/** §7's input for lab/scripts/aa_rule.py --bar 0.05: A as the reference, A′ as both its copy and the arm judged. */
export function aaCells(rows) {
  const cells = {};
  for (const key of new Set(rows.map((r) => `${r.cell}/${r.volume}`))) {
    const rounds = [...new Set(rows.filter((r) => `${r.cell}/${r.volume}` === key).map((r) => r.round))].sort((a, b) => a - b);
    const at = (arm) => rounds.map((k) => rows.find((r) => `${r.cell}/${r.volume}` === key && r.round === k && r.arm === arm)?.load?.fillMs ?? null);
    cells[key] = { ref: at("A"), aa: at("A'"), arm: at("A'") };
  }
  return cells;
}

const line = (v) => `${v.cell} ${v.volume} ${v.arm.padEnd(2)} ${v.kind.padEnd(7)} predicted ${v.ms.toFixed(0)} ms, median ×${v.median.toFixed(3)} (${v.inBand}/${v.n} in ${v.band.join("–")}): ` +
  `${v.holds ? "HOLDS" : `MISSES ${v.side}`}${v.regimeMiss ? `; REGIME MISS (${v.regimeMisses} rounds)` : ""}${v.void ? `; ${v.void} VOID` : ""}` +
  `${v.roundPaired ? `; round-paired ×${v.roundPaired.median.toFixed(3)} ${v.roundPaired.holds ? "holds" : "misses"}` : ""}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const [predictionsFile, ...rowFiles] = process.argv.slice(2);
  const rows = rowFiles.flatMap((f) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
  const r = await judge(readFileSync(predictionsFile, "utf8"), rows);
  for (const v of r.verdicts) console.log(line(v));
  if (r.unbalanced.length) console.log(`UNBALANCED: ${r.unbalanced.join(" ")}`);
  const aaFile = rowFiles[0].replace(/\.jsonl$/, ".aa.json");
  writeFileSync(aaFile, JSON.stringify(r.aa, null, 1));
  console.log(`predictions xxh3 ${r.digest}; A/A input ${aaFile}: lab/scripts/aa_rule.py ${aaFile} --bar 0.05`);
}
