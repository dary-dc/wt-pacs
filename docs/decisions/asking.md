# What a view asks for

Written 2026-11-22 by row ASK-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none of the
rows behind it, from pushed results only; nothing run but `git` reads. Inputs: `claude/ask-model` `75d4b5849`
(`docs/client/evidence/ask-model.md`, cited below as *the model*, with its section), PR 430's body (§ASK-MODEL-REVIEW,
§ASK-MODEL-FIX, §Re-review), PR 96, [`transport-stack.md`](transport-stack.md) item 2, and at `origin/claude/unified`
`4a2b4277`: [`../client/design.md`](../client/design.md) §Open, the stride ADR, the client's `downloader.js`,
`controller.js` and `view-worker.js`. **Every number on this page is theory, derived or quoted; none of the rule is
measured.** The measured numbers quoted are earlier rows', named where they are used. *Corrected 2026-11-26*
(PAGES-AFTER-RUNS): the rule's hold is now measured, by ASK-CELLS (`claude/ask-cells` `5364c9f44`,
`claude/page-runs` `b38906f58`: `docs/reviews/page-runs.md` §4, §Asking: results, §Verdict review); §2's *Read
against the run* carries it, and every other number stays as labelled.

## 1 · The question

A view of a DBT stack or an ultrasound clip cannot always hold the whole series (one DBT hanging is 5–6 GB decoded,
**derived**, the model §3.3), and the link and the decoder are slower than a reader's scroll on most phones. So the
client must choose which frames to ask for, in what order, and which to let go. It has never been designed (the
owner, 2026-11-02, `design.md` §Open). It is the owner's because it sets the client's design, settles a contradiction
between an accepted ADR and IHE, and decides whether PR 96 and three settings live.

## 2 · The recommendations, and the owner's yes or no

| # | item | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | **The rule** (model §4): one key, a frame's *need time*, orders the want soonest first, lets go the latest-needed held frame over the budget, and bounds what the transport commits | **yes, as the design; its one new behaviour tested before it is built** (tested 2026-11-24, verdicted 2026-11-26: P1 holds, so **behind first as the store's default, a product build row: yes**, provisional: the page view and the exact series only, W = 15, one volume; the dwell state not shown to earn anything; below) | `design.md` §Open's *What a view asks for* becomes a decision; a protocol row (another session) and a run row for P1, P1b, P1c and a corrected P2 (§6), on two lab levers built first: a display that never skips with the target apart from the display's frame, and the hold key. No product code until P1 and P1b hold | the 2026-11-02 proposal stays a proposal; the store stays centred, as built, which the model ties or loses to by 0–0.37 s a leg (§3) |
| 2 | **Contradiction 1**: no slice skipped for DBT and ultrasound stacks, in a scroll and in a cine | **yes** | the stride ADR corrected in place as not holding where IHE RAD TF-2 §4.16.4.2.2.1.3.9 binds; one Opus row carries `claude/cine-no-skip`'s cine fix to `claude/unified` as a draft PR | the accepted ADR's option B against "shall not skip slices" (S1), and a cine that steps whether or not the frame was painted |
| 2b | a scroll bar's thumb, dragged: a scroll (every slice) or a jump (none between) | **a jump** (this page's reading, not a source's: S1 binds "manual or automatic scrolling" and its note speaks of a "requested frame rate"; a thumb asks for a place, not a rate) | the rule's jump path for a thumb: the target, then outward from it | every slice between shown, the reader held at the pipeline's rate |
| 3 | **The three settings** (model §6): `waitAhead` stays **off** for DBT and US until P3; `span` **0**; `span` and `holdEveryOther` **removed** | **yes** | one removal draft PR, named for what it removes (`span` in `downloader.js`, `holdEveryOther` in `view-worker.js`, `view.js`, `viewer.js`), its tests adjusted; `waitAhead` stays a lab lever | two levers with no state to act on under the rule, kept and documented |
| 4 | **M3, PR 96** (the one queue) | **hold PR 96; the shallow commitment first**, by [`transport-stack.md`](transport-stack.md) item 2's run, already recommended there (run and verdicted 2026-11-26: #96 unanswered, its lever not in the rig; asks first under a 6 MiB send window, #39, ×0.535–0.780 an ask during a fill, a yes there as a build row) | nothing new: that run decides; PR 96 is reopened only if asks at the saturating depth lose to runs (G1) | the same |

**Read against the run** (2026-11-26, PAGES-AFTER-RUNS, from `page-runs.md` §Verdict review §4, whose counts hold;
**measured**, `dbts_b1` as the exact HTJ2K series, the page view, W = 15, a relay at 20 and 80 Mbit/s and 40 ms, 298
counted visits, every frame exact). Wait a leg after the first pass, median, behind first against centred: P1 legs 20
**5.23 against 6.14 s**, legs 40 **19.19 against 20.06** (the order behind first and ¾ ahead tied, centred, then the
struck split, as the model, 9 of 9 and 10 of 10 rounds: **holds**); P1b 19.29 against 20.33, the rule 19.28 (the dwell
earns nothing over behind first always; on 50 frames it **cannot decide**, as the bounded model foresaw); the controls
**refuted**: P1c legs 12 behind first 0.42 against 0 (the one arm that waits), P1c ρ 0.92 0.00 against 0.47, P2 one
way 22.26 against 23.40. So behind first waits 0.4–1.2 s a leg less than centred on every live cell, larger than the
model's 0–0.37, and item 1's hold is not dropped: §6's P1 line is met. But by §6's own clause (P1c and P2: "a
difference there means the hold acts where the model says it cannot"), **the model's mechanism is refuted** by three
of its cells (the verdict's m4): the gain P1 shows is not shown to come from the turn. The open account (*theory*,
the run's): the window follows the display past the legs, so the store asks across a leg's ends and the hold's order
decides which frames are there. Item 1's yes is therefore for the order (behind first), as measured, not for the
model's reason, and **provisional**: one volume, the page view, the exact series, not the AV1 view whose ρ the model
was derived for.

**Not asked:** the memory budget. The model's §9 item 5 put 256 MiB to the owner; the owner has since said it is not
theirs (amendment 28, VIEW-MEMORY-BOUND: "the specific number should be decided by you or the other session"). That
row builds 256 MiB a tab with the farthest frame from the one in view let go: the rule's hold for a dwell, and the
store as built for every mode. Item 1's yes changes it only while the reader moves, and only after P1.

**How they serve the value statement** (amendment 27 item 7: "a fast full fill, and low latency on every jump"):
the rule is what makes a jump's latency a design property and not an accident of the fill's order. A jump's want
starts at its target (the fill from frame 0 is the rule's case of a path that never turns); the shallow commitment
(item 4) is the one lever every measured ask gain came from. Item 2 keeps "every frame the reader asks to see" a
promise the display keeps: no slice is passed over. Item 3 removes code the rule does not use.

## 3 · The options

The hold at a turn is the one place the rule differs from the store as built. W = 15 frames, a reader at 25 frames a
second, legs longer than W; wait a leg after the first pass, seconds (**derived**: a simulation of the model's own §2,
`claude/work-ledger:docs/queue/ASK-MODEL-FIX/legs.py` and `legs-output.txt`, rerun byte-identical by the re-review;
no RTT, one fetch at a time, a constant μ, legs of one length):

| case (ρ = the pipeline's rate over the reader's) | behind first, always | three quarters ahead (2026-11-02 proposal) | centred (as built) | the struck split | **the rule**: behind first moving, centred dwelling |
| --- | ---: | ---: | ---: | ---: | ---: |
| ρ 0.216, legs of 20 | 0.50 | 0.50 | 0.87 | 1.24 | **0.50** |
| ρ 0.216, legs of 40 | 3.40 | 3.40 | 3.77 | 4.14 | **3.40** |
| ρ 0.5, legs of 40 | 0.56 | 0.72 | 0.88 | 1.04 | **0.56** |
| ρ 0.8, legs of 40 | 0 | 0 | 0.05 | 0.10 | **0** |
| ρ 0.216, legs of 40, 3 s dwell at each turn | 5.85 | 5.29 | 4.55 | 4.75 | **4.55** |
| ρ 0.8, legs of 40, 0.5 s dwell at each turn | 0.29 | 0.29 | 0.09 | 0.13 | **0.09** |
| ρ 0.216, legs of 12 (≤ W − 1) | 0 | 0 | 0 | 0.03 | **0** |

The rule is the shortest or tied-shortest in every row; no other arm is. The gain over the store as built is 0–0.37 s
a leg when the reader moves, nothing when the reader dwells. "The struck split" is the model's first version (a window
behind by ρ), struck by ASK-MODEL-FIX after the review's B2; it wins no row.

The settings, against their evidence (model §6):

| setting | evidence | in the model | recommended |
| --- | --- | --- | --- |
| `waitAhead` k | **measured**: k = 8 adopted on five CT cells, forward wait −88 to −1 044 ms; no DBT cell voted, and k = 2 and 4 made DBT at 5 Mbit/s worse by +1.7 to +5.2 s in Chromium ([`../client/evidence/ask-order-during-fill.md`](../client/evidence/ask-order-during-fill.md) §Run) | k\* = C ÷ b, the frames already committed: **38** CT, **13** the `dbts_b1` view, **2** its exact frame under Chromium's 6 MiB (**derived**) | off for DBT and US until P3; the DBT cells that got worse are a **miss** the model does not explain |
| `span` g | **not run**; on its review's model 1.90–1.96× where ≤ 0.6× was needed ([`../client/evidence/spanning-small-gaps-in-the-misses.md`](../client/evidence/spanning-small-gaps-in-the-misses.md)) | under the rule the held frames are one interval, so there are no small gaps to span | 0, removed |
| `holdEveryOther` | a lab lever to make the half-held store `span` was to be tested on | no state the rule produces | removed |

M3's options (PR 96's body, row 253, **measured** on a relay, nothing past 103 Mbit/s claimed): the one queue with
the window following cwnd, asks at 0.32–0.90 of today's time in 25 of 28 cells; the queue alone, today's time where
the fill is already written; the window flag alone, "nearly all of the ask gain", its fill worse in six cells.

## 4 · Where it holds

**Fixtures: none.** The rule is theory; §3's table is a simulation of it. *Corrected 2026-11-26* (PAGES-AFTER-RUNS):
the hold's cells are now measured (§2, *Read against the run*): `dbts_b1` only, 50 × 2560 × 3328, run as the exact
HTJ2K series (2.11 MB a frame), not the AV1 view; the page view only, W = 15; one 4-core cloud container without a
GPU, software WebGL, headless Chromium 158; the relay at 20 and 80 Mbit/s, 40 ms, no loss, not a radio; no
ultrasound. The measured numbers quoted come from
`ct_lidc` and `dbt10_ea1141` at 5 and 20 Mbit/s through a userspace relay, headless Chromium and Firefox on 4-core
cloud hosts without a GPU (up to a third of visits voided), `dbts_b1` of one DBT dataset of 19 volumes, and one phone
on one home link behind the decode ranges. No breast ultrasound cine in the runs (`usb_cine` is in `docs/FIXTURES.md`,
lossy-sourced, and none of these rows took it), no reader, no radio.

**To DBT stacks:** the order inside each direction (nearest-first) holds by a proof under no-skip (model §3.1), and
no-skip by S1 itself, quoted. The hold's gain rests on readers who scroll back and forth: S6's abstract, "a type of
vigorous drilling strategy"; its leg lengths, and whether readers dwell before a turn, are unknown.
**To ultrasound stacks:** a clip fits 256 MiB (the model §3.3: `usb_cine` 17 MB grey, `us_liver` 67 MB, **derived**),
so after one pass nothing is let go and the hold never acts; what matters is the cine's gate (model §4.1) and the
order across the study's many clips (§4.2), for which no source was found. **Where the link binds, not the decode**
(amendment 28): for the `dbts_b1` view at 25 frames a second, ρ is wire-bound on the lab's 20 Mbit/s (0.22) and on far
LTE (0.29–0.92), and decode-bound on entry phones (0.20–0.44) (**derived on theory**: the device model's decode and
`link-profiles.md`'s goodputs; one phone measured). The rule's order is the same either way; ρ sets how long the waits are.
*Measured 2026-11-24* (ASK-CELLS, the exact series): at 20 Mbit/s and 40 ms the link binds (ρ 0.21, a step of
155–236 ms); at 80 Mbit/s this host's software paint nearly sets the step (ρ 0.92).

**Each limitation and what found it** (completed 2026-11-25, PAGES-PASS: each item names what found it):

* No fixture: the rule is theory and §3 a simulation of it; nothing built, run or timed. Found by ASK-MODEL (its
  status file: "Theory and sources") and ASK-MODEL-FIX-REVIEW ("every number is derived ... none measured").
  *Corrected 2026-11-26:* the hold's order measured on one volume, its limits the next four items.
* The run was the exact HTJ2K series, not the AV1 view the model's ρ was derived for. Found by ASK-CELLS' pilot
  (`page-runs.md` §4 Amendment).
* P1b cannot decide on a 50-frame series. Found by `bounded.py` before the run, confirmed by the rows (ASK-CELLS).
* The controls' nulls fail (P1c, P2): the model's tie predictions do not carry to this driver, and its mechanism is
  refuted where its own clause says. Found by ASK-CELLS' rows; read as the mechanism's refutation by PAGE-RUNS-VERDICT
  (m4).
* P1c's "no byte after the first pass" holds for no arm (19–23 frames received after it). Found by ASK-CELLS' pilot,
  confirmed in every counted visit.
* The measured numbers quoted are earlier rows' on relay links and 4-core cloud hosts without a GPU that voided up to
  a third of their visits; one phone behind the decode ranges; no reader, no radio. Found by ASK-MODEL (the model's
  fixtures paragraph, from those rows).
* No breast ultrasound cine in the runs (`usb_cine` exists, lossy-sourced, none of these rows took it). Found by
  DECISION-PAGES-REVIEW (§Review B3) against `docs/FIXTURES.md`.
* §3's numbers have no RTT, one fetch at a time, a constant μ, legs of one length. Found by ASK-MODEL (the model §5's
  own limits) and ASK-MODEL-REVIEW (the toy's parameters, `sawtooth.py`).
* P2 as written predicts an order its model cannot show: on a one-way path the arms differ only by a start-up
  transient (87.11 / 87.11 / 87.48 / 88.41 s over 600 frames at ρ 0.216, **derived**). It must predict a tie (§6).
  Found by ASK-MODEL-FIX-REVIEW (n1, `claude/work-ledger:docs/queue/ASK-MODEL-FIX-REVIEW/one-way.py`). Run corrected
  as a tie on 2026-11-24 and refuted (behind first 1.20 s under centred, 10 of 10 rounds; ASK-CELLS).
* "The rule needs no estimate" is true of the hold only; the cine's gate needs μ. Found by ASK-MODEL-FIX-REVIEW (n2).
* The closed form reads 0.04–0.44 s under the simulation, not 0.2–0.4 s. Found by ASK-MODEL-FIX-REVIEW (n3).
* Item 3's optimum at p = 1 (all behind while dwelling) has no simulated arm; the table supports only "centred is
  never beaten in the dwell rows". Found by ASK-MODEL-FIX-REVIEW (n4).
* The `waitAhead` DBT cells that got worse at k = 2 and 4 are not explained. Found by the measurement
  ([`ask-order-during-fill.md`](../client/evidence/ask-order-during-fill.md) §Experiment 2, *Run*, 2026-10-30); left unexplained by ASK-MODEL (the
  model §6, its own miss).
* S6's body ("3.8 image slices", "sawtooth") is not verified: the article page answered an automated-client check.
  Found by ASK-MODEL (not refetched, a bot check) and ASK-MODEL-REVIEW (m1).
* Readers' leg lengths, and whether they dwell before a turn, are unknown; only a reader's own log would give them,
  and telemetry is off. Found by ASK-MODEL (the model's *unknown*, from S6's abstract alone).
* The order across a study's many clips has no source. Found by ASK-MODEL's source search (the model §4.2).
* What a phone gives a tab has no source, and `navigator.deviceMemory` is a W3C Discontinued Draft. Found by ASK-MODEL
  (S7, the model §3.3).
* ρ per link and phone is **derived on theory**, one phone measured. Found by ASK-MODEL-REVIEW (m4: ρ's label) and
  ASK-MODEL-FIX (the ρ table derived on theory).
* M3's numbers claim nothing past 103 Mbit/s. Found by row 253 (PR 96's body).

## 5 · The mechanism

With no slice skipped, the display reaches c + 2 only through c + 1, so each side is asked nearest-first whatever the
reader does; only how the two sides share the window is left. When the pipeline is slower than the reader (ρ < 1),
the display is held at the pipeline's rate once the held frames run out, so nothing builds up ahead: at a turn every
hold has about W − 1 frames behind, the leg just crossed. What the hold controls is how soon on the way back the
pipeline may fetch past that tail. Letting go behind first lets it fetch at once; centred waits until the reader is
halfway. In a dwell the next direction is unknown, and centred is the best worst case. So: behind first while
moving, centred while dwelling. The transport side is one quantity, C, the bytes committed where a later ask cannot
pass: an ask waits behind C, so a shallow C is what makes a jump fast.

## 6 · What would change the recommendation

* **P1 and P1b** (a cloud run on the existing sawtooth driver, `dbts_b1` view, W = 15, ρ ≈ 0.22): if centred is the
  shortest, or behind first is not within the A/A spread of the shortest, item 1's hold is dropped and the store
  stays centred; the rest of the rule stands. *Run 2026-11-24 on the exact series, verdicted 2026-11-26:* behind first
  is the shortest (tied with ¾ ahead) in P1 at both leg lengths, so the hold stays; P1b cannot decide on 50 frames.
  What would change it now: the same cells on the AV1 view and on a longer series, and the worker view.
* **P1c and the corrected P2** are controls: every arm within the A/A spread (legs ≤ W − 1; ρ ≥ 0.8; a one-way path
  after the first W frames). A difference there means the hold acts where the model says it cannot. *Run 2026-11-24:*
  each differs (behind first 0.47 and 1.20 s under centred on P1c at ρ 0.92 and P2, 0.42 s over it on P1c's legs of
  12, the one arm that waits), where the model says no hold acts, so the model's mechanism
  is refuted (§2, *Read against the run*); a model whose window follows the display past the legs is the open
  account, *theory*.
* **P3** (`waitAhead` k ∈ {1, 4, 8, 16, 32} on three frame sizes): a forward-wait minimum at k ≈ C ÷ b would make k a
  derived setting, not a constant; another shape refutes the model of C.
* **A reader's own scroll log** (leg lengths, dwells before turns): the only measurement of whether the gain is worth
  building. Telemetry is off, so no run here can give it.
* **A phone session** reading where a tab is killed: it sets the budget, and so W.

## 7 · What it would reopen

Nothing, if taken as recommended. The model names two options it does not pursue and that would reopen decided
approaches: holding coded bytes outside the window ("no re-decoding", 2026-10-10) and frames held at the screen's
size ("no low-resolution preview"). A want that replaces the server's queue would touch
[`../adr/reject-server-cancel.md`](../adr/reject-server-cancel.md); it is not recommended. Item 2 corrects an
accepted ADR, which is the contradiction the owner was asked to settle, not a decided approach.

## 8 · Rows and links

* ASK-MODEL (Fable), ASK-MODEL-REVIEW (B1, B2, m1–m6), ASK-MODEL-FIX, ASK-MODEL-FIX-REVIEW (no blocker; n1–n4):
  PR 430, `claude/ask-model` `75d4b5849`, status files under `claude/work-ledger:docs/queue/`.
* The simulations: `claude/work-ledger:docs/queue/ASK-MODEL-REVIEW/sawtooth.py`, `…/ASK-MODEL-FIX/legs.py`,
  `…/ASK-MODEL-FIX-REVIEW/one-way.py`, each with its output.
* The 2026-11-02 proposal: [`../client/evidence/what-a-view-asks-for.md`](../client/evidence/what-a-view-asks-for.md);
  readers and viewers: [`../client/evidence/how-viewers-and-readers-ask.md`](../client/evidence/how-viewers-and-readers-ask.md);
  the scroll rate: [`../client/evidence/scroll-rate-and-skipping.md`](../client/evidence/scroll-rate-and-skipping.md);
  the cine: [`../client/evidence/cine-shows-every-slice.md`](../client/evidence/cine-shows-every-slice.md);
  an ask during a fill: [`../client/evidence/ask-during-a-fill.md`](../client/evidence/ask-during-a-fill.md).
* The stride ADR: [`../adr/stride-is-bandwidth-conservation.md`](../adr/stride-is-bandwidth-conservation.md).
* PR 96 (the one queue); [`transport-stack.md`](transport-stack.md) item 2 (the run that decides it).
* Sources, as the model §11 records them with their sha256: **S1** IHE RAD TF-2 Rev 23.0 §4.16.4.2.2.1.3.9: "The
  Image Display shall not skip slices during manual or automatic scrolling."; **S6** Aizenman et al. 2017, the
  abstract; **S7** W3C Device Memory API, Discontinued Draft, 20 October 2026.
