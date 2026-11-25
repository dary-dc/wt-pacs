# The cache: which store keeps decoded frames, and may it be turned on

Written 2026-11-22 by row CACHE-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none of the
cache's rows, from pushed results only; nothing run. Inputs at: `claude/cache-plan` `70aba834`
(`docs/client/evidence/cache-plan.md` §8–§10), `claude/cache-arms` `e988f9c6` (the rows), `claude/docs-client`
`6120da78` (`docs/client/design.md` §Open; `docs/client/evidence/what-the-cache-leaves-on-a-device.md`,
`frame-memory-ownership.md`), `claude/device-theory` `055f152b` (`docs/decode/mobile/device-model.md`). § numbers
below are `cache-plan.md`'s unless another file is named.

## 1 · The question

Kept on the device, decoded frames make a reopened study open in a fraction of a second instead of being fetched
again. Two questions: **which browser store** keeps them (OPFS through a sync handle, OPFS through `createWritable`,
IndexedDB, Cache Storage), and **may the cache be turned on**, and with what left on the device. The run was
pre-registered with a rule; the rule found no store that passes (§9, §10.2), so the rule hands the choice to the owner
(§8.5 rule 3). What stays on a device is a matter of policy and law, not a measurement (inventory row 3).

## 2 · The recommendation, and the owner's yes or no

**Keep the cache off. Queue one more interleaved cloud run of the two OPFS stores (§10.4, items 1, 3 and 4, plus the
unjudged-round rule below), then the phone's P2 and P1, before any store is chosen.** P3, the phone's third test
("the other survivors, only those that pass the cloud cells: their P1 and P2", §6), has no store to run on, since none
passed (§10.2); it waits on §10.4's run (named 2026-11-25, PAGES-PASS, `README.md` §Review's nit).

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | Queue §10.4's run, narrowed to items 1 (PSS by process, a PSS VOID rule), 3 (T's per-index record) and 4 (OPFS-ASYNC's handle a group) | **yes** | one cloud run row in the next queue, by a session that wrote none of §1–§10 | the store unchosen; every PSS failure at 512² stands at a margin the rig cannot resolve (§10.2) |
| 2 | Drop §10.4's items 2 (IndexedDB `value=buffer`) and 5 (Cache Storage's Firefox K and T) | **yes** | less host time. Both stores already lose cells to their own API's floor on both engines (§10.3), so the two items can trace causes but cannot change which store passes (**derived**) | both run too, as written |
| 3 | An L cell with a round whose `none` errored is VOID, unless its period is rerun whole (BRIEF-WED item 13) | **yes** | one line in §10.4 before its run | the rig's current reading: such a round judges no arm, and the share is taken over the judged rounds (`lab/cache-arms/cells.mjs` `lBars`) |
| 4 | `frame-memory-ownership.md`'s questions 3 and 4 are answered as that file prints them: the window stays 256 MiB of RAM a tab; no budget of ours, the least recently opened series evicted only when the store refuses, never a series open in a tab | **yes** | the contradiction (`design.md` §Open, contradiction 2) closes; both lines lose the "proposed" of `claude/opfs-multigb` `07ffd873` | both stay proposed; the next run still uses both as its rig (§8.2's 256 MiB ring; E's sequence) |
| 5 | The cache keeps nothing on a device until a deployment sets a policy (option F of `what-the-cache-leaves-on-a-device.md`), its defaults by device kind as that file recommends | **yes, as the frame; nothing built now** | the shape the cache is turned on in, later | the policy question returns when the cache is turned on |
| 6 | Turn the cache on now | **no** | — | the cache off, as today |

## 3 · The options

Every number **measured** unless labelled; one 4-vCPU cloud container, medians, from §9 recomputed cell for cell by
§10.1. Bars are §8.3's. Full table: §9.

| store | Chromium 153 | Firefox 159 | private window (P) | its losses: whose (§10.3) |
| --- | --- | --- | --- | --- |
| **OPFS-SYNC**: one packed file a series, one sync handle, written from the slot | W 2 422 / 2 535 MB/s at S2 / S3; miss 33 / 33 ms (idle), 33 / 34 (busy); reopen S3 648 ms warm. Fails L's PSS bar at every size and B; Q refused at open; **T 2 of 4 rounds: 3 re-reads not exact** | W 1 844 / 1 635; miss 34 / 65 ms; reopen S3 697. Fails **only** L's PSS bar at 512², its median round 7 MiB over, its own A/A copy differing by up to 23 MiB; T VOID (mutant not caught); E, Q not run | Chromium: a store, 32/32 exact. Firefox: **no store** (`SecurityError`) | PSS: open. Q: the option's on the override lever. T: open, no row shows a wrong frame painted |
| **OPFS-ASYNC**: a file per group, `createWritable` | W 493 / 480; miss 33 / 33 (idle), 33 / 50 (busy); reopen S3 749. Fails L's PSS bar at 512² (1× and 4×) and B's (3 of 6) **only** | W 704 / 813; miss 34 / 68; reopen S3 916. Fails L's PSS at 512² and reopen at 512² (4.6 ms a frame against 3.0) | as OPFS-SYNC | PSS: open. Firefox reopen: the build's (a handle opened per frame) |
| **IndexedDB**: a `Blob` a frame, one transaction in flight | W 254 / 270; miss busy 50 / 80 fail; PSS +1.2 GiB at every size | W 234 / 238; miss 89 / 152 fail; reopen S3 3 697 fail | **a store on both**, exact | Firefox reads: the option's (the floor alone, 66.3 ms at S2, is over the 63.7 ms bar). Chromium busy reads: the option's (a read waits behind the write in flight). Chromium PSS: the build's (**theory**: a `Blob` held per frame) |
| **Cache Storage**: a `Cache` a series, a response a frame | W 565 / 554; miss idle 58 fail at S2, busy 74 / 105 fail; reopen S3 2 128 fail | W 331 / 319; miss 101 / 169 fail; K 2 of 4 errored; T 4 of 4 timed out | **a store on both**, exact | reads: the option's on both (floor plus the shared path at or over the bar). K, T, Firefox PSS: open |
| **none** (memory only) | the control; nothing survives the tab | the same | the same | out as a cache: every reopen fetches and decodes again (§2) |

**Each engine's candidate after the run** (**derived** from §10.2–§10.3, not a verdict): on **Firefox**, OPFS-SYNC
(one failed bar, inside the A/A noise); OPFS-ASYNC too if item 4 lands. On **Chromium**, OPFS-ASYNC (PSS bars only);
OPFS-SYNC also needs Q, whose refusal at open §10.3 calls the option's on the override lever, and T traced. On
**WebKit**, none judged.

## 4 · Where it holds

**Fixtures and limits.** One 4-vCPU, 16 GiB cloud container, no GPU (SwiftShader); Chromium 153.0.8010.12 headless;
Firefox 159.0 on Xvfb; synthetic 16-bit frames at 512², 2560 × 3328 (17.0 MB) and 3328 × 4096 (27.3 MB); feeders,
not decoders, so a pass is an upper bound on a phone (§8.4); a warm page cache (a *cold* reopen is a new browser
process, not the disk); the reopen's fresh fill F is M1's measured number, not rerun (§8.8 5). Saturated, so
claiming nothing: Chromium 3328 × 4096 at 4× CPU throttle; Firefox 2560 × 3328 and 3328 × 4096 at 4× (§9, corrected
by §10.1). Every limit of these is in the list below.

**Engines.** Chromium and Firefox measured. **WebKit: nothing measured.** WebKitGTK 2.52.6 has no `SharedArrayBuffer`
and no OPFS on this host, so every cell is *not run* (§9). **Theory** (§8.3, untested): under a busy page, OPFS-SYNC
and Cache Storage pass on WebKit, OPFS-ASYNC and IndexedDB fail, because every call of those two waits on the page's
main thread. B on WebKit is owed before any store is adopted there (§5).

**Phones** (**derived**, `device-model.md` §4–§5, reviewed in PR 414). A fill of `dbts_b1` asks the store to write
85–190 MB/s on an entry phone, 129–415 in the middle band and 355–516 at the top. The platform promises much less
(**source**, Android CDD as quoted there): "[8.2/H-0-1] MUST ensure a sequential write performance of at least 5
MB/s" on every handheld, and "[8.2/H-1-1] … at least 150 MB/s" for media performance class V. A UFS 4.0 part is
rated "2,800 MB/s" write (**source**, the part alone). So a phone at the floor cannot take a fill's writes at any
class, a class-V phone at its floor only the slow end of the middle band, and a flagship with ×5–8 to spare. None of
this has a device measurement yet. Cell 5 of the 11-21 round (P2, P1) was not run: "no cache arms in the runner; the
cache stays off" (PHONE-RUN-OWNER's status file).

**The predictions against the run** (§9, *Against the predictions*). Held: L's shown frame on time for every arm at
1×; OPFS-SYNC the fastest writer; Firefox's OPFS without a private-window store. Missed: **PSS, which no prediction
priced, fails every arm at 512² on both engines**; T on Chromium's OPFS-SYNC, unpredicted; IndexedDB and Cache Storage,
"at risk at S3", passed it on Chromium and failed at S2 as well on Firefox; Cache Storage's busy read, predicted at
"up to one put", was +16 / +22 ms and failed; OPFS-ASYNC's "Chromium S1 marginal" did not happen (that cell is VOID).

**Where the link, not the decode, binds** (2026-11-25, PAGES-PASS): no link enters which store keeps decoded frames;
a store's writes, reads and reopens are the device's, and every cell ran on one host with no link. A link enters only
what the cache saves: a reopen that hits the store fetches nothing, so the cache's worth is largest where the link
binds, on LTE, a far stream, LOSS-like links and public Wi-Fi below ~83 Mbit/s for `dbts_b1` on the round's phone,
and C1's exact frame on every link (**derived**, [`delivery-per-link.md`](delivery-per-link.md) §4); that saving is
not measured here (**theory**). That the wire binds is untested: on the one phone measured, the exact series filled
faster than the view in 15 of 15 rounds, median 0.705 (**measured**, [`README.md`](README.md) §Premises item 1). No
transport row is lowered by the decode-bound phone.

**Each limitation, and what found it** (2026-11-25, PAGES-PASS):

* One 4-vCPU cloud container, no GPU; Chromium 153 headless, Firefox 159 on Xvfb. Found by CACHE-RUN's fixtures line.
* Synthetic 16-bit frames, fed, not decoded, so a pass is an upper bound on a phone. Found by CACHE-RUN and §8.4.
* A warm page cache: a *cold* reopen is a new browser process, not the disk. Found by CACHE-RUN's fixtures line.
* The reopen's fresh fill F is M1's measured number, not rerun. Found by CACHE-RUN ("O's F from M1"), §8.8 5.
* Saturated, so nothing claimed: Chromium 3328 × 4096 at 4×, Firefox 2560 × 3328 and 3328 × 4096 at 4×. Found by
  CACHE-RUN (Chromium S3 4×) and CACHE-VERDICT-REVIEW's correction (Firefox S2 and S3 at 4×).
* L's PSS bar is finer than the rig resolves: OPFS-SYNC's Firefox failure is 7 MiB in a cell whose A/A copy differs
  by up to 23 MiB. Found by CACHE-VERDICT-REVIEW.
* T on Chromium's OPFS-SYNC: 3 re-reads not exact over 4 rounds; `verify()` lumps a failed re-read with a SHA
  mismatch, so no row shows a wrong frame painted; a probe did not reproduce it; cause open. Found by CACHE-RUN; the
  lumping and the probe by CACHE-VERDICT-REVIEW.
* VOID cells: Chromium W at S1 (A/A 0.890); Firefox T for OPFS-SYNC and IndexedDB (mutant not caught). Found by
  CACHE-RUN.
* Not run: Firefox E and Q (Gecko's quota lever does not hold). Found by CACHE-RUN.
* Cache Storage's Firefox K (2 of 4 errored) and T (4 of 4 timed out), cause open. Found by CACHE-RUN.
* OPFS's ~100 MiB on Chromium, open; IndexedDB's ~1.2 GiB on Chromium the build's by **theory** only. Found by
  CACHE-VERDICT-REVIEW.
* WebKit: nothing measured (WebKitGTK 2.52.6 has no `SharedArrayBuffer`, no OPFS); its §8.3 prediction untested.
  Found by CACHE-RUN (`webkit-probe.mjs`).
* No Safari. Found by CACHE-RUN's fixtures line.
* No phone: cell 5 of the 11-21 round (P2, P1) not run. Found by PHONE-RUN-OWNER ("no cache arms in the runner").
* Phones' write rates are **derived** from the device model, not measured. Found by the device model
  (`claude/device-theory`, `device-model.md` §4–§5, PR 414, reviewed and fixed).
* No breast ultrasound cine. Found by CACHE-PAGE's fixtures line.
* The unjudged-round rule moves no verdict of this run; `none` rounds were first counted 66, then 72. Found by
  CACHE-PAGE (BRIEF-WED item 13); the count by DECISION-PAGES-REVIEW m1.
* Encryption's 64–179 ms decrypt is measured on a saturated host. Found by `what-the-cache-leaves-on-a-device.md`.
* The predictions' misses (PSS unpriced, T, IndexedDB and Cache Storage at S2, Cache Storage's busy read). Found by
  §9's *Against the predictions* (CACHE-RUN).

## 5 · The mechanism

A store passes when its writes keep up with the fill off the paint's thread, a miss reads and re-checks a frame within
one decode plus one display period, and a reopen beats a fetch. The OPFS stores read a frame straight into shared
memory, so a miss costs the read plus the shared path (~33 ms at S2 on both engines). IndexedDB and Cache Storage hand
back a new buffer, copied in, and on Firefox their API's floor alone (66–93 ms) is over the bar. That loss belongs to
the option, not the build. What holds back the OPFS stores is memory measured as the PSS of the whole browser process
tree. At 512² the bar's slack is 64 MiB (frames of 0.5 MB). Firefox's `none` grows ~170 MiB on its own, and the A/A
pair differs by up to 16–101 MiB (§10.2). The bar is finer than the rig can measure. Chromium's ~100 MiB for OPFS-SYNC
does not scale with the frame, so it looks like a fixed cost of some process. Item 1 measures PSS by process to find
which one.

**Why items 2 and 5 cannot change the choice** (**derived**). The rule needs every bar in every cell (§8.5 1).
IndexedDB fails R-busy on Chromium and every read on Firefox by its own API, and Cache Storage fails reads on both.
Whatever item 2 shows about IndexedDB's PSS, and item 5 about Cache Storage's errors, neither store can then pass.

**Why an unjudged round should VOID the cell** (decision 3). A cell's rounds are one whole Williams period, so every
arm follows every other equally often (§8.2). A round dropped from the judgement unbalances the period for every arm.
"≥ 75 % of rounds" is also defined on the whole period (≥ 5 of 6, 9 of 12). **Measured here:** 0 of 72 `none` rounds
(36 an engine) errored in the counted L and B cells (`rows/<engine>/{L,B}-*.jsonl`; 0 of 96 with the two
`L-*-4x-none` cells); only the L cells' summaries carry `unjudged`, empty in each, and B's rows have no summary
(corrected 2026-11-23, `README.md` §Review m1), so the rule moves no verdict of this run. It binds the next one.

## 6 · What would change the recommendation

* **Item 1 shows the PSS growth to be a fixed per-origin cost of the engine's storage process**, and the bar prices
  it as a constant. Then OPFS-SYNC passes on Firefox, and OPFS-ASYNC very likely on Chromium: the recommendation
  becomes "turn on OPFS, per engine, after P2 and P1".
* **Item 3 finds a SHA-256 mismatch after a passing XXH3** in a reading tab. That is a correctness defect, and it
  blocks OPFS-SYNC until traced (§10.4 3).
* **The phone's P1 and P2** (`claude/phone-protocol:docs/phone-rows/next-round.md` §4, cell 5). If the cold read and
  re-check of a 17 MB frame comes in over ~45 ms (the measured decode), decoded samples stop winning on reopen, and
  only the no-re-decoding rule keeps them. If the sustained write falls short of the fill on a mid-band phone, the
  cache must be allowed to lag the fill.
* **WebKit's B on a real Safari**: if OPFS-SYNC fails it, no store is chosen for iOS.

## 7 · What it would reopen

Nothing, as recommended. It keeps "an OPFS cache for both web clients, no re-decoding" (2026-10-10) and "the cache
off until the owner decides". Three of the options would reopen something. Choosing IndexedDB or Cache Storage as
the store would reopen the first. Encrypting the cache (options B1, B3 of `what-the-cache-leaves-on-a-device.md`)
may make a reopen of coded bytes faster than one of decoded samples, because decrypting a 3328 × 4096 frame (64–179
ms, **measured** on a saturated host) costs about a decode. That would put the no-re-decoding rule in question.
Keeping nothing after a crash on a personal phone (option E + B1) means no reuse across sessions there.

## 8 · Rows and links

* Client queue rows: CACHE-PLAN, CACHE-DESIGN, the four CACHE-ADVOCATE rows, CACHE-PROTOCOL, the CACHE-BUILD rows,
  their review and three fix rounds (PRs 385, 394), CACHE-RUN (2026-11-18/19), CACHE-VERDICT-REVIEW (2026-11-19);
  status files `claude/work-ledger:docs/queue/<ROW>.md`.
* The plan, protocol, results and verdict review: `claude/cache-plan:docs/client/evidence/cache-plan.md` §1–§10.
* The rows, rig and bars: `claude/cache-arms:lab/cache-arms/` (`rows/chromium/`, `rows/firefox/`,
  `rows/webkitgtk/probe.jsonl`, `cells.mjs`, `results.py`, `README.md`).
* The survey and the store as built: `claude/docs-client:docs/client/evidence/cache-options.md`, `cache-in-opfs.md`,
  `cache-io-thread.md`; frame memory: `frame-memory-ownership.md` (questions 3, 4); what stays on a device:
  `what-the-cache-leaves-on-a-device.md`; open items: `docs/client/design.md` §Open.
* Phones: `claude/device-theory:docs/decode/mobile/device-model.md` §3–§5 (PR 414, reviewed and fixed); the round:
  `claude/phone-run:docs/phone-rows/SATURDAY.md` (PR 409), cell 5 not run.
* The question as listed: `claude/reviews-2026-11-18:docs/reviews-2026-11-18.md` §3, item 13.
