// node lab/delivery/predict.test.mjs — the model of delivery-comparison.md §4.1 and its plan of cells (§1–§3).
import { balanced } from "../order.mjs";
import { ARMS, CELLS, VOLUMES, armParams, blackoutPhaseMs, cellLoads } from "./plan.mjs";
import { band, decodeFloor, digestOf, exactLatency, fill, predictions, regime, slowStart, unitsOf, wire } from "./predict.mjs";

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

/** Every (cell, volume, arm) is predicted; a prefix cell predicts its first N frames; C1 and C2 carry their second clock. */
const vol = { view: { frames: a1.view, group: 8, frameMs: 24.6 }, exact: { frames: a1.exact, frameMs: 19.8, loneMs: 19.8 }, shown: 0 };
const forms = Object.fromEntries(Object.keys(CELLS).map((c) => [c, clean]));
const p = predictions({ volumes: { dbts_a1: vol }, forms });
check(p.length === Object.keys(CELLS).length * (ARMS.length + 2), `predictions: ${p.length} rows, one a (cell, arm) and C1's latency and C2's span`);
check(p.filter((r) => r.cell === "LTE").every((r) => r.frames === 16) && p.filter((r) => r.cell === "CLEAN").every((r) => r.frames === 56), "predictions: LTE predicts its 16-frame prefix, CLEAN the whole volume");
const c2 = p.find((r) => r.cell === "CLEAN" && r.arm === "C2" && r.kind === "span");
check(near(p.find((r) => r.cell === "CLEAN" && r.arm === "B").ms, b.ms, 1e-9) && p.find((r) => r.cell === "CLEAN" && r.arm === "C1" && r.kind === "fill").ms < b.ms, "predictions: B fills the exact series, C1 the view");
check(near(c2.ms, b.ms, 1e-9), "predictions: C2's span is the exact series' own fill, never A's and B's added");
const dialed = predictions({ volumes: { dbts_a1: vol }, forms, exactDialed: true }).find((r) => r.cell === "CLEAN" && r.kind === "span");
check(near(c2.ms - dialed.ms, 6, 1e-9), "predictions: a C2 session dialed earlier starts 3 round trips sooner");

/** §2's order: a Williams row of the five arms a round, each volume, volumes rotated; balanced over a period. */
const loads = cellLoads("CLEAN");
check(loads.length === 10 * 5 * 3, `plan: ${loads.length} loads, 10 rounds × 5 arms × 3 volumes`);
const perVolume = VOLUMES.map((v) => loads.filter((l) => l.volume === v).map((l) => ({ ...l, unit: l.arm })));
check(perVolume.every((rows) => ARMS.every((a) => balanced(rows, a, ARMS))), "plan: every arm follows every other equally often within a volume");
check(!ARMS.every((a) => balanced(cellLoads("CLEAN", { fixedOrder: true }).filter((l) => l.volume === "dbts_a1").map((l) => ({ ...l, unit: l.arm })), a, ARMS)), "plan: a fixed order is not balanced");
check(loads.slice(0, 15).map((l) => l.volume).join() !== loads.slice(15, 30).map((l) => l.volume).join(), "plan: the volumes rotate between rounds");
check(JSON.stringify([armParams("C1"), armParams("C2"), armParams("B")]) === JSON.stringify([{ decoders: "2", press: "lossless", pressAfter: "1000" }, { decoders: "2", exactFill: "1" }, { decoders: "2" }]), "plan: two decoders every arm, C1 presses 1 s after, C2 fills the exact series");

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
