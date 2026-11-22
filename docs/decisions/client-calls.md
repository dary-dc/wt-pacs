# The client's smaller calls

Written 2026-11-22 by row CLIENT-CALLS-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none
of the rows behind it, from pushed results only; nothing run but `git` reads. Inputs at `origin/claude/unified`
`4a2b4277` unless named: `docs/client/design.md` §Open (*Settings awaiting the owner*, contradiction 4, *Elsewhere*);
the evidence files linked per section; `docs/CLIENTS.md` §Reading a frame whole and §Open; `docs/merge-readiness.md`
H3; `claude/reviews-2026-11-18:docs/reviews-2026-11-18.md` §3 item 14 (B14); `claude/demo-simplify:docs/lines/proposals.md`
§Simplify (OPT-SIMPLIFY's S4, S5); the status files DEMO-CHECK-MUTANTS and WORKER-FLAKE; PRs 418 and 419.
The program's inventory row 14 lists nine items; each has its section below, in the page's form, shortened.

## 1 · The question

Nine small calls the client owes, none large enough for a page of its own: a memory setting, a reader option and a
defect behind it, how dav1d is fetched, a wake before the exact ask, two painters, two check fixes and two screen
simplifications. Each changes a default, merges a PR or queues a row, so each is the owner's.

## 2 · The recommendations, and the owner's yes or no

| # | item | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | `pixels: "transfer"` (§3.1) | **stays off; cell T queued** as a cloud run in phase 2 (amendment 28 rule 2; no product code) | one run row; the default changes only if T and W both hold, W not runnable yet | the setting built, never run |
| 2 | `readMin`'s cut-stream fix (§3.2) | **yes: restore it**, by a row like SELINUX-BUILD-RESTORE; `readMin` stays **off** by default | `4019518a`'s two hunks back on `claude/unified` with their test, the docs corrected in place | a known defect in an opt-in path, and three docs that say the fix is "not merged" while history says it was |
| 3 | dav1d fetched on need, form (c) (§3.3) | **yes, provisionally**: queue rule (3)'s registered re-read (cloud, no product code), then build (c) as a draft PR if it holds | ~13 lines of `av1.js`, `head.js`, `viewer.js`, reviewed; −0.24 to −0.64 MB a page WebCodecs serves | form (a): every AV1 page fetches dav1d three times |
| 4 | a wake before the exact ask (§3.4) | **stops here: a phone row decides** | — | — |
| 5 | the WebGL painter on a GPU (§3.5) | **stops here: a GPU decides** | — | — |
| 6 | a WebGPU painter (B14) (§3.6) | **no: not designed now**; stops at the GPU and the phone | — | a design row with nothing to measure it on |
| 7 | the two `demo-check.mjs` mutants, PR 418 (§3.7) | **yes, after a review**: one Opus review row for 418 and 419 together in phase 2, then a sync row merges them (amendment 28 rule 1) | the check kills B1; the owner's word is not needed for the merge | the check misses a group asked ahead in the page view |
| 8 | the worker flake, PR 419 (§3.8) | **yes, after the same review** | the worker-view check stops failing ~1 run in 100 | a check that fails ~1 % of worker runs on a correct product |
| 9 | S4 and S5 of OPT-SIMPLIFY (§3.9) | S4 **done** (`7d93e0305`, pinned by `screen.test.mjs`): nothing to decide; S5 **yes**: one small Opus row moves `client` and `view` off the reader's status line into `?overlay=1` | two fields fewer on the reader's line; `check.mjs`'s two asserts move with them | two terms on every frame that no reader can act on |

**How they serve the value statement** (amendment 27 item 7). Items 3 and 9 serve "a fast first picture" and a
reader's screen: (c) took 128 ms off the first picture on the rig, and S5 keeps the reader's line to what they read.
Item 2 serves "every frame … checked": an opt-in path that drops a cut frame unnamed contradicts it, even off by
default. Items 7 and 8 make the check that guards the demo trustworthy. Items 1, 4–6 wait on hardware or on a run;
none is needed for the evaluation release.

## 3 · The items

### 3.1 `pixels: "transfer"`: a transferred buffer per frame

**Options.** `shared` (today, the default) or `transfer` (each decoder transfers an `ArrayBuffer` to the consumer).
**Numbers:** a fill's growth **predicted** 600–800 MiB on Chromium and 650–1 100 on Firefox under a 256 MiB window,
against 2.6–3.2 GiB shared (**measured** by `claude/frame-memory`'s M5); costs predicted nil (**theory**). Built and
mutated, **never run**: cell T (costs) runs on this build; cell W (the claim) needs the store's window under a want,
which is not built, and M5's rig carried over ([`transferred-buffer-per-frame.md`](../client/evidence/transferred-buffer-per-frame.md)).
**Where it holds:** nothing measured. The claim is about large frames: DBT's 80 × 3328×4096 fixture. A US clip's
frames are small (8-bit, often under 1 Mpx), so its growth is bounded by the window whichever buffer is used
(**theory**, not tested). **Mechanism:** V8 counts a `SharedArrayBuffer` as 0 bytes toward collection, so a frame let
go is freed late; a transferred buffer is counted at its length. **Would change it:** T failing rejects `transfer`
whatever W says; T and W holding adopt it and drop the slot ring (c). **Reopens:** nothing.

### 3.2 `readMin`'s cut-stream fix (contradiction 4)

**Finding (this row, from `git`).** The fix (`4019518a`, 2026-10-22: "readMin: name a cut whose end is queued
before the read") **was merged into `claude/unified`'s history** at `82db21c4` (2026-11-15, "Merge
claude/readmin-cut-stream at 4019518ad0 (PR 136)"), **and lost from its tree** by `dd681539` (2026-11-15, "Merge
claude/merge-a-server at 1597e37c60 (stage B2)"). That merge's message says: "the B2 tree outside server/, docs/ and
lab/ is the tip's: … client/contract/dispatch-rig.ts, … client/transport/ts/frame-session.ts". `1597e37c` carries the
fix and its rig case (`dispatch-rig.ts:666`); `dd681539` and the tip `4a2b4277` carry neither (`readInto` has no
`try`). The same merge lists `client/decode/wasm/build/build.sh`, the file SELINUX-BUILD-RESTORE restores; that row
names the merge by `git log -S`, so the two may share a cause. So design.md's contradiction 4, `CLIENTS.md` §Reading a
frame whole and §Open, and `merge-readiness.md` H3 are right about the code and wrong about the history; corrected in
place by the restore row.

**Options** for the default, from `CLIENTS.md` §Reading a frame whole, **measured** on a cloud host: 16 KB ties
frame 0 (+2.6 and +8.4 ms, within noise), takes 97 ms of downloader CPU off a fill at 4× throttle and 38 MB off the
renderer's peak; its cost is a re-dial of any session slower than 16 KB per `stallMs` (< 44 kbit/s, **derived**).
Off (today) costs nothing. **Recommended:** restore the fix (a failing test first: the rig case comes back with it),
keep `readMin` off. **Where it holds:** loopback and a relay; no phone, no radio. The value statement's "a phone over
unreliable wireless" is where sub-44 kbit/s stretches occur, and no row measured how often. **Would change it:** a
link-profile row showing a phone never stays under 44 kbit/s for `stallMs`. **Reopens:** nothing.

### 3.3 dav1d fetched on need, P6 (c)

**Options and numbers** (**measured**, 2026-11-12, 5 of 9 registered rounds, 507 rows;
[`dav1d-fetched-on-need.md`](../client/evidence/dav1d-fetched-on-need.md)): dav1d is 636 484 B raw, 243 779 B gzipped.

| form | WebCodecs accepts: first picture vs (a) | WebCodecs refused: first picture vs (a) | fill |
| --- | ---: | ---: | ---: |
| (a) today: preload, every worker fetches | — | — | — |
| (a′) the A/A | +1.0 ms | −12 ms | — |
| (b) on refusal | −104 ms | **+192.5 ms, fails** (11 of 12 cells over 50 ms) | 0.975× |
| (c) probe at start | **−128.5 ms** | **−128 ms**, 0 of 12 over | 0.976× |

Rule (3) (a failure mid-group fails the same frames as (a)) is **not met on its letter**: (a) itself varies by one to
five frames between its own rounds. **Recommended:** the registered re-read of rule (3) (outcome sets against an A/A
pair, 9 rounds) as a cloud row, then (c) built if it holds. **Where it holds:** three DBT volumes of one dataset, one
4-core host, headless Chromium; the static host's TCP did not compete with the fill, which **understates** (c)'s gain.
**No phone's WebCodecs AV1 probed.** Carried by theory: on WebKit, which takes 8-bit 4:2:0 only, every grey DBT
frame goes to dav1d, and (c) fetches it at once; a US clip coded as 8-bit 4:2:0 colour is the one payload kind the file records
WebKit taking (stated there without a quote: the source is owed), so it is where (c)'s saving would reach WebKit. Not measured.
**Would change it:** rule (3) failing on the re-read. **Reopens:** nothing (WebCodecs first, dav1d the fallback, kept).

### 3.4 A wake on the exact session before *Lossless* asks

The plumbing holds on the relay's modelled radio: −103 and −105 ms (**measured**, medians of 7, `dbts_a1`, `dbts_c1`);
on a phone **expected** 0–100 ms (**theory**), not measured
([`wake-before-lossless.md`](../client/evidence/wake-before-lossless.md)). Its evidence is a phone on cellular, 20
dwells an arm, adopt at ≥ 30 ms: **a phone row; it stops here.** Nothing built on the product page.

### 3.5 The WebGL painter on a real GPU

Every paint number past `lab/paint-floor`'s (0.34 ms a 512² paint, **measured**, `docs/av1/queue.md`) was taken on
SwiftShader or llvmpipe; exactness is shown on software only (the viewer check; native's M1 on lavapipe). Its evidence
is a GPU (the owner's machine): **it stops here.**

### 3.6 A WebGPU painter (B14)

Listed in `reviews-2026-11-18.md` §3 item 14 as "an option, not a plan". No source here says WebGPU paints a grey
frame more exactly or faster than WebGL2; its decode use (M20, HTJ2K in WebGPU compute) is a phone row on PR 397.
**Recommended: no design row now.** Its evidence is a GPU and a phone: **it stops here.**

### 3.7 The two `demo-check.mjs` mutants (PR 418)

**Measured** (3 runs a cell, predictions written first; `dbts_a1-q8-g8-cut`): the old check killed 2 of 4 cells, the
new 3 of 4; B1 (`show()` also asks `want + 8` on a miss) now killed 3 of 3; A survives in the page view, **equivalent**
there (dead code under `--view page`), killed in the worker view. Gate `--quick` OK. **No review row was queued**
(the status file says so), so amendment 28 rule 1 cannot merge it yet. **Recommended:** one review row for 418 and
419, then the sync row merges them; they touch the same lines: whichever goes second keeps 418's `groupsOf` and 419's
read after the jump (PR 419's body). **Where it holds:** one series, one host, Chromium on SwiftShader, loopback; a
check of the demo, not of the product, so it carries to US and DBT series alike by construction (it counts groups).

### 3.8 The worker flake (PR 419)

**Measured:** 1 failure in 100 worker runs of `dbts_a1-q8-g16-cut` (95 % interval 0.03–5.4 %), matching
CLEAN-PRODUCT's 1 in 40. The cause is the check: the view worker posts progress at most every 100 ms
(`PROGRESS_MS`), and the check read the count ~100 ms after the jump. The fix waits for the count, bounded 2 s;
mutants: fixed 0 of 7 fail, wait removed 4 of 5 worker runs, 20 ms wait 2 of 3, a product that never posts 2 of 2.
**Recommended:** merge after the review of §3.7. **Where it holds:** as §3.7.

### 3.9 S4 and S5 of OPT-SIMPLIFY

**S4** (the grey *unchecked* mark beside *Optimal quality*) is **done**: `7d93e0305` (2026-11-11, "viewer: a labelled
frame without a digest carries no unchecked mark beside its label (REVIEW-BLIND C1)"), pinned by
`client/viewer/screen.test.mjs:14`. Nothing to decide. **S5** is open: the tip's status line still opens with
`client ${transport.client}` and `view ${where}` (`client/viewer/viewer.js:124-125`), choices no reader acts on.
**Recommended:** move both to `?overlay=1`, `check.mjs`'s asserts with them, a failing test first; ~10 lines
(**theory**, OPT-SIMPLIFY's estimate). **Would change it:** VIEW-PAGE retiring a view (then `view` goes entirely).

## 4 · Where it holds (all items)

Fixtures: 19 DBT volumes of one dataset, three timed (`dbts_a1`, `dbts_b1`, `dbts_c1`); here only those three, and
§3.7–§3.8 one series each. No breast ultrasound cine: every US statement above is **theory**, labelled, untested.
4-core cloud hosts without a GPU, software WebCodecs, headless Chromium; loopback, a userspace relay or netem, not a
radio. No phone, no GPU, no WebKit in any cell here.

## 5 · What it would reopen

Nothing among the decided approaches. §3.3 keeps WebCodecs first and dav1d the fallback; §3.2 keeps the default off.

## 6 · Rows and links

DEMO-CHECK-MUTANTS (PR 418, `claude/demo-check-mutants` `7567248b`), WORKER-FLAKE (PR 419, `claude/worker-flake`
`5ca31b35`, `docs/reviews/worker-flake.md`); OPT-SIMPLIFY (`claude/demo-simplify` `d70ccb9f`); P6 (`claude/dav1d-lazy`,
raw rows `claude/proposals:lab/proposals/rows/`); P3 (`claude/proposals:lab/proposals/rows/p3.jsonl`, `r3.jsonl`);
`claude/readmin-cut-stream` `4019518a`; merges `82db21c4` and `dd681539` on `claude/unified`; SELINUX-BUILD-RESTORE
(the same merge's file list).

**Rows this page asks for in phase 2** (for PHASE2-PLAN): READMIN-RESTORE and its review; a review of PRs 418 and
419; P6-RULE3 (cloud, the re-read), then P6-C-BUILD and its review if it holds; TRANSFER-T (cloud, cell T); S5-STATUS
and its review. None needs the owner's word to run but the builds' merges, which amendment 28 rule 1 makes after a
review.
