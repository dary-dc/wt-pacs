# The unified demo path: design proposals

*Written 2026-11-12 (row FABLE-DESIGN) from a read of `claude/demo-fixes-2` at `18d2d1ff`, the unified state: its
`docs/lines/client.md`, `docs/lines/optimal-quality.md`, `docs/adr/frame-path.md` and `client/`. **Theory only:
nothing here is measured, built or changed.** Every expected effect is **an assumption**, a band derived from the
numbers it names. File and line references are to that commit.*

Judged against the direction every line shares ([`../lines/README.md`](../lines/README.md)): most sessions at the
lowest cost, low latency and fast fills, for mobile on lossy wireless, the exact frame bit-exact, breast imaging
first; and understandable by the people who steer it. No decision recorded in `docs/lines/` or in the queue's
*Decided approaches* is reopened; §5 says where two of them cost, with the evidence.

**Labels.** **(S)** an official source, quoted, listed in §7; **(R)** this repository's record, with its place;
**(D)** derived here from those.

**Fixtures, and their limits.** Every number quoted comes from three tomosynthesis volumes of one dataset: `dbts_a1`
(56 × 1142×1785, 12 bits), `dbts_b1` (50 × 2560×3328, 10 bits), `dbts_c1` (69 × 976×2513, 12 bits)
(R, `docs/FIXTURES.md`). No mammogram, no breast ultrasound cine, no other modality. The timings quoted were taken on
4-core cloud hosts without a GPU, headless Chromium, through a userspace relay and not a radio. The server was read
less deeply than the client. The phone run's rows (`claude/phone-rows`) were not read.

| # | proposal | serves | expected effect (assumption) | size |
| --- | --- | --- | --- | --- |
| 1 | a Lossless frame, once fetched, is held | Lossless on a lossy link; one state to explain | a return to a frame asked before: one paint in place of 0.7–6.7 s and 1.0–2.2 MB | ~40 lines, client |
| 2 | the dial waits for nothing it does not need | the first picture, every open | one to two round trips sooner: 60–120 ms at 30 ms each way | ~15 lines, client |
| 3 | the decided cache admits the optimal-quality frame through its reconstruction digest | reopening a study; a bound on memory | a reopen without the wire, if the read beats the fill (§3: not known) | no code of its own |
| 4 | the last pass over a 10-bit frame is a row copy | the fill where the decode bounds it | that pass 0.2–0.6× of its time; the fill by its share, not known | ~15 lines, client |

## 1. A Lossless frame, once fetched, is held

**The problem.** The controller keeps one exact frame, `#exact = { i, frame?, failed? }`, and drops it whenever the
reader is somewhere else (`client/view/controller.js`):

* a step away clears it: `if (this.#exact?.i !== this.current) this.#exact = null` (line 144);
* a frame that lands after the reader left is thrown away: `if (this.#exact !== e) return` (line 205);
* *back to optimal quality* clears it (`showLossy`, line 213), and the page calls that for a second press while the
  label says *fetching lossless…* (`client/viewer/viewer.js` line 196), so the fetch in flight is paid and discarded.

So every return to a frame costs a whole exact frame again. What one costs (R): 1.02, 1.21 and 2.15 MB on average
(`dbts_c1`, `dbts_a1`, `dbts_b1`; `docs/av1/payload-format.md` tables); from the key to *Lossless*, medians of 5,
0.7–1.2 s on a clean 20 Mbit/s link at 30 ms each way and 2.5–6.7 s at 1 % loss under `cubic-restart`
(`claude/proposals:docs/lines/proposals.md` §P1, *Measured*); 2.8–5.9 s at 40 ms and 2 %, 16–17 s with jitter, one
run a cell (`docs/reviews/demo-tests-mobile.md` on the tip). A reader comparing a
finding across neighbouring slices, stepping away and back, pays that each time. A wait of seconds also invites the
second press, which discards the fetch.

**The change.** The exact series gets a frame store of its own: the same `FrameStore` class, with a budget of K
frames, farthest from the current frame let go first (the class already does both). `showExact` asks the exact
source only for a frame that store does not hold. A frame that arrives is put there whether or not the reader has
moved. `#exact` shrinks to *the reader asked Lossless at i*. The label is read from the store: held and checked
`true` → *Lossless*; asked → *fetching lossless…*; failed → *Lossless check failed*. Only a frame checked `true` is
put, so the clinical invariant keeps its one place. Whether Lossless then stays on across steps is not proposed
here: it is `optimal-quality.md` §Open 8's reading mode, the readers' call; with the store it becomes a policy of
one line instead of a new mechanism.

**The mechanism.** No standard is involved. The exact frames are the one part of a pair the decided cache already
admits (checked `true`, digests in the metadata; `docs/adr/frame-path.md` §5), so under the view worker the same
store gives them the OPFS cache with no new rule (§3).

**Expected effect (assumption).** A return to a frame asked before in the session: one paint, in place of the
0.7–6.7 s and 1.0–2.2 MB above. A fetch overtaken by a step or a second press is kept, not lost. How often readers
return is **not known**: nothing in the repository counts it, so the total effect is not claimed.

**The cost.** Memory: K decoded exact frames, 4.1, 17.0 and 4.9 MB each (D: width × height × 2 B). About 40 lines in
`controller.js`; `quality()` and its tests move from one slot to the store. K is a constant until a device sets it.

**What decides it.** (1) Correctness, a node test: *Lossless at i, step, back, Lossless* makes one ask, not two; a
frame landing after the step is held; a failed check is never held; each mutated. (2) The total effect: the share of
Lossless presses that land on a frame already asked in the same session, and the count of fetches discarded, from
reader sessions (the phone runs' beacon, or the telemetry proposal of PR 370 if the owner takes it). Adopt if (1)
passes and no label test changes its meaning; (2) sizes K and says what the change is worth.

## 2. The dial waits for nothing it does not need

**The problem.** On an optimal-quality series the page awaits two things, one after the other, before it dials
(`client/viewer/viewer.js`):

* the pair: `const pair = await …` (lines 43–53) fetches the exact series' metadata and its transport file, then
  runs `checkPair`. The page cannot ask for these earlier: the series' own metadata names the exact series.
* the decoder manifest: `await built("dav1d")` (line 138) fetches `wasm/build/manifest.sha256`, which no preload
  names (`client/viewer/index.html`, `head.js`).

The dial needs neither answer. It needs the series' metadata and transport file, which `head.js` already fetches
side by side. The pair is used first by `connectExact`, after the session is up (line 177). The manifest's digests
go to the decoder workers at their start, but its address is fixed, so nothing makes it wait for the metadata.

**The change.** The pair's two fetches start when the metadata arrives and are not awaited before `connect`. The
pair check keeps its meaning by gating what it protects: the first paint waits for `checkPair` (so a refused pair
still shows no picture, as today), and the Lossless button appears only after it, as today. The manifest joins the
page's preloads, so its fetch runs beside the metadata's and `built` finds it answered.

**The mechanism.** Each awaited fetch is at least one round trip on the static host's connection. A preload is what
the platform offers for a resource known to be needed: "Specifies that the user agent must preemptively fetch and
cache the target resource for current navigation" (S, HTML §4.6.8, the link types table, `preload`). The first
frame cannot arrive sooner than the dial's own round trips, so a check that takes one round trip finishes before
it.

**Expected effect (assumption).** The first picture one to two round trips sooner on an optimal-quality series, one
on an exact series (the manifest alone): 60–120 ms at the demo link's 30 ms each way (D), against a first picture
of 307–548 ms on loopback (R, `client/README.md` §Optimal quality). More where a segment of either answer is lost;
less on a repeat visit if the manifest is served from the HTTP cache, which was not checked.

**The cost.** About 15 lines; one more ordering to hold in the page's start (the paint's gate on the check), which
needs its own test: a refused pair paints nothing. If `claude/fable-simplify`'s P6 (one start order) is taken, this
belongs in that order rather than beside it.

**What decides it.** First picture from navigation, today's page against the change, interleaved by round, the three
Q 8 series, the 0 % and 1 % cells of the relay at 30 ms each way, with an A/A arm: the withdrawn late-dial proposal
measured this metric's A/A spread at about ±30 ms (R, `proposals.md` §Red team, P5), so the predicted effect is two
to four times the floor at that link and invisible on loopback. Adopt if the median first picture is sooner by at
least one round trip of the cell and no Lossless time is later.

## 3. The decided cache meets the optimal-quality frame through its reconstruction digest

**The problem.** The owner decided an OPFS cache of decoded samples (2026-10-10) and, later, the optimal-quality
series as what every viewer sees (2026-11-09). On the tip the two do not meet:

* an optimal-quality series carries no `digests`, so its frames arrive `unchecked` (`optimal-quality.md`, Contract);
* the cache opens only for a series with digests (`client/view/view-worker.js` line 87) and writes only a frame
  checked `true` (`client/view/store.js` line 112), as `docs/adr/frame-path.md` §5 rules.

So with any writer turned on, the series the product shows by default is never cached, and a reopen pays the whole
fill again. The same gap leaves memory without a bound that works: nobody passes the store a budget
(`store.js` line 30, `Infinity`), and under one, an evicted optimal-quality frame can only come back over the wire,
its whole group with it. Held decoded, the three series are 228, 852 and 338 MB (D: 56 × 4.08, 50 × 17.0,
69 × 4.91 MB). The ADR's open table has the question (*a series without digests: stored and read back `unchecked`,
or decoded again on every open*) as one case among many; since 2026-11-09 it is the product's main case.

**The change.** None of its own. The integrity proposal (PR 368, I1: a digest of the reconstruction, made at
ingest) gives each optimal-quality frame a digest the client can check. With it the frames arrive checked, and the
cache's existing rule admits them unchanged. This proposal is the dependency, stated: **I1 is what the decided cache
needs before it holds anything on the product path**, which is a reason to weigh in I1's decision that its own
write-up does not give.

**The mechanism.** I1's, and its sources are its own (AV1 §7.2 and WebCodecs §7.9, by its red team's reading;
not re-read here). The cache's rules are the ADR's §5.

**Expected effect (assumption).** A reopen that asks the server for nothing. Whether it is *faster* than a fill is
not known, and §5 says why it may not be.

**The cost.** I1's (its hash is about 4 % of a measured decode, R, `proposals.md` §Red team). Disk: the decoded
sizes above.

**What decides it.** With I1 built on a lab branch: a reopen from the cache against a fill from the wire, the cache
harness's reopen cell (R, `docs/adr/frame-path.md` §Proposed: the client cache in OPFS, M1–M4) on the three Q 8
series, interleaved, on the phone and on the relay's 1 % cell; latency to the last frame held. Adopt the admission
if the reopen is no later than the fill in every cell; if it is later on a clean link and sooner on a lossy one,
the result goes to the owner as measured.

## 4. The last pass over a 10-bit frame is a row copy

**The problem.** Every optimal-quality frame decoded through WebCodecs is passed over twice in script after the
decoder: `copyTo` into a new `ArrayBuffer` of `allocationSize()` bytes (`client/decode/av1-webcodecs.js`, `read`),
then `place` (`client/decode/av1-frame.js` line 101), which for each sample reads the output, masks, ORs, subtracts
the offset, writes, and takes the range. For a depth cut, and for any unsigned series of D ≤ 10, there is no split,
no sign and no offset: the output is the luma plane, sample for sample. The first phone run reads the fill as
bounded by the phone, not the wire: "wire time from the path rows is 0.5–1.0 s of a 2.4–3.3 s fill" (R, the queue,
row FILL-SPLIT), so per-frame work in the decoder workers is where the fill's time now is.

**The change.** Where the payload has no split, no colour transform, no sign and offset 0, `place` copies each row
with one `set` of the plane's row, and takes the range in a read-only pass. Nothing else moves.

**The mechanism.** `copyTo` cannot write into the frame's own buffer and so remove the pass altogether: "If layout
is not undefined and its length does not equal numPlanes, throw a TypeError", and "It is invalid to specify planes
that overlap" (S, WebCodecs §9.4.6 and §9.5). A 4:0:0 stream comes back as 4:2:0 (R, `av1-webcodecs.js`, `read`),
so its chroma would have to land inside the frame's buffer, half as much again per held frame. A row copy within
script is the smaller change that keeps the buffer its size.

**Expected effect (assumption).** That pass at 0.2–0.6× of its time: a typed-array `set` between same-type arrays
moves bytes without a per-sample step, and the range pass that remains only reads. Its share of a phone's
per-frame time is **not known**; FILL-SPLIT's reading is what would say whether this is 1 % of the fill or 10 %.

**The cost.** About 15 lines and a second branch in `place`, in the module where exactness is decided for exact AV1
series; the branch must be unreachable for them unless their payload meets the same conditions.

**What decides it.** First FILL-SPLIT's split: if the script passes after the decoder are under 5 % of a frame's
time on the phone, drop this. Otherwise a decode bench of one worker on the three Q 8 series, the two `place`
bodies interleaved by frame, every output hashed equal to today's; then the fill on the phone, interleaved. Adopt if
the fill's median is sooner beyond its A/A spread.

## 5. Where two decisions cost, with the evidence

Not proposals, and neither decision is reopened.

* **Lossless is the whole exact frame** (the residual dropped, 2026-11-09). On a lossy link its time is the link's
  loss-limited rate times 1.0–2.2 MB: 2.5–6.7 s at 1 % loss under `cubic-restart` against 0.7–1.2 s clean (R,
  `proposals.md` §P1), 16–17 s with jitter at 2 % (R, `demo-tests-mobile.md`). The levers already in hand are the
  controller (the owner's call after the phone runs) and HTJ2K matched to the screen (PR 324). §1 does not shorten a
  fetch; it stops paying for the same one twice.
* **No re-decoding, so the cache holds decoded samples** (2026-10-10). The ADR weighed this on exact series, where
  decoded is the lossless ratio larger than coded (`docs/adr/frame-path.md` §4). On an optimal-quality series the
  ratio is 37–55×: 228, 852 and 338 MB decoded against 4.7, 23.2 and 6.2 MB coded (D, from the sizes in
  `proposals.md` §Optimize as corrected). A reopen from the cache reads and hashes 852 MB for `dbts_b1`; a fill
  downloads 23 MB and decodes it, 4.6 s on loopback (R, `client/README.md`). Which is sooner on a phone's flash is
  not measured anywhere; §3's deciding run is the one that would show it.

## 6. Looked at, and not proposed

Each was a candidate from the read and is already answered in the repository:

* *The exact session dialled later, or only on the first Lossless:* withdrawn as inert (`proposals.md` P5); an
  idle session costs the server about 75 KB (R, `docs/adr/transport-idle-sessions.md`).
* *Compiling the decoders' WASM once, streamed, for the engine's code cache:* measured, "the engine's code cache
  does nothing to it" (R, `docs/decode/README.md` §Instantiating by streaming).
* *Hardware AV1 decode:* Chromium's hardware front end refuses 4:0:0 (R, `docs/decode/hardware.md`).
* *A group whose frames predict from its keyframe alone, so a jump decodes two frames:* read in
  `docs/av1/frame-groups.md`.
* *A slider scrub asking every frame it crosses, each ask ending the running fill* (`controller.js` `show`,
  `docs/WIRE.md` §An ask during a fill): the want under `claude/fable-simplify`'s P4 replaces itself at each step,
  and `proposals.md` R2 times the jump during a fill.
* *BBR, tiles, the radio wake, the initial window, dav1d loaded on need, one view, one start order, one cache
  writer:* `proposals.md` and `docs/proposals/simplify-fable.md` (`claude/fable-simplify`), not repeated.

## 7. Sources

* (S) HTML Standard, §4.6.8 Link types, the table's row for `preload`:
  <https://html.spec.whatwg.org/multipage/links.html#linkTypes> (read 2026-11-12).
* (S) WebCodecs, W3C, §9.4.5 `copyTo(destination, options)`: "Asynchronously copies the planes of this frame into
  destination according to options."; §9.4.6 *Compute Layout and Allocation Size*, step 2; §9.5
  `VideoFrameCopyToOptions`, `layout`: <https://www.w3.org/TR/webcodecs/> (read 2026-11-12).
* (R) On `claude/demo-fixes-2` at `18d2d1ff`: `client/view/controller.js`, `client/view/store.js`,
  `client/view/view-worker.js`, `client/viewer/viewer.js`, `client/decode/av1-webcodecs.js`,
  `client/decode/av1-frame.js`, `docs/adr/frame-path.md`, `docs/WIRE.md`, `docs/FIXTURES.md`,
  `docs/reviews/demo-tests-mobile.md`, `docs/adr/transport-idle-sessions.md`. On `claude/proposals` at `b6e4b47d`:
  `docs/lines/proposals.md`. On `claude/work-ledger`: `docs/queue-2026-11-10.md`.
