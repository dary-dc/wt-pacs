// node lab/cache-arms/cells.test.mjs — each row check fails on the row its mutant leaves, and the cells' sizes.
import { backlogAt5s, checks, E_STEPS, inflightOf, keptOnReopen, lBars, moduleOf, params, pageQuery, pssGrowth, sameSet } from "./cells.mjs";

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
check(checks("T", { opened: { writer: false }, rest: { storeWrites: 0 } }).readerWroteNothing, "a reading tab's reopen row, no fill of its own");
check(!checks("T", { opened: { writer: false } }).readerWroteNothing, "a reading tab with no write count says nothing passed");
check(!checks("L", { error: "x" }).ran, "a row that did not run says so");

check(moduleOf("OPFS-SYNC-aa") === "opfs-sync" && moduleOf("none") === "none", "an A/A twin loads its arm's module");
check(params("L", "2560", "none").n === 4 + 74 && params("L", "2560", "none").floor === 0, "L at S2: 10 s at 125 MB/s of 17.0 MB frames, no floor for none");
check(params("W", "512", "stub").n === 4 + 1908 && params("W", "512", "stub").credits === 3, "W at S1: 1 000 MB on credit");
check(params("O", "3328", "stub").n === 32 && params("O", "512", "stub").n === 256, "O: 32 × S3, 256 × S1");
check(sameSet(E_STEPS.at(-1).expect, ["D", "A"]) && E_STEPS.length === 5, "E's sequence ends {A, D}");

/** The backlog is sampled at the last post + 5 s, not after every frame is handled: a writer 9 s behind leaves frames
 *  unwritten there (review, harness B1). */
{
  let t = 0;
  const backlog = await backlogAt5s({
    due: 10, timeoutMs: 60000, now: () => t, sleep: async (ms) => void (t += Math.max(ms, 1)),
    posted: async () => ({ count: t >= 1000 ? 10 : 5, lastAt: t >= 1000 ? 1000 : 500 }),
    progress: async () => ({ handled: t >= 10000 ? 14 : 13 }),
  });
  check(backlog.at === 6000 && backlog.handled === 13, `the backlog sampled at last post + 5 s (${backlog.at} ms, ${backlog.handled} handled)`);
}

/** K's bar: present on reopen ≥ written at the kill − the arm's writes in flight; queued frames are not written, so
 *  they buy no slack (review, harness B2). */
check(inflightOf("") === 1 && inflightOf("inflight=3&body=buffered") === 3, "writes in flight: 1 by default, else the pilot's");
check(!keptOnReopen({ written: 35, queued: 8 }, 24, ""), "K: 11 frames lost of 35 written fails, whatever is queued");
check(keptOnReopen({ written: 35, queued: 8 }, 34, "") && !keptOnReopen({ written: 35 }, 33, ""), "K: one write in flight by default");
check(keptOnReopen({ written: 35 }, 32, "inflight=3"), "K: three in flight at inflight=3");

/** A mutant runs in the arm only: `none` stays clean, so L's bars against it can catch view-copy (review, harness B3). */
check(pageQuery({ arm: "none", n: 4 }, "view-copy", "inflight=3").mutant === undefined, "none runs unmutated");
check(pageQuery({ arm: "opfs-sync" }, "view-copy", "").mutant === "view-copy" && pageQuery({ arm: "idb" }, "", "").mutant === undefined, "the arm runs the mutant");

/** L's bars against `none` in the same round (§8.3): a delay p99 above `none`'s + 4 ms in every round fails the arm. */
{
  const row = (round, unit, delay, extra = {}) => ({ cell: "L", round, unit, prev: null, shown: { missedShare: 0.02, paintDelayP99: delay },
    deliveredMBps: 124, unwrittenAt5s: 0, pssGrowthMiB: 100, verify: { ok: 50, notOk: 0 }, ...extra });
  const rows = [0, 1, 2, 3].flatMap((r) => [row(r, "none", 8.5), row(r, "stub", 9), row(r, "copy", 15)]);
  const bars = lBars(rows, { frameBytes: 512 * 512 * 2, pilot: "" });
  check(bars.stub.pass && !bars.copy.pass && bars.copy.share.delayP99 === 0, "L: view-copy fails delay p99 against a clean none");
  check(bars.none === undefined && bars.stub.rounds === 4, "L: one summary an arm, over its rounds");
  const pss = lBars([row(0, "none", 8), row(0, "stub", 8, { pssGrowthMiB: 100 + 64 + 0.5 + 1 })], { frameBytes: 2 ** 19, pilot: "" });
  check(!pss.stub.pass && pss.stub.share.pss === 0, "L: PSS over none's + in flight × frame + 64 MiB fails");
  const late = lBars([row(0, "none", 8), row(0, "stub", 8, { unwrittenAt5s: 1 }), row(1, "none", 8), row(1, "stub", 8), row(2, "none", 8),
    row(2, "stub", 8), row(3, "none", 8), row(3, "stub", 8)], { frameBytes: 2 ** 19, pilot: "" });
  check(late.stub.pass && late.stub.share.backlog === 0.75, "L: a bar met in 3 rounds of 4 passes (≥ 75 %)");
  const four = (bad, from = 3) => lBars([0, 1, 2, 3].flatMap((r) => [row(r, "none", 8), row(r, "stub", 8, r >= from ? bad : {})]), { frameBytes: 1, pilot: "" });
  check(!four({ verify: { ok: 49, notOk: 1 } }).stub.pass, "L: one round of 4 not exact fails the arm");
  check(!four({ unwrittenAt5s: 2 }, 2).stub.pass, "L: a bar met in 2 rounds of 4 fails");
  check(!four({ shown: { missedShare: 0.04, paintDelayP99: 8 } }, 0).stub.pass, "L: missed share over none's + 1 % fails");
  check(!four({ deliveredMBps: 0.9 * 124 }, 0).stub.pass, "L: a delivered rate under 0.95 × none's fails");
}

/** The PSS window opens once the page's floor probe is done: the floor's memory counts in no arm's growth (review,
 *  harness B7). */
{
  let pss = 100;
  let floorDone = false;
  const load = async () => {
    await new Promise((r) => setTimeout(r, 20));
    pss = 800;
    await new Promise((r) => setTimeout(r, 20));
    floorDone = true;
    pss = 700;
    await new Promise((r) => setTimeout(r, 20));
    pss = 760;
    await new Promise((r) => setTimeout(r, 40));
    return { ok: true };
  };
  const g = await pssGrowth({ load, floorDone: async () => floorDone, pss: () => pss, everyMs: 5 });
  check(g.row.ok && g.pssGrowthMiB === 60, `the growth from after the floor (${g.pssGrowthMiB} MiB)`);
}

if (failed) process.exit(1);
console.log("cache-arms: the cells' parameters and row checks hold");
