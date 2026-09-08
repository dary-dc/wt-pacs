# Why these changes exist

**The question this answers:** *someone opens the diff, sees a transport knob, a stalled
client, four guards and a rewritten analyser, and asks what problem any of it solved.*

One entry per **decision**, not per commit and not per file. There are fourteen; the branch
has 120-odd commits, which is the ratio to expect — most commits carry out a decision made
elsewhere.

**This file, not the code, is where "why" belongs.** A comment earns its place only when a
competent reader would otherwise do the wrong thing: the note in `stall.rs` that dropping a
`RecvStream` sends `STOP_SENDING` prevents a real mistake and stays. The history of how the
stalled client came to exist is here instead. Anything that reads like archaeology in a
source file is a candidate for deletion — see
[`code-style-and-comments.md`](code-style-and-comments.md).

Format: **what was true before → what forced the change → what else we could have done →
what would show it was wrong.**

---

## The measurements

### 1 · Two congestion controllers, because there are two kinds of loss

**Before.** The project flipped its controller recommendation three times. Each flip was a
campaign that had sat, by accident, in one loss regime and read the result as general.

**Forced by.** Building both regimes deliberately and running them side by side, each
verified by queue-drop counters rather than assumed. Congestive → Cubic; radio → BBR; the
margins are 44–63 % and they point in opposite directions.

**Alternative.** Pick one and move on. Rejected: whichever you pick is ~50 % wrong on half
your users, and nothing in the transport tells you which half.

**Falsified by.** Real client telemetry showing the regime mix is overwhelmingly one-sided,
which would make the second answer academic. That is what the loss-regime sampler is for.

### 2 · One shared stream, against the textbook

**Before.** The classic argument says per-frame streams confine loss damage to one frame.
The project pre-registered that as hypothesis H4 and expected it to win.

**Forced by.** It lost, and not narrowly — 3.5× at 64 KB in simulation, 8.5× at 250 KB, and
**5.76× on real hardware at 250 KB**, separated 3/3. The mechanism was read out of quinn's
source *before* the campaign: `retransmit()` re-queues with `push_pending`, behind every
already-queued stream, regardless of fairness. Per-frame therefore defers recovery behind
other frames' backlogs. The classic argument is right about the receiver and silent about
the sender.

**Alternative.** A fixed-N pool between the two. Still untested, and R6 makes it less
promising: the deferral cost grows with N and the winning endpoint is N = 1.

**Falsified by.** Any cell where per-frame + FIFO separates in its own favour. None found on
either rig. (Individual repeats do favour per-frame — 8 of 12 on the real path at 64 KB —
but no cell separates, which is a different and weaker statement.)

### 3 · The rig had to be rebuilt before any of §2 counted

**Before.** Four campaigns compared stream shapes on a rig where the reader blocked on each
frame, so the transport could never fall behind and head-of-line blocking was structurally
impossible. Stranded bytes: **0.00 MB**.

**Forced by.** Review 4 noticing that the condition under test could not occur. The
open-loop reader strands 18.31 MB in the same cell.

**Alternative.** Trust the earlier numbers. Rejected: they measured a rig property.

**Falsified by.** A cell where the open-loop reader strands nothing — which is now a gate
that voids the row rather than a thing to notice afterwards.

### 4 · Flow-control windows are hygiene, not a lever

**Before.** "Bound the windows for memory at thousands of viewers" was carried on
arithmetic: quinn's `send_window` defaults to 10 MB, and 10 MB × 5 000 is 50 GB.

**Forced by.** Measuring the case it was reserved for. A client that asks for 25 MB and
stops reading costs the server **180 kB** — 11 % more than one that merely reads slowly, and
50× below the ceiling. The withheld bytes queue on the *client*, which holds 2.20 MB, because
a stalled peer's stack still ACKs and the server frees what is acknowledged.

**Alternative.** Leave it unmeasured and bound the windows anyway. Cheap, but it would have
left the project believing a 50 GB risk it does not have — and would have hidden the finding
below.

**Falsified by.** A client that widens its own receive window on a high-BDP path, where the
in-flight window rather than the peer's credit bounds the server. Unmeasured; on this rig
such a client is killed by its own quinn first.

### 5 · The send path is a memory property, not only a CPU one

**Before.** `chunked` was adopted for −6…−14 % CPU per byte.

**Forced by.** The stalled-client campaign, which found the same client costs **198 kB on
chunked and 6 990 kB on copy + per-frame** — 68 % of the ceiling. The arithmetic worry in §4
was well founded *for the send path the project used to ship*; the chunked default is what
removed it.

**Alternative.** Report the CPU number alone. That would leave `main` — which has the copy
path only — exposed in a way nobody had written down.

**Falsified by.** A measurement where `RssAnon` and total RSS disagree, which would mean the
chunked figure is a file-backed blind spot rather than a real saving. Checked: they agree to
within 1.2 % in every arm.

---

## The instruments

### 6 · Guards are code, because comments do not refuse

**Before.** `r6_campaign.sh` carried `# Requires FIXTURE=frames_500x250k` as a comment.

**Forced by.** `CELLS="X3L"` alone running to completion against the 64 KB fixture — nine
admissible-looking rows, every verdict `ADM`, and the one variable X3L exists to vary left
unchanged. Nothing downstream could catch it; the TSV has no frame-size column.

**Alternative.** A louder comment. This project has five recorded instances of the same
failure; the pattern is that the guard was prose.

**Falsified by.** A campaign the guard refuses that should have run. `R6_ALLOW_NONSTANDARD_INPUTS=1`
exists for that, and has to be typed so it appears in the write-up.

### 7 · A guard that checks one direction is half a guard

**Before.** The guard above checked that a special cell had its special input.

**Forced by.** Adversarial review: `CELLS="X3" TRACE=…/r6_scrub_500.json` passed, running X3
on the scroll trace and recording it as X3 — the same mislabelling, pointing the other way.

**Alternative.** None seriously. The lesson is that "I closed this class of hole" is a claim
to check, not to make.

**Falsified by.** A third direction nobody has thought of. Every cell now names both inputs
explicitly, including defaults, which is the shape that has no third direction.

### 8 · Analysers must show `n`, and must not average their own void rows

**Before.** `l4_analyse.py` flagged a void row and then appended it to the comparison group
anyway; `r6_analyse.py` took `vals[len//2]` as a median, which for n = 2 is the maximum.
Neither printed `n`.

**Forced by.** The congestive "+63 %" figure turning out to be n = 2 for BBR, undisclosed,
on a column the analyser did not report, from an arm the analyser voided. Three tool defects
that between them made a missing repeat invisible.

**Alternative.** Fix the document and leave the tools. Rejected — the next missing repeat
would be just as invisible.

**Falsified by.** Nothing; this is hygiene. But note it changed no published number, which is
the point: the tools were wrong in a way that had not yet cost anything.

### 9 · One write per row, because two interleave

**Before.** The loss-regime sampler appended each JSONL row with `writeln!` on an unbuffered
`File`.

**Forced by.** `writeln!` issuing **two** `write` calls — line, then newline. Under
`O_APPEND` each is atomic separately, so concurrent samplers interleave. Measured: **29 % of
rows survive at 32 connections**, and the classifier skipped the damage silently, so the
series looked *quiet* rather than broken.

**Alternative.** Route rows through one writer thread, as the frame tap already does. Correct
and larger; one write per row fixes the observed defect at a fraction of the change.

**Falsified by.** A short write, which would corrupt a line just as badly. That is why it is
counted as a drop rather than looped over, and why the count rides in the next row.

### 10 · A counter that does not mean what the docs said

**Before.** `black_holes_detected` was documented as "the path stopped delivering entirely —
a handover — neither regime", and review asked why the verdict never consulted it.

**Forced by.** Applying it as documented would void the project's own congestive validation
cell, which carries 42. quinn increments it from `path.mtud.black_hole_detected()`: PLPMTUD
noticing consecutive large packets lost, which is the *expected* outcome of heavy congestive
loss.

**Alternative.** Implement the exclusion as asked. It would have thrown away exactly the
cells it was meant to protect.

**Falsified by.** A signal that does identify handovers. This sampler does not collect one;
the claim that it did has been withdrawn rather than implemented.

### 11 · Declared exceptions, not silent omissions

**Before.** Two pre-registered rules were unenforced: L4's stop condition 4 (queue drops in a
0 %-loss cell) and R6's N0 control rule (any arm separating in the control voids the
campaign).

**Forced by.** Implementing them literally breaks valid work. Stop condition 4 would void the
entire congestive campaign, where 0 % injected loss with an overflowing queue *is* the
regime. The N0 rule would void every R6 campaign, because `perframe_fair` separates there and
its control was already conceded invalid.

**Alternative.** Leave them unimplemented, as before. Rejected: an unenforced rule is a rule
nobody applies under pressure.

**Falsified by.** An exception growing until the rule means nothing. Both are single named
constants — `--congestive`, `CONTROL_EXEMPT` — so the exception is visible in the invocation
and in the output.

---

## The record

### 12 · Keep VOID rows, show them, never average them

Failures are systematically the slowest runs, so deleting them flatters whichever arm fails.
This project biased one result exactly that way. The rule is *show*, not *include*, and §8
above exists because a tool did the second while the documents claimed the first.

### 13 · Write down the prediction that would embarrass you

R6 pre-registered P5 — that fairness-on would *beat* FIFO — the opposite of what the project
had published. It was falsified twice, on rigs sharing no code. Recording it in advance is
what made it impossible to drop quietly, and it is why the surviving findings can be trusted.

The same discipline produced the X3L run card's "what a null would mean" paragraph, written
before the run: *if per-frame does not separate at 250 KB with the stranding gate passing,
the mechanism is in trouble.* It separated.

### 14 · A default may not outrun its evidence

`transport-conclusions.md` §2.7 records that the binary shipped `per-frame` while the answer
sheet recommended `shared`, and rather than asking someone to adjudicate it fixed a rule:
X3L decides. X3L has now run and separated, so the rule points to flipping the default —
proposed in [`proposals/product-code-changes.md`](proposals/product-code-changes.md) §1
rather than done in a documentation pass.

The general form: **when a decision is contested, write the measurement that would settle it
and commit to the outcome in advance.** It converts an argument into a run.

---

## The pass of 2026-09-08

### 15 · A measurement rig and a shipped server want different things

**Before.** Thirteen transport flags and three send paths reached a product build, because
every variable a campaign swept had been given a knob and no one had asked which of them a
hospital's server needs.

**Forced by.** Reading the diff as a product change rather than as a campaign. A campaign
needs a knob per swept variable; a server needs one only where a decision is genuinely open.
Six flags pass that test — `--stream-mode`, `--send-window`, `--receive-window`,
`--congestion`, `--bind`, `--prefault` — and each points at a section of
`transport-conclusions.md`. The rest are arms, and now sit behind `--features lab`, which is
the convention `telemetry` already established in this repository.

**Alternative.** Delete them. Tried, and it was wrong — see below.

**Falsified by.** A campaign that cannot be reproduced. Every arm is still reachable with
`--features lab`, and the lab scripts build with it.

### 16 · A usage count is only as wide as the places you looked

**Before.** The audit for §15 counted usage with `grep` over `lab/scripts/` and `server/src/`
and deleted five flags and the `split` send path as unreferenced.

**Forced by.** Both readings being wrong, for one reason: **arms are not invoked from inside
the scripts.** They arrive through `SRV_FLAGS`, and those command lines live in the
*documents*. `quic-transport-optimization.md` §5 runs all five flags and reports a number for
each; `split` has three committed TSVs and is the baseline the chunked path's knee is
measured against. Grepping for `SendPath::Split` found the symbol, constructed in one place.
It could never have found `--send-path split`.

**Alternative.** Keep the deletion and accept that a committed results section no longer
reproduces. Rejected: this project's whole claim is that its numbers can be re-derived.

**Falsified by.** Nothing — it is a method error, recorded so the method changes. **A
repository that keeps its invocations in prose cannot be audited by grepping its code.**

### 17 · Rationale belongs where the results are, not in the file that produced them

**Before.** 1 268 lines of multi-line comment across 55 files, at three times the house
comment-to-code ratio. Much of it argued *why the project came to need the thing* — at the
call site, where a reader is trying to follow what the code does.

**Forced by.** The rule that a comment earns its place only when a competent reader would
otherwise do the wrong thing. Applying it left every in-body comment at one or two lines and
moved the argument to the document a reader of the results already has open: two new files
under `measurements/r6/`, an appendix on `stall-client.md`, and this register.

**Alternative.** Delete the rationale. Refused: this repository's credibility rests on
recording what a normal codebase deletes — void rows, falsified predictions, why a threshold
is what it is. **Essentialism is placement, not deletion.**

**Falsified by.** A comment surviving the pass that could be deleted without a reader making
a mistake, or a fact that now exists nowhere. Both are checkable; neither is a matter of
taste.
