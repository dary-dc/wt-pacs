// node lab/delivery/inputs.test.mjs — K1–K3 read into the predictor's inputs (delivery-comparison.md §4.2).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { benchMs, frameBytes, wireLine } from "./inputs.mjs";

let failed = 0;
const check = (ok, claim) => (console.log(`${ok ? "ok" : "FAIL"}: ${claim}`), ok || (failed += 1));

/** K3's line through two prefixes' medians: 1 MB more taking 100 ms more is 80 Mbit/s, its start the intercept. */
const line = wireLine([{ bytes: 1e6, ms: 130 }, { bytes: 1e6, ms: 120 }, { bytes: 1e6, ms: 125 }, { bytes: 2e6, ms: 225 }, { bytes: 2e6, ms: 900 }, { bytes: 2e6, ms: 220 }]);
check(Math.abs(line.goodputMbit - 80) < 1e-9 && Math.abs(line.startMs - 25) < 1e-9, `K3: start ${line.startMs} ms, goodput ${line.goodputMbit} Mbit/s from the medians (an outlier ignored)`);
let refused = null;
try { wireLine([{ bytes: 1, ms: 1 }]); } catch (e) { refused = e.message; }
check(/two prefixes/.test(refused ?? ""), "K3: one prefix is refused");

/** K2: the median per-frame time of a series on a decoder count, over its loads that passed. */
const bench = (series, decoders, ms, extra = {}) => ({ volume: "v", series, verdict: { ok: true }, bench: { decoders, frames: ms.map((m) => ({ ms: m })) }, ...extra });
const k2 = [bench("exact", 2, [10, 12, 14]), bench("exact", 2, [11]), bench("exact", 1, [5, 6, 7]), bench("exact", 2, [99, 99, 99, 99, 99], { void: ["x"] }), bench("view", 2, [3])];
check(benchMs(k2, "v", "exact", 2) === 11.5 && benchMs(k2, "v", "exact", 1) === 6 && benchMs(k2, "v", "view", 2) === 3, "K2: per decoder count and series, VOID loads left out");

/** K1: frame files in index order, metadata and digests left out. */
const dir = mkdtempSync(`${tmpdir()}/k1-`);
for (const [f, n] of [["001.htj2k", 20], ["000.htj2k", 10], ["000.sha256", 64], ["metadata.json", 5]]) writeFileSync(`${dir}/${f}`, Buffer.alloc(n));
check(JSON.stringify(frameBytes(dir)) === "[10,20]", "K1: each frame's bytes, in order");

console.log(failed ? `delivery inputs: ${failed} FAILED` : "delivery inputs: every claim holds");
process.exit(failed ? 1 : 0);
