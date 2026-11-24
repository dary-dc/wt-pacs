// The delivery comparison's judge: each load's VOID reasons and what stops the run (§6), then the model's holds,
// misses and regime misses per (cell, volume, arm) (§8) and the A/A pair's input (§7).
// docs/client/evidence/delivery-comparison.md §6–§8, A2.5, A2.8
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

const recordOf = (row, kind) => (row.records ?? []).find((r) => r.kind === kind);

/** One load's measured clocks, by kind, each from the page's own record. */
export function measured(row) {
  const out = { fill: row.load?.fillMs ?? null };
  if (row.arm === "C1") Object.assign(out, { latency: exactLatencyOf(row.records ?? []), askLastByte: recordOf(row, "askLastByte")?.ms ?? null });
  if (row.arm === "FIT") out.zoom = recordOf(row, "zoom")?.ms ?? null;
  return out;
}

/** The cores the browser may use (§2): the driver's and so every process it starts. */
export const BROWSER_CORES = [2, 3];
/** The cores in a `Cpus_allowed_list` such as "0-1,3". */
export const coresOf = (list) => list.split(",").flatMap((part) => { const [a, b = a] = part.split("-").map(Number); return Array.from({ length: b - a + 1 }, (_, k) => a + k); });

/** A2.8: a FIT load on a volume with a level to gain asks each frame's prefix only; any other frame's bytes refuse the judge. */
export function fitRefusal(row, fit) {
  if (row.arm !== "FIT" || !fit || !row.load?.frames) return null;
  // `kb` is beacon.js's KiB to one decimal.
  const whole = row.load.frames.find((f) => Math.abs(f.kb * 1024 - fit.prefixes[f.i]) > 0.1 * 1024);
  return whole && `refused: FIT round ${row.round} ${row.volume}: frame ${whole.i} carried ${whole.kb} KiB, its level prefix ${(fit.prefixes[whole.i] / 1024).toFixed(1)} KiB`;
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
  const escaped = (row.cpus ?? []).filter((p) => coresOf(p.allowed).some((c) => !BROWSER_CORES.includes(c)));
  if (escaped.length) why.push(`escaped: ${escaped.map((p) => `${p.name} ${p.pid} on ${p.allowed}`).join(", ")}`);
  const back = row.load?.frames ? decodersReadBack(row.load.frames) : 0;
  if (back > DECODERS) why.push(`${back} decoders read back, not ${DECODERS}`);
  const stop = !row.crash && row.verdict && !row.verdict.ok && !row.verdict.void ? `STOP: ${row.cell} round ${row.round} ${row.volume} ${row.arm}: ${row.verdict.why}` : null;
  return { why, stop };
}

/** A2.8: rounds in band the model needs, of 12 */
export const HOLD_ROUNDS = 10;

/** A2.8: the model holds when the median ratio is in the band and at least 10 of the 12 rounds are; under 10 counted it cannot. */
export function holds(ratios, [lo, hi]) {
  const inBand = ratios.filter((r) => r >= lo && r <= hi).length;
  const m = ratios.length ? median(ratios) : NaN;
  return { n: ratios.length, median: m, inBand, holds: m >= lo && m <= hi && inBand >= HOLD_ROUNDS, cannotHold: ratios.length < HOLD_ROUNDS,
    side: m < lo ? "below" : m > hi ? "above" : "in" };
}

/** The judge over a cell's rows and the predictions file's text. Refuses a row whose digest is not the file's. */
export async function judge(text, rows, { group = { view: 8, exact: 1 } } = {}) {
  const digest = await digestOf(text);
  const { inputs, predictions } = JSON.parse(text);
  const counted = rows.filter((r) => !r.pilot && !r.calibration);
  const wrong = counted.find((r) => r.predictionsXxh3 !== digest);
  if (wrong) throw new Error(`refused: round ${wrong.round} ${wrong.volume} ${wrong.arm} carries predictions ${wrong.predictionsXxh3}, the file is ${digest}`);
  const notFit = counted.map((r) => fitRefusal(r, inputs?.volumes?.[r.volume]?.fit)).find(Boolean);
  if (notFit) throw new Error(notFit);
  const verdicts = [];
  const live = counted.filter((r) => !r.void?.length);
  for (const p of predictions) {
    const mine = counted.filter((r) => r.cell === p.cell && r.volume === p.volume && r.arm === p.arm);
    if (!mine.length) continue;
    const ok = mine.filter((r) => !r.void?.length);
    const ratios = ok.map((r) => measured(r)[p.kind] / p.ms).filter(Number.isFinite);
    const v = { ...p, ...holds(ratios, p.band), void: mine.length - ok.length, strict: (mine.length - ok.length) / mine.length > 0.25 };
    if (p.judged === false) Object.assign(v, { holds: null, cannotHold: false, reported: true });
    if (p.x != null) v.xMeasured = ok.length ? median(ok.map((r) => recordOf(r, "split")?.x ?? NaN)) : null;
    if (p.kind === "fill" && p.regime && p.regime !== "near") {
      const misses = ok.filter((r) => measuredRegime(r.load, group[["B", "FIT"].includes(r.arm) ? "exact" : "view"]).regime !== p.regime).length;
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
  // A2.3: the switch's reading is reported, never judged; a load that picked the exact series is named.
  const exactPicks = live.filter((r) => recordOf(r, "switch")?.pick === "exact").map((r) => `${r.cell}/${r.volume}/${r.arm} round ${r.round}`);
  return { digest, verdicts, unbalanced, aa: aaCells(live), exactPicks };
}

/** A′ ÷ A's median fill a cell, over the rounds with both. */
export function aaMedianRatio(cells) {
  return Object.fromEntries(Object.entries(cells).map(([key, { ref, aa }]) => {
    const ratios = ref.flatMap((a, k) => (a != null && aa[k] != null ? [aa[k] / a] : []));
    return [key, ratios.length ? median(ratios) : null];
  }));
}

/** Each cell's loads, `VOID` loads and loads by reason, a reason's numbers dropped. */
export function voidShares(rows) {
  const out = {};
  for (const r of rows) {
    const c = (out[r.cell] ??= { loads: 0, void: 0, reasons: {} });
    c.loads += 1;
    if (!r.void?.length) continue;
    c.void += 1;
    for (const why of new Set(r.void.map((w) => (w.startsWith("crash") ? "crash" : w.replace(/(?<![A-Za-z])\d+(\.\d+)?/g, "N"))))) c.reasons[why] = (c.reasons[why] ?? 0) + 1;
  }
  return out;
}

/** `--pilot-medians`' file: each (cell, volume, arm)'s median fill over the pilot's loads not `VOID`. */
export function pilotMedians(rows) {
  const fills = {};
  for (const r of rows) if (r.pilot && !r.void?.length && r.load?.fillMs != null) (fills[`${r.cell}/${r.volume}/${r.arm}`] ??= []).push(r.load.fillMs);
  return Object.fromEntries(Object.entries(fills).map(([k, v]) => [k, median(v)]));
}

/** Epoch ms of each blackout sent, as ms from the load's dial; null without a dial. */
export const blackoutsFromDial = (at, dial) => (dial == null ? null : at.map((t) => t - dial));

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

export const line = (v) => `${v.cell} ${v.volume} ${v.arm.padEnd(5)} ${v.kind.padEnd(11)} predicted ${v.ms.toFixed(0)} ms, median ×${v.median.toFixed(3)} (${v.inBand}/${v.n} in ${v.band.join("–")}): ` +
  `${v.reported ? "REPORTED, not judged" : v.holds ? "HOLDS" : v.cannotHold ? `CANNOT HOLD: ${v.n} counted, median ${v.side}` : `MISSES ${v.side}`}${v.regimeMiss ? `; REGIME MISS (${v.regimeMisses} rounds)` : ""}${v.void ? `; ${v.void} VOID` : ""}` +
  `${v.xMeasured != null ? `; x ${v.xMeasured.toFixed(2)} (predicted ${v.x.toFixed(2)})` : ""}${v.roundPaired ? `; round-paired ×${v.roundPaired.median.toFixed(3)} ${v.roundPaired.holds ? "holds" : "misses"}` : ""}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const [predictionsFile, ...rowFiles] = process.argv.slice(2);
  const rows = rowFiles.flatMap((f) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
  const r = await judge(readFileSync(predictionsFile, "utf8"), rows);
  for (const v of r.verdicts) console.log(line(v));
  if (r.unbalanced.length) console.log(`UNBALANCED: ${r.unbalanced.join(" ")}`);
  console.log(r.exactPicks.length ? `the switch picked the exact series: ${r.exactPicks.join("; ")}` : "the switch picked the view in every load");
  const aaFile = rowFiles[0].replace(/\.jsonl$/, ".aa.json");
  writeFileSync(aaFile, JSON.stringify(r.aa, null, 1));
  for (const [cell, ratio] of Object.entries(aaMedianRatio(r.aa))) console.log(`A/A ${cell}: A′ ÷ A median ×${ratio?.toFixed(3) ?? "—"}`);
  console.log(`predictions xxh3 ${r.digest}; A/A input ${aaFile}: lab/scripts/aa_rule.py ${aaFile} --bar 0.05`);
  const medians = pilotMedians(rows);
  if (Object.keys(medians).length) {
    const file = rowFiles[0].replace(/\.jsonl$/, ".pilot-medians.json");
    writeFileSync(file, JSON.stringify(medians, null, 1));
    console.log(`pilot medians ${file}: run.mjs --pilot-medians ${file}`);
  }
}
