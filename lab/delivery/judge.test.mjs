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
  { ...P, arm: "C2", kind: "fill", ms: 400, regime: "decode" },
  { ...P, arm: "C2", kind: "span", ms: 2000, regime: "wire" },
];
const text = JSON.stringify({ inputs: {}, predictions });
const digest = await digestOf(text);
/** One counted row a load of the plan, each measuring exactly its prediction unless `ratio(load)` says otherwise. */
const rowsOf = ({ ratio = () => 1, edit = () => ({}), fixedOrder = false } = {}) => cellLoads("LTE", { fixedOrder }).filter((l) => l.volume === "dbts_a1").map((l) => {
  const r = ratio(l);
  const fill = (l.arm === "B" ? 2000 : 400) * r;
  const row = { ...l, predictionsXxh3: digest, verdict: { ok: true }, load: { fillMs: fill, fillFrom: 1000, frames: l.arm === "B" ? wireBound : decodeBound } };
  if (l.arm === "C1") row.records = [{ kind: "lossless", at: 5000 }, { kind: "label", quality: "lossless", at: 5000 + 100 * r }];
  if (l.arm === "C2") row.exactFill = { spanMs: 2000 * r };
  return { ...row, ...edit(l, row) };
});
const verdictOf = (r, arm, kind = "fill") => r.verdicts.find((v) => v.arm === arm && v.kind === kind);

/** Every load on its prediction: the model holds on every arm and clock. */
let r = await judge(text, rowsOf());
check(r.verdicts.length === predictions.length && r.verdicts.every((v) => v.holds && !v.regimeMiss), "judge: loads on their predictions hold, no regime miss");
check(!r.unbalanced.length, "judge: the plan's Williams order is balanced");

/** The 8-of-10 rule: three rounds out of band misses though the median is in it. */
r = await judge(text, rowsOf({ ratio: (l) => (l.arm === "A" && l.round < 3 ? 2 : 1) }));
check(!verdictOf(r, "A").holds && verdictOf(r, "A").median === 1, "holds: 3 of 10 rounds out of band is a miss with the median in band");
check(holds([1, 1, 1, 1, 1, 1, 1, 1, 2, 2], [0.75, 1.33]).holds, "holds: 8 of 10 in band holds");

/** A median above the band misses, on its side. */
r = await judge(text, rowsOf({ ratio: (l) => (l.arm === "B" ? 1.5 : 1) }));
check(!verdictOf(r, "B").holds && verdictOf(r, "B").side === "above", "holds: B's median ×1.5 misses above");

/** A regime that misses in more than 2 of 10 rounds is a regime miss whatever the ratio. */
r = await judge(text, rowsOf({ edit: (l, row) => (l.arm === "A" && l.round < 3 ? { load: { ...row.load, frames: wireBound } } : {}) }));
check(verdictOf(r, "A").holds && verdictOf(r, "A").regimeMiss && verdictOf(r, "A").regimeMisses === 3, "regime: 3 wire-bound rounds of a decode-bound prediction is a regime miss");
check(measuredRegime({ fillFrom: 1000, frames: decodeBound }, 8).regime === "decode" && measuredRegime({ fillFrom: 1000, frames: wireBound }, 8).regime === "wire", "regime: read from the load's own last bytes and decodes");

/** C1's exact frame: press to the lossless label; C2's span only from its own exactFill record. */
check(exactLatencyOf([{ kind: "label", quality: "lossless", at: 1 }, { kind: "lossless", at: 10 }, { kind: "label", quality: "lossless", at: 42 }]) === 32, "C1: the press to the first lossless label after it");
r = await judge(text, rowsOf({ edit: (l) => (l.arm === "C1" ? { records: [{ kind: "lossless", at: 5000 }, { kind: "label", quality: "lossless", at: 5150 }] } : {}) }));
check(verdictOf(r, "C1", "fill").holds && !verdictOf(r, "C1", "latency").holds, "C1: its latency judged on its own clock, apart from its fill");
r = await judge(text, rowsOf({ ratio: (l) => (l.arm === "C2" ? 2 : 1), edit: (l) => (l.arm === "C2" ? { exactFill: { spanMs: 2000 } } : {}) }));
check(verdictOf(r, "C2", "span").holds && !verdictOf(r, "C2", "fill").holds, "C2: its span from its own record holds while its view's fill misses");
const noC2 = await throws(() => judge(text, rowsOf({ edit: (l) => (l.arm === "C2" ? { exactFill: undefined } : {}) })));
check(/C2 reads only its own/.test(noC2 ?? ""), `C2: no exactFill record and the judge refuses (${noC2})`);

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
r = await judge(text, rowsOf({ edit: (l) => (l.round < 3 && l.arm === "B" ? { void: ["x"] } : {}) }));
check(verdictOf(r, "B").strict && verdictOf(r, "B").roundPaired && verdictOf(r, "A").roundPaired === undefined, "VOID: B 3 of 10 VOID reports strict and round-paired, A neither");

/** A fixed cycle of arms is UNBALANCED. */
r = await judge(text, rowsOf({ fixedOrder: true }));
check(r.unbalanced.length > 0, `order: a fixed cycle is UNBALANCED (${r.unbalanced.slice(0, 2).join(" ")})`);

/** §7: A as the reference, A′ the copy, one value a round. */
const aa = aaCells(rowsOf().map((x) => ({ ...x, load: { fillMs: x.arm === "A'" ? 2 : 1 } })))["LTE/dbts_a1"];
check(aa.ref.length === 10 && aa.ref.every((v) => v === 1) && aa.aa.every((v) => v === 2), "A/A: aa_rule.py's input, A against A′ a round");

/** Under 8 counted rounds a cell cannot hold, and is printed so, never as a measured miss. */
r = await judge(text, rowsOf({ edit: (l) => (l.round < 3 && l.arm === "A" ? { void: ["x"] } : {}) }));
const seven = verdictOf(r, "A");
check(seven.n === 7 && seven.cannotHold && /CANNOT HOLD: 7 counted/.test(line(seven)) && !/MISSES/.test(line(seven)), `under 8: A with 7 counted rounds on its prediction (${line(seven)})`);
r = await judge(text, rowsOf({ ratio: (l) => (l.arm === "B" ? 1.5 : 1) }));
check(/MISSES above/.test(line(verdictOf(r, "B"))) && !verdictOf(r, "B").cannotHold, "under 8: ten counted rounds above the band still MISS");

/** The pilot's VOID share per cell, by reason with its numbers dropped. */
const shares = voidShares([{ cell: "CLEAN", void: ["core 0 (the relay) 97 % busy"] }, { cell: "CLEAN", void: ["core 0 (the relay) 99 % busy", "crash: load 3: no end in 630 s"] }, { cell: "CLEAN" }, { cell: "PUB" }]);
check(JSON.stringify(shares) === JSON.stringify({ CLEAN: { loads: 3, void: 2, reasons: { "core N (the relay) N % busy": 2, crash: 1 } }, PUB: { loads: 1, void: 0, reasons: {} } }), "pilot: VOID share per cell by reason");

/** Each row's blackouts in ms from its dial. */
check(JSON.stringify(blackoutsFromDial([1500, 31500], 1200)) === "[300,30300]" && blackoutsFromDial([1500], undefined) === null, "blackouts: times from the dial, none without a dial");

/** C2's own downloader is read back too. */
check(voidOf({ arm: "C2", load: { frames: decodeBound }, exactFill: { frames: three.load.frames.map((f) => ({ i: f.i, at: f.decodedAt, decodeMs: f.decodeMs })) } }).why.some((w) => /exact fill/.test(w)), "VOID: C2's exact fill with 3 decoders read back");

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
