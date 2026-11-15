// node lab/cache-arms/cells.test.mjs — each row check fails on the row its mutant leaves, and the cells' sizes.
import { checks, E_STEPS, moduleOf, params, sameSet } from "./cells.mjs";

let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));

const good = { config: { rateMBps: 125 }, verify: { ok: 50, notOk: 0 }, unwrittenAt5s: 0, deliveredMBps: 124, opened: { writer: true } };
const all = (c) => Object.values(c).every(Boolean);
check(all(checks("L", good)), "an unmutated L row passes every check");
check(!checks("W", { ...good, verify: { ok: 0, notOk: 50 } }).exact, "drop-writes: the read-back fails");
check(!checks("K", { ...good, verify: { ok: 63, notOk: 1 } }).exact, "one frame of 64 not exact fails the row");
check(!checks("L", { ...good, deliveredMBps: 60 }).delivered, "slot-held: the delivered rate fails");
check(!checks("L", { ...good, unwrittenAt5s: 3 }).allWritten, "a writer behind: frames unwritten at +5 s");
const k = { ...good, read: { damaged: [] }, damagedAsked: 7 };
check(!checks("K", k).damageReported, "no-recheck: the damaged frame goes unreported");
check(checks("K", { ...k, read: { damaged: [7] } }).damageReported, "the damaged frame reported");
const reader = { ...good, opened: { writer: false }, store: { storeWrites: 0 }, rest: { storeWrites: 0 } };
check(checks("T", reader).readerWroteNothing, "a reading tab that writes nothing passes");
check(!checks("T", { ...reader, rest: { storeWrites: 2 } }).readerWroteNothing, "tab-writes: the reading tab's writes fail");
check(!checks("L", { error: "x" }).ran, "a row that did not run says so");

check(moduleOf("OPFS-SYNC-aa") === "opfs-sync" && moduleOf("none") === "none", "an A/A twin loads its arm's module");
check(params("L", "2560", "none").n === 4 + 74 && params("L", "2560", "none").floor === 0, "L at S2: 10 s at 125 MB/s of 17.0 MB frames, no floor for none");
check(params("W", "512", "stub").n === 4 + 1908 && params("W", "512", "stub").credits === 3, "W at S1: 1 000 MB on credit");
check(params("O", "3328", "stub").n === 32 && params("O", "512", "stub").n === 256, "O: 32 × S3, 256 × S1");
check(sameSet(E_STEPS.at(-1).expect, ["D", "A"]) && E_STEPS.length === 5, "E's sequence ends {A, D}");

if (failed) process.exit(1);
console.log("cache-arms: the cells' parameters and row checks hold");
