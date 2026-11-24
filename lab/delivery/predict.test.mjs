// node lab/delivery/predict.test.mjs — the model of delivery-comparison.md §4.1 and §Amendment 2, and its plan of cells (§1–§3).
import { readFileSync } from "node:fs";
import { balanced } from "../order.mjs";
import { wireCurves } from "./inputs.mjs";
import { voidOf } from "./judge.mjs";
import { ARMS, CELLS, K3_PRIME_LOADS, VOLUMES, armParams, blackoutPhaseMs, cellLoads, k3PrimeLoads } from "./plan.mjs";
import { askLastByte, band, curveStart, decodeFloor, digestOf, exactLatency, fill, predictions, regime, slowStart, unitsOf, wire } from "./predict.mjs";

let failed = 0;
const check = (ok, claim) => (console.log(`${ok ? "ok" : "FAIL"}: ${claim}`), ok || (failed += 1));
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** §4.3's inputs for `dbts_a1` (56 frames of ~1.21 MB, the cut view at 0.0686 of it) on CLEAN and CR. */
const frameBytes = 1212500;
const a1 = { exact: Array(56).fill(frameBytes), view: Array(56).fill(frameBytes * 0.0686) };
const clean = { startMs: 26, goodputMbit: 86.8, rttMs: 2 };
const cr = { startMs: 2420, goodputMbit: 26.4, rttMs: 800 };

/** The wire term is the start plus the bytes at goodput. */
check(near(wire(1e6, { startMs: 10, goodputMbit: 8 }), 1010, 1e-9), "wire: 1 MB at 8 Mbit/s after 10 ms is 1010 ms");

/** The decode floor hands units in order to the first free decoder. */
check(decodeFloor([8, 8, 8], 10, 2) === 160, "decode floor: three groups of 8 on 2 decoders is two groups' time");
check(decodeFloor([8, 1, 1], 10, 2) === 80, "decode floor: the small units go to the other decoder");
check(JSON.stringify(unitsOf(20, 8)) === "[8,8,4]", "units: 20 frames in groups of 8 leave a group of 4");

/** The regime is wire or decode only past 10 %. */
check(regime(111, 100) === "wire" && regime(100, 111) === "decode" && regime(105, 100) === "near", "regime: 10 % either way, else near");

/** §4.3: CLEAN's A on dbts_a1 is decode-bound at ~0.87 s, B wire-bound at ~6.29 s. */
const viewA = fill(a1.view, { group: 8, frameMs: 19.8 * 1.24 }, clean);
check(near(viewA.ms, 870, 10) && viewA.regime === "decode", `fill: A CLEAN dbts_a1 ${viewA.ms.toFixed(0)} ms decode-bound (§4.3: 0.87 s)`);
const b = fill(a1.exact, { group: 1, frameMs: 19.8 }, clean);
check(near(b.ms, 6290, 15) && b.regime === "wire", `fill: B CLEAN dbts_a1 ${b.ms.toFixed(0)} ms wire-bound (§4.3: 6.29 s)`);

/** §4.3: C1's exact frame on CR is ~8 round trips of slow start, 5.8 s; on CLEAN 0.15 s. */
check(near(exactLatency(frameBytes, cr, 19.8), 5800, 50), `latency: C1 CR dbts_a1 ${exactLatency(frameBytes, cr, 19.8).toFixed(0)} ms (§4.3: 5.8 s)`);
check(near(exactLatency(frameBytes, clean, 19.8), 150, 5), `latency: C1 CLEAN dbts_a1 ${exactLatency(frameBytes, clean, 19.8).toFixed(0)} ms (§4.3: 0.15 s)`);
check(near(fill(Array(10).fill(1000), { group: 1, frameMs: 1 }, { startMs: 0, goodputMbit: 8 }).ms, 11, 1e-9), "fill: wire-bound, the last frame decodes after its last byte");
check(slowStart(12000, 100, 10) === 9.6, "slow start: the initial window's bytes go in one flight at goodput");
check(slowStart(36000, 100, 1000) === 100 + 0.192, "slow start: a second flight costs a round trip");

/** §8's bands: wider on the lossy forms. */
check(JSON.stringify([band("CLEAN", "fill"), band("LTE", "fill"), band("CR", "latency"), band("LOSS", "latency")]) === "[[0.85,1.15],[0.75,1.33],[0.75,1.33],[0.6,1.67]]", "bands: §8's");

/** Every (cell, volume, arm) is predicted; a prefix cell predicts its first N frames; C1 and FIT carry their second clocks. */
const vol = { view: { frames: a1.view, group: 8, frameMs: 24.6 }, exact: { frames: a1.exact, frameMs: 19.8, loneMs: 19.8 }, shown: 0 };
const forms = Object.fromEntries(Object.keys(CELLS).map((c) => [c, clean]));
const p = predictions({ volumes: { dbts_a1: vol }, forms });
check(p.length === Object.keys(CELLS).length * (ARMS.length + 3), `predictions: ${p.length} rows, one a (cell, arm), C1's latency and ask → last byte, FIT's zoom`);
check(p.filter((r) => r.cell === "LTE").every((r) => r.frames === 16) && p.filter((r) => r.cell === "CLEAN").every((r) => r.frames === 56), "predictions: LTE predicts its 16-frame prefix, CLEAN the whole volume");
check(near(p.find((r) => r.cell === "CLEAN" && r.arm === "B").ms, b.ms, 1e-9) && p.find((r) => r.cell === "CLEAN" && r.arm === "C1" && r.kind === "fill").ms < b.ms, "predictions: B fills the exact series, C1 the view");

/** A2.2: on a volume that fits at level 0 FIT is B, and its zoom is one paint, reported and not judged. */
const fitA = p.filter((r) => r.cell === "CLEAN" && r.arm === "FIT");
check(near(fitA.find((r) => r.kind === "fill").ms, b.ms, 1e-9) && fitA.find((r) => r.kind === "zoom").ms === 17 && fitA.find((r) => r.kind === "zoom").judged === false, "predictions: FIT at level 0 is B's fill, its zoom 17 ms and not judged");

/** A2.4: K3′'s curve passes through its points, starts at 3 RTT + 20 ms, and continues its last segment past the last point. */
const lte = { rttMs: 38, curve: [[1e6, 500], [2e6, 1500]] };
check(wire(0, lte) === curveStart(38) && wire(1e6, lte) === 500 && wire(1.5e6, lte) === 1000 && wire(3e6, lte) === 2500 && near(wire(5e5, lte), (134 + 500) / 2, 1e-9),
  "wire curve: through its points, from 3 RTT + 20 ms, the last segment continued");
check(askLastByte(1e6, lte) === 500 - 134 + 38, "C1 ask → last byte on a curve: the first frame's point less the dial, plus one round trip");

/** A2.7's table and A2.3's SPLIT ÷ A, reproduced from the 2026-11-23 inputs and B loads (prefix 0.271 of a frame, its decode 0.29). */
const R = new URL("./", import.meta.url).pathname;
const inp = JSON.parse(readFileSync(`${R}inputs.json`));
const b1 = inp.volumes.dbts_b1;
b1.fit = { level: 1, prefixes: b1.exact.frames.map((x) => x * 0.271), rests: b1.exact.frames.map((x) => x * 0.729), frameMs: b1.exact.frameMs * 0.29 };
for (const cell of ["LTE", "LOSS"]) {
  const pilot = JSON.parse(readFileSync(`${R}rows/${cell}-pilot.pilot-medians.json`));
  const B = readFileSync(`${R}rows/${cell}.jsonl`, "utf8").trim().split("\n").map(JSON.parse).filter((r) => r.arm === "B" && !voidOf(r, { pilotMedian: pilot[`${cell}/${r.volume}/B`] }).why.length);
  inp.forms[cell] = { rttMs: inp.forms[cell].rttMs, curves: wireCurves(B, Object.fromEntries(Object.entries(inp.volumes).map(([v, x]) => [v, x.exact.frames])), CELLS[cell].prefix) };
}
const q = predictions(inp);
const s_ = (cell, volume, arm, kind = "fill") => q.find((r) => r.cell === cell && r.volume === volume && r.arm === arm && r.kind === kind).ms / 1000;
const table = ["CLEAN", "PUB", "CR", "LTE", "LOSS"].map((c) => [s_(c, "dbts_b1", "A"), s_(c, "dbts_b1", "B"), s_(c, "dbts_b1", "FIT"), s_(c, "dbts_b1", "FIT", "zoom")].map((x) => x.toFixed(2)).join(" "));
check(table.join(" | ") === "5.75 9.97 2.72 0.20 | 5.85 10.08 2.83 0.22 | 13.80 35.07 14.96 1.25 | 2.66 23.40 2.47 0.49 | 5.00 24.35 4.63 0.88", `A2.7: dbts_b1's A, B, FIT and FIT's zoom (${table.join(" | ")})`);
const splitA = ["CLEAN", "PUB"].map((c) => VOLUMES.map((v) => (s_(c, v, "SPLIT") / s_(c, v, "A")).toFixed(2)).join(" "));
const xs = VOLUMES.map((v) => q.find((r) => r.cell === "CLEAN" && r.volume === v && r.arm === "SPLIT").x.toFixed(2)).join(" ");
check(splitA.join(" | ") === "0.90 0.81 0.87 | 0.90 0.82 0.87" && xs === "0.15 0.26 0.19", `A2.3: SPLIT ÷ A on CLEAN and PUB (${splitA.join(" | ")}), x on CLEAN (${xs})`);
check(["CR", "LTE", "LOSS"].every((c) => VOLUMES.every((v) => s_(c, v, "SPLIT") === s_(c, v, "A"))), "A2.3: SPLIT is A where A is wire-bound (CR, LTE, LOSS)");

/** §2's order: a Williams row of the six arms a round, each volume, volumes rotated; balanced over a period. */
const loads = cellLoads("CLEAN");
check(loads.length === 12 * 6 * 3, `plan: ${loads.length} loads, 12 rounds × 6 arms × 3 volumes`);
const perVolume = VOLUMES.map((v) => loads.filter((l) => l.volume === v).map((l) => ({ ...l, unit: l.arm })));
check(perVolume.every((rows) => ARMS.every((a) => balanced(rows, a, ARMS))), "plan: every arm follows every other equally often within a volume");
check(!ARMS.every((a) => balanced(cellLoads("CLEAN", { fixedOrder: true }).filter((l) => l.volume === "dbts_a1").map((l) => ({ ...l, unit: l.arm })), a, ARMS)), "plan: a fixed order is not balanced");
check(loads.slice(0, 18).map((l) => l.volume).join() !== loads.slice(18, 36).map((l) => l.volume).join(), "plan: the volumes rotate between rounds");
check(JSON.stringify([armParams("C1"), armParams("FIT"), armParams("SPLIT", "CLEAN"), armParams("B")]) === JSON.stringify([{ decoders: "2", press: "lossless", pressAfter: "1000" }, { decoders: "2", fit: "1", zoomAfter: "1000" }, { decoders: "2", split: "1", ahead: "22500" }, { decoders: "2" }]),
  "plan: two decoders every arm, C1 presses 1 s after, FIT zooms 1 s after, SPLIT splits with CLEAN's 22 500 B ahead");
check(JSON.stringify(["PUB", "CR", "LTE", "LOSS"].map((c) => armParams("SPLIT", c).ahead)) === '["225000","9000000","237500","100000"]', "plan: SPLIT's window is each form's round trip × its rate");
check(loads.filter((l) => l.arm === "FIT").every((l) => l.series === "fit") && loads.filter((l) => l.arm === "SPLIT").every((l) => l.series === "view"), "plan: FIT loads its fit series, SPLIT the view with its pair");

/** A2.4's K3′: 8 B loads a lossy (form, volume), not counted, on the lossy forms only. */
const k3p = k3PrimeLoads("LOSS");
check(k3p.length === K3_PRIME_LOADS * 3 && k3p.every((l) => l.arm === "B" && l.calibration === "K3′") && VOLUMES.every((v) => k3p.filter((l) => l.volume === v).length === 8), "K3′: 8 B loads a volume, marked calibration");
let refusedClean = null;
try { k3PrimeLoads("CLEAN"); } catch (e) { refusedClean = e.message; }
check(/only the lossy forms/.test(refusedClean ?? ""), "K3′: a clean form is refused");

/** §3's table pinned: each form's delay one way, rate, queue and loss, its round trip, prefix and K3's prefixes. */
const relayOf = (c) => CELLS[c].relay.join(" ");
check(relayOf("CLEAN") === "--delay-ms 1 --rate-kbit 90000 --queue-pkts 300" && relayOf("PUB") === "--delay-ms 10 --rate-kbit 90000 --queue-pkts 2000"
  && relayOf("CR") === "--delay-ms 400 --rate-kbit 90000 --queue-pkts 1875" && relayOf("LTE") === "--delay-ms 19 --rate-kbit 50000 --queue-pkts 3300 --loss 0.1",
  "plan: CLEAN, PUB, CR and LTE's relay forms are §3's");
const geArg = (k) => Number(CELLS.LOSS.relay[CELLS.LOSS.relay.indexOf(k) + 1]);
check(relayOf("LOSS").startsWith("--delay-ms 20 --rate-kbit 20000 --queue-pkts 200 --loss-model ge") && near(geArg("--ge-p") / (geArg("--ge-p") + geArg("--ge-r")), 0.01, 1e-6) && near(100 / geArg("--ge-r"), 3.5, 1e-4),
  "plan: LOSS is §3's Gilbert–Elliott at a mean 1 %, bursts of 3.5 packets");
check(JSON.stringify(Object.values(CELLS).map((c) => [c.rttMs, c.prefix ?? null, c.lossPct ?? 0, c.blackoutEveryMs ?? 0, c.k3])) === JSON.stringify([[2, null, 0, 0, [8, 50]], [20, null, 0, 0, [8, 50]], [38, 16, 0.1, 30000, [4, 16]], [40, 8, 1, 0, [4, 8]], [800, null, 0, 0, [8, 50]]]),
  "plan: round trips, prefixes, the pilot's loss, LTE's blackout every 30 s and K3's prefixes are §3's and §4.2's");

/** LTE's blackout timer starts at a phase drawn per load, seeded and uniform over its period, so a fill meets blackouts at the form's rate. */
const phases = cellLoads("LTE").map((l) => l.blackoutPhaseMs);
check(phases.every((ms) => Number.isInteger(ms) && ms >= 0 && ms < 30000), "blackout: every LTE load's phase is in [0, 30 s)");
check(JSON.stringify(cellLoads("LTE").map((l) => l.blackoutPhaseMs)) === JSON.stringify(phases), "blackout: the same plan draws the same phases (seeded)");
const tenths = Array.from({ length: 10 }, (_, k) => phases.filter((ms) => Math.floor(ms / 3000) === k).length);
check(tenths.every((n) => n >= 5 && n <= 30), `blackout: each 3 s tenth of the period holds 5–30 of the 150 phases (${tenths.join(" ")})`);
check(cellLoads("CLEAN").every((l) => l.blackoutPhaseMs === undefined) && blackoutPhaseMs("LOSS", "K3/1/4") === undefined, "blackout: no phase on a form without blackouts");
check(blackoutPhaseMs("LTE", "K3/1/4") !== blackoutPhaseMs("LTE", "K3/1/16") && blackoutPhaseMs("LTE", "K3/1/4") === blackoutPhaseMs("LTE", "K3/1/4"), "blackout: K3's visits draw by the same rule, one phase a key");

/** C1's latency is predicted on the frame on screen, frame 0, whatever the others weigh. */
const unequal = { ...vol, exact: { ...vol.exact, frames: [1e6, 3e6, ...a1.exact.slice(2)] } };
const c1 = predictions({ volumes: { dbts_a1: unequal }, forms }).find((r) => r.cell === "CLEAN" && r.arm === "C1" && r.kind === "latency");
check(near(c1.ms, exactLatency(1e6, clean, 19.8), 1e-9), "predictions: C1's latency is frame 0's");

/** The predictions file's digest is the product's XXH3-64. */
check((await digestOf("")) === "2d06800538d394c2", "digest: XXH3-64 of the empty string");

console.log(failed ? `delivery predict: ${failed} FAILED` : "delivery predict: every claim holds");
process.exit(failed ? 1 : 0);
