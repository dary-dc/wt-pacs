// node lab/delivery/judge.test.mjs — the judge of delivery-comparison.md §6–§8 on rows made to each case.
import { cellLoads } from "./plan.mjs";
import { aaCells, aaMedianRatio, blackoutsFromDial, decodersReadBack, exactLatencyOf, holds, judge, line, measuredRegime, pilotMedians, voidOf, voidShares } from "./judge.mjs";
import { digestOf } from "./predict.mjs";

let failed = 0;
const check = (ok, claim) => (console.log(`${ok ? "ok" : "FAIL"}: ${claim}`), ok || (failed += 1));
const throws = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };

/** 16 frames, one group of 8 per decoder at a time: wire-bound when the last byte is late, decode-bound when the decodes are long. */
const frames = ({ lastByteMs, decodeMs }) => Array.from({ length: 16 }, (_, i) => {
  const slot = i % 8;
  const decodedAt = 1000 + lastByteMs * (i + 1) / 16 + decodeMs * (slot + 1);
  return { i, lastByte: 1000 + lastByteMs * (i + 1) / 16, decodeMs, decodedAt };
});
const decodeBound = frames({ lastByteMs: 50, decodeMs: 20 });
const wireBound = frames({ lastByteMs: 2000, decodeMs: 1 });
const P = { cell: "LTE", volume: "dbts_a1", frames: 16, band: [0.75, 1.33] };
const predictions = [
  { ...P, arm: "A", kind: "fill", ms: 400, regime: "decode" },
  { ...P, arm: "A'", kind: "fill", ms: 400, regime: "decode" },
  { ...P, arm: "B", kind: "fill", ms: 2000, regime: "wire" },
  { ...P, arm: "C1", kind: "fill", ms: 400, regime: "decode" },
  { ...P, arm: "C1", kind: "latency", ms: 100, regime: null },
  { ...P, arm: "C1", kind: "askLastByte", ms: 60, regime: null },
  { ...P, arm: "FIT", kind: "fill", ms: 2000, regime: "wire" },
  { ...P, arm: "FIT", kind: "zoom", ms: 17, regime: null, judged: false },
  { ...P, arm: "SPLIT", kind: "fill", ms: 400, regime: null, x: 0.25 },
];
const text = JSON.stringify({ inputs: {}, predictions });
const digest = await digestOf(text);
/** One counted row a load of the plan, each measuring exactly its prediction unless `ratio(load)` says otherwise. */
const rowsOf = ({ ratio = () => 1, edit = () => ({}), fixedOrder = false } = {}) => cellLoads("LTE", { fixedOrder }).filter((l) => l.volume === "dbts_a1").map((l) => {
  const r = ratio(l);
  const exact = ["B", "FIT"].includes(l.arm);
  const row = { ...l, predictionsXxh3: digest, verdict: { ok: true }, load: { fillMs: (exact ? 2000 : 400) * r, fillFrom: 1000, frames: exact ? wireBound : decodeBound } };
  if (l.arm === "C1") row.records = [{ kind: "lossless", at: 5000 }, { kind: "askLastByte", ms: 60 * r }, { kind: "label", quality: "lossless", at: 5000 + 100 * r }];
  if (l.arm === "FIT") row.records = [{ kind: "zoom", ms: 17 * r }];
  if (l.arm === "SPLIT") row.records = [{ kind: "split", x: 0.25 }];
  return { ...row, ...edit(l, row) };
});
const verdictOf = (r, arm, kind = "fill") => r.verdicts.find((v) => v.arm === arm && v.kind === kind);

/** Every load on its prediction: the model holds on every arm and clock. */
let r = await judge(text, rowsOf());
check(r.verdicts.length === predictions.length && r.verdicts.every((v) => (v.holds || v.reported) && !v.regimeMiss), "judge: loads on their predictions hold, no regime miss");
check(verdictOf(r, "FIT", "zoom").reported && /REPORTED, not judged/.test(line(verdictOf(r, "FIT", "zoom"))), "judge: a level-0 zoom is reported, not judged");
check(verdictOf(r, "SPLIT").xMeasured === 0.25 && /x 0\.25 \(predicted 0\.25\)/.test(line(verdictOf(r, "SPLIT"))) && verdictOf(r, "SPLIT").regimeMisses === undefined, "judge: SPLIT's x reported beside its prediction, no regime judged");
check(r.exactPicks.length === 0, "judge: no switch record picks the exact series");
check(!r.unbalanced.length, "judge: the plan's Williams order is balanced");

/** The 10-of-12 rule: three rounds out of band misses though the median is in it. */
r = await judge(text, rowsOf({ ratio: (l) => (l.arm === "A" && l.round < 3 ? 2 : 1) }));
check(!verdictOf(r, "A").holds && verdictOf(r, "A").median === 1, "holds: 3 of 12 rounds out of band is a miss with the median in band");
check(holds([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2], [0.75, 1.33]).holds && !holds([1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2], [0.75, 1.33]).holds, "holds: 10 of 12 in band holds, 9 does not");

/** A median above the band misses, on its side. */
r = await judge(text, rowsOf({ ratio: (l) => (l.arm === "B" ? 1.5 : 1) }));
check(!verdictOf(r, "B").holds && verdictOf(r, "B").side === "above", "holds: B's median ×1.5 misses above");

/** A regime that misses in more than 2 of 12 rounds is a regime miss whatever the ratio. */
r = await judge(text, rowsOf({ edit: (l, row) => (l.arm === "A" && l.round < 3 ? { load: { ...row.load, frames: wireBound } } : {}) }));
check(verdictOf(r, "A").holds && verdictOf(r, "A").regimeMiss && verdictOf(r, "A").regimeMisses === 3, "regime: 3 wire-bound rounds of a decode-bound prediction is a regime miss");
check(measuredRegime({ fillFrom: 1000, frames: decodeBound }, 8).regime === "decode" && measuredRegime({ fillFrom: 1000, frames: wireBound }, 8).regime === "wire", "regime: read from the load's own last bytes and decodes");

/** C1's exact frame: press to the lossless label, and its ask → last byte from its own record; FIT's zoom from its own. */
check(exactLatencyOf([{ kind: "label", quality: "lossless", at: 1 }, { kind: "lossless", at: 10 }, { kind: "label", quality: "lossless", at: 42 }]) === 32, "C1: the press to the first lossless label after it");
r = await judge(text, rowsOf({ edit: (l) => (l.arm === "C1" ? { records: [{ kind: "lossless", at: 5000 }, { kind: "label", quality: "lossless", at: 5150 }] } : {}) }));
check(verdictOf(r, "C1", "fill").holds && !verdictOf(r, "C1", "latency").holds, "C1: its latency judged on its own clock, apart from its fill");
r = await judge(text, rowsOf({ edit: (l) => (l.arm === "C1" ? { records: [{ kind: "lossless", at: 5000 }, { kind: "askLastByte", ms: 120 }, { kind: "label", quality: "lossless", at: 5100 }] } : {}) }));
check(verdictOf(r, "C1", "latency").holds && !verdictOf(r, "C1", "askLastByte").holds && verdictOf(r, "C1", "askLastByte").side === "above", "C1: ask → last byte judged on its own clock (A2.4)");

/** A2.8: a FIT load on a volume with a level asks only its prefixes; the lever ignored (whole frames) refuses the judge. */
const fitText = JSON.stringify({ inputs: { volumes: { dbts_a1: { fit: { prefixes: Array(16).fill(512000) } } } }, predictions });
const fitDigest = await digestOf(fitText);
const fitRows = (kb) => rowsOf().map((x) => ({ ...x, predictionsXxh3: fitDigest, ...(x.arm === "FIT" && { load: { ...x.load, frames: x.load.frames.map((f) => ({ ...f, kb })) } }) }));
check((await throws(() => judge(fitText, fitRows(500)))) === null, "FIT: every frame its prefix, judged");
check(/refused: FIT round 0 dbts_a1: frame 0 carried 1800 KiB, its level prefix 500.0 KiB/.test((await throws(() => judge(fitText, fitRows(1800)))) ?? ""), "FIT: whole frames asked where the fit is a prefix, the judge refuses");

/** A2.3: a load whose switch picked the exact series is named. */
r = await judge(text, rowsOf({ edit: (l, row) => (l.arm === "A" && l.round === 4 ? { records: [{ kind: "switch", pick: "exact", G: 200, dV: 10 }] } : {}) }));
check(r.exactPicks.join() === "LTE/dbts_a1/A round 4", "switch: an exact pick is named, not judged");

/** predictions.json changed after the rows: the digest in the rows refuses it. */
const changed = await throws(() => judge(text.replace('"ms":400', '"ms":401'), rowsOf()));
check(/refused: .* carries predictions/.test(changed ?? ""), "digest: a predictions file changed after the rows is refused");

/** §6's VOID reasons, and the stop. */
check(decodersReadBack(decodeBound) === 2 && decodersReadBack(frames({ lastByteMs: 0, decodeMs: 20 }).slice(0, 3).map((f, i) => ({ ...f, decodedAt: 2000 + i }))) === 3, "read-back: two decoders, and three frames decoding at once read 3");
const three = { load: { fillMs: 1, frames: frames({ lastByteMs: 0, decodeMs: 20 }).map((f) => ({ ...f, decodedAt: 2000 })) } };
check(voidOf(three).why.some((w) => /decoders read back/.test(w)), "VOID: the decoders lever ignored, read back from the frames");
check(voidOf({ relayTally: { late: true } }).why.length === 1 && voidOf({ busy: [0.96, 0, 1, 1] }).why.length === 1 && voidOf({ busy: [0.5, 0.96, 1, 1] }).why.length === 1, "VOID: the relay's guard; core 0 or core 1 over 95 %");
check(!voidOf({ busy: [0.5, 0.5, 1, 1] }).why.length, "VOID: the browser's cores busy is not a reason");
check(voidOf({ load: { fillMs: 31 } }, { pilotMedian: 10 }).why.length === 1 && !voidOf({ load: { fillMs: 29 } }, { pilotMedian: 10 }).why.length, "VOID: a load past 3× its pilot median");
check(/^STOP: /.test(voidOf({ cell: "LTE", verdict: { ok: false, why: "frame 3 decoded false, not exact" } }).stop ?? ""), "STOP: a failed load stops the run");
const stalled = voidOf({ verdict: { ok: false, void: "stopped", why: "the runner's timers stopped 2400 ms" } });
check(stalled.stop === null && stalled.why.length === 1, "VOID: the page's timers stopped voids the load, never stops the run");
check(voidOf({ crash: true, error: "x", verdict: { ok: false } }).stop === null && voidOf({ crash: true, error: "x" }).why.length === 1, "VOID: a crash voids, never stops");

/** Over 25 % VOID: strict and round-paired, both reported. */
r = await judge(text, rowsOf({ edit: (l) => (l.round < 4 && l.arm === "B" ? { void: ["x"] } : {}) }));
check(verdictOf(r, "B").strict && verdictOf(r, "B").roundPaired && verdictOf(r, "A").roundPaired === undefined, "VOID: B 4 of 12 VOID reports strict and round-paired, A neither");

/** A fixed cycle of arms is UNBALANCED. */
r = await judge(text, rowsOf({ fixedOrder: true }));
check(r.unbalanced.length > 0, `order: a fixed cycle is UNBALANCED (${r.unbalanced.slice(0, 2).join(" ")})`);

/** §7: A as the reference, A′ the copy, one value a round. */
const aa = aaCells(rowsOf().map((x) => ({ ...x, load: { fillMs: x.arm === "A'" ? 2 : 1 } })))["LTE/dbts_a1"];
check(aa.ref.length === 12 && aa.ref.every((v) => v === 1) && aa.aa.every((v) => v === 2), "A/A: aa_rule.py's input, A against A′ a round");

/** Under 10 counted rounds a cell cannot hold, and is printed so, never as a measured miss. */
r = await judge(text, rowsOf({ edit: (l) => (l.round < 3 && l.arm === "A" ? { void: ["x"] } : {}) }));
const nine = verdictOf(r, "A");
check(nine.n === 9 && nine.cannotHold && /CANNOT HOLD: 9 counted/.test(line(nine)) && !/MISSES/.test(line(nine)), `under 10: A with 9 counted rounds on its prediction (${line(nine)})`);
r = await judge(text, rowsOf({ ratio: (l) => (l.arm === "B" ? 1.5 : 1) }));
check(/MISSES above/.test(line(verdictOf(r, "B"))) && !verdictOf(r, "B").cannotHold, "under 10: twelve counted rounds above the band still MISS");

/** K3′'s calibration loads are never counted. */
r = await judge(text, [...rowsOf(), ...rowsOf().filter((x) => x.arm === "B").map((x) => ({ ...x, calibration: "K3′", load: { ...x.load, fillMs: 99999 } }))]);
check(verdictOf(r, "B").holds && verdictOf(r, "B").n === 12, "K3′: calibration loads left out of every verdict");

/** The pilot's VOID share per cell, by reason with its numbers dropped. */
const shares = voidShares([{ cell: "CLEAN", void: ["core 0 (the relay) 97 % busy"] }, { cell: "CLEAN", void: ["core 0 (the relay) 99 % busy", "crash: load 3: no end in 630 s"] }, { cell: "CLEAN" }, { cell: "PUB" }]);
check(JSON.stringify(shares) === JSON.stringify({ CLEAN: { loads: 3, void: 2, reasons: { "core N (the relay) N % busy": 2, crash: 1 } }, PUB: { loads: 1, void: 0, reasons: {} } }), "pilot: VOID share per cell by reason");

/** Each row's blackouts in ms from its dial. */
check(JSON.stringify(blackoutsFromDial([1500, 31500], 1200)) === "[300,30300]" && blackoutsFromDial([1500], undefined) === null, "blackouts: times from the dial, none without a dial");

/** A2.6: a browser process allowed outside cores 2–3 voids the load as escaped. */
const cpus = (allowed) => ({ cpus: [{ pid: 7, name: "chrome", allowed: "2-3" }, { pid: 8, name: "chrome", allowed }] });
check(voidOf(cpus("0,2-3")).why.some((w) => /^escaped: chrome 8 on 0,2-3$/.test(w)) && !voidOf(cpus("2,3")).why.length && !voidOf(cpus("3")).why.length, "VOID: a browser process allowed on core 0 is escaped; 2-3, 2,3 and 3 are not");

/** --pilot-medians' file: the median fill per (cell, volume, arm) of the pilot's counted loads only. */
const pr = (fillMs, extra = {}) => ({ pilot: true, cell: "LTE", volume: "dbts_a1", arm: "A", load: { fillMs }, ...extra });
check(JSON.stringify(pilotMedians([pr(10), pr(30), pr(1000, { pilot: false }), pr(5, { void: ["x"] })])) === '{"LTE/dbts_a1/A":20}', "pilot medians: counted pilot loads only");

/** A′ ÷ A's median a cell, printed beside the A/A rule (which, A′ being its copy and its arm, can only tie). */
check(JSON.stringify(aaMedianRatio({ "LTE/dbts_a1": { ref: [1, 2, null], aa: [2, 4, 3] } })) === '{"LTE/dbts_a1":2}', "A/A: A′ ÷ A's median, rounds with both");

/** B's measured regime counts units of one frame: 12 frames on two decoders floor at 6 frames, wire-bound at 140 ms. */
const twelve = Array.from({ length: 12 }, (_, i) => ({ i, lastByte: 1000 + (140 * (i + 1)) / 12, decodeMs: 20, decodedAt: 2000 + i }));
r = await judge(text, rowsOf({ edit: (l, row) => (l.arm === "B" ? { load: { ...row.load, frames: twelve } } : {}) }));
check(verdictOf(r, "B").regimeMisses === 0, "regime: B judged in units of one frame (in groups of 8 it would read decode-bound)");

console.log(failed ? `delivery judge: ${failed} FAILED` : "delivery judge: every claim holds");
process.exit(failed ? 1 : 0);
