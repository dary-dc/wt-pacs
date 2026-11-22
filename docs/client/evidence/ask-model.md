# What a view asks for: a model of the reader, and one rule

**Question:** What should a view ask for, in what order, while a reader scrolls, plays or jumps, under a memory bound
and a link bound, as one rule?

*Written 2026-11-22 (ASK-MODEL). **Theory and sources; nothing built, run or timed.** It reads the client at
`origin/claude/unified` `4a2b4277f`. Each number is labelled **(S)** a source quoted in §11, **(M)** measured in this
repository and cited, **(D)** arithmetic on (S) or (M) numbers, **(T)** this file's model, or **(A)** assumed. The
earlier proposal is [`what-a-view-asks-for.md`](what-a-view-asks-for.md) (2026-11-02); §8 says where this file keeps
it and where it differs. The design it would change is [`../design.md`](../design.md) §Open, *What a view asks for*.*

## 1 · The answer, short

**One key, used three times.** For every frame of every series a view shows, the client keeps one number, its
**need time**: how soon the display can require it, along the paths the reader's mode allows. The want lists the
missing frames by need time, soonest first. The store, over its budget, lets go the held frame whose need time is
latest: while the reader moves, a frame behind needs a turn first, so the farthest behind goes before any frame
ahead; while the reader dwells, the farthest either side. The transport commits (writes where
no later ask can pass) no more than keeps the link busy. A fill, an ask, a cine run, a window and an arbiter over
several series are this rule at different parameter values; none is a mechanism of its own (§4).

Four things follow that no earlier text here states:

1. **With no slice skipped, the order inside each direction needs no model of the reader.** The display reaches
   frame c + 2 only through c + 1, so nearest-first on each side is never worse (§3.1). The whole ordering problem
   is one merge of two lists.
2. **With no slice skipped, where the window sits at a turn is not the store's choice.** When the pipeline is
   slower than the reader (ρ < 1, the pipeline's rate over the reader's), the display is held at the pipeline's
   rate once the held frames run out, so nothing builds up ahead: at a turn every hold has about W − 1 frames
   behind, the leg just crossed. The hold decides only when the pipeline may fetch past them on the way back, and
   which side a dwell fills. Letting go behind first while the reader moves, and centred while the reader dwells,
   is the best or tied-best arm in every case of §5's simulation (derived, not measured). *Corrected 2026-11-22
   (ASK-MODEL-FIX): this item first said the window belongs behind a back-and-forth reader, by ρ ahead to 1
   behind; under the file's own model that split is the worst arm in every case without a dwell and the best in
   none, and it is struck (§5).*
3. **`waitAhead`'s k is not a constant.** It stands for "the frames already committed", C ÷ b: 38 frames of CT, 13
   of the DBT view, 2 of the exact DBT frame, under Chromium's 6 MiB (§6). The measured k = 8 was adopted on CT cells
   only; on DBT it had no vote.
4. **The window is the normal case for DBT, on a workstation too.** One DBT hanging, four views current and prior,
   is 5–6 GB decoded (D, [`what-a-view-asks-for.md`](what-a-view-asks-for.md) §3), so "hold the whole series"
   fails as a design premise wherever the hanging is complete, not only on a phone.

## 2 · The model

**The reader** has a mode and two positions.

* The **display's frame** s is what is painted. The **target** p is where the reader's input has asked the display
  to be. They differ whenever input outruns the pipeline. Today's client has one index for both.
* **Cine** at rate r: the path is known exactly (a loop, a sweep or a stop: the three IHE requires, S1). **Scroll**
  at rate v with a direction: the path is known one step ahead, and the reader may turn at any step. **Dwell**:
  v = 0, no direction. **A jump** sets p to any frame and then dwells.
* Sources for the scroll: eleven DBT readers' search "most closely aligns with a type of vigorous drilling
  strategy" (S6's abstract, fetched); its body, as this repository recorded it and **not verified** here, has them
  scroll "through 3.8 image slices during a single fixation" and make "sawtooth plots as the observer moves back
  and forth through the stack multiple times". So the back-and-forth reader rests on "drilling". The three naïve
  observers and three radiologists of a lung CT study scrolled at "25-30 fps" at detection, against their own
  "subjective estimate of 5 frames per second" (S4); adjacent looks on film "averaged 0.54 seconds" (S5). So v
  runs from about 2 to 30 frames a second, and a scroll is a sawtooth whose leg length, and whether a reader dwells
  before a turn, no source gives **(unknown)**.

**The pipeline** is one server with a head start.

* b the coded bytes a frame, G the session's goodput, d the effective decode a frame. Its rate is
  **μ = 1 ÷ max(8b ÷ G, d)** frames a second ([`../../transport/link-profiles.md`](../../transport/link-profiles.md)
  §2's rule, turned over).
* **C, the commitment**: bytes written where a later ask cannot pass them. An uncommitted frame asked now is held
  after the **lead** L = RTT + (C + b) × 8 ÷ G + one decode. Measured here: "the ask's wait is B, and every gain
  came from shrinking it; the queue alone moves nothing" (M, [`ask-during-a-fill.md`](ask-during-a-fill.md)
  §Verdict; its B is this C).
* **ρ = min(1, μ ÷ v)**: how much of the reader's rate the pipeline keeps up with.

**Memory** is W frames a series: the budget's bytes over s_d, one decoded frame.

**A frame's value** is the chance the display needs it before it can arrive. Need time is when; the lead and the
queue ahead of it are "before it can arrive". The cost to minimise is the reader's total **wait**: the time the
display stands on a frame because the next one on the path is not held. With no slice skipped (§3.4) a late frame is
never passed over, so every late frame is a wait, and stale pictures do not exist.

## 3 · The premises, questioned

### 3.1 "The order needs a prediction of the reader"

Only one number of it does. **Claim (T):** under no-skip, sending c + δ before c + δ − 1 never shortens a wait.
*Proof:* the display shows c + δ only after c + δ − 1, so the wait at c + δ − 1 ends no earlier than that frame
arrives; swapping the two arrivals leaves the later of them unchanged and makes the first needed one later. The same
holds behind. So each side is sent nearest-first whatever the reader does, and frames between s and p come before
both (the display must cross them: need time now, chance 1). What is left to choose is how the two sides
interleave, and how deep each is held. That is what a reader model is for, and §5 needs one number from it.

Every surveyed viewer orders by index distance too ([`how-viewers-and-readers-ask.md`](how-viewers-and-readers-ask.md)
*What viewers do*); the claim says why that is right and that it stops being right the moment a display may skip.

### 3.2 "A fill runs from the first frame, in order"

It is the rule's answer in one case: a path that starts at frame 0 and never turns (a cine from the first frame,
which is how an ultrasound clip is played, S2). For a view that opens elsewhere, or a reader who scrolls, frame 0
has no claim: the path starts at the frame the view opens on. Measured here on a 29-frame DBT series: the centre
five frames in 1.19 s asked first against 3.65 s in index order, at 20 Mbit/s (M,
[`what-a-view-asks-for.md`](what-a-view-asks-for.md) §5). Which frame a DBT view opens on is the viewer's and
unsourced; the rule takes it as the start of the path and needs nothing else.

### 3.3 "A whole series must be held"

| | decoded (D) | fits 256 MiB | fits 1 GiB |
| --- | ---: | --- | --- |
| one `dbts_b1` frame, 2560 × 3328 × 2 B | 17.04 MB | 15 frames | 63 ≥ n = 50 |
| `dbts_b1`, 50 frames | 852 MB | no | yes, alone |
| a DBT hanging, four views, current and prior | 5–6 GB ([`what-a-view-asks-for.md`](what-a-view-asks-for.md) §3) | 1 frame a view | 7 frames a view |
| an ultrasound clip (`usb_cine` 64 × 512², `us_liver` 70 × 760 × 421 RGB) | 17 MB grey, 67 MB | yes | yes |

* **What a device gives a tab has no source.** The platform states physical memory only: a class-V phone "MUST have
  at least 8 GB of physical memory", and a handheld under 1 GB must call itself low-RAM (S3). The Device Memory API,
  which the earlier proposal built M on, is since 2026-10-20 a W3C *Discontinued Draft*: "It is inappropriate to
  cite this document as other than abandoned work" (S7); WebKit declined it ([`../../CLIENTS.md`](../../CLIENTS.md)
  §On WebKit) and the earlier proposal records none in Firefox. So M is a deployment
  setting with one default, **(A)** 256 MiB a page, until a device session reads where a tab is killed
  ([`../../decode/mobile/device-model.md`](../../decode/mobile/device-model.md) §5: one `dbts_b1` series is "most of
  what a 3–4 GB phone has free").
* **So the window is the rule and "the series fits" its special case W = n.** That holds for every ultrasound clip
  and for one DBT volume on a workstation; it fails for a DBT hanging everywhere (§1 item 4).
* **Two options the arithmetic offers, named and not pursued:** holding the *coded* bytes of frames outside the
  window (the view is 464 KB a frame against 17 MB decoded, ×37, D), so a return costs a decode and no round trip;
  and holding frames at the screen's size. The first reopens "no re-decoding" (2026-10-10), the second "no
  low-resolution preview" (§10).

### 3.4 "A slice may be skipped"

The profile, verbatim (S1): "The Image Display shall not skip slices during manual or automatic scrolling." Its
note: "if the Image Display is unable to keep up with the user’s requested frame rate, then the display will show
all slices rather than scrolling faster." And: "a maximum scrolling rate of at least 25 frames per second for an
entire 5 MP display is desirable"; "Scrolling shall be in spatial sequence".

* **The stride ADR's argument does not survive it for DBT.** The ADR
  ([`../../adr/stride-is-bandwidth-conservation.md`](../../adr/stride-is-bandwidth-conservation.md)): "the alternative
  to skipping a frame is not that the reader sees it, but that it arrives after the reader has already moved past
  it." Under S1 the reader cannot move past it: the display holds the reader at the pipeline's rate. So the frame
  the ADR would not fetch is the next frame the display must show, and fetching it is the only way forward. Its
  9 slices a second is no source's ([`scroll-rate-and-skipping.md`](scroll-rate-and-skipping.md)).
* **What S1 leaves open, and this file does not decide:** a jump. S1 binds "manual or automatic scrolling"; a link
  to a finding's slice is not scrolling. Whether dragging a scroll bar's thumb is a scroll (every slice) or a jump
  (none between) is the owner's reading (§9).
* **What it does to input.** If the display shows every slice at its own pace, input beyond it is a backlog p − s
  that plays out after the reader's hand has stopped. S1's note describes the other reading: the scroll *is* as
  fast as the display, so input is taken at the display's rate and the backlog stays at a step or so. The viewer's
  choice; the rule below works for both.
* **It simplifies the asking.** The measured comparison of what a scroll ahead asks
  ([`what-a-scroll-ahead-asks.md`](what-a-scroll-ahead-asks.md)) judged *stale* time, the cursor showing another
  frame than its own, and its only policy that lost no cell, the cursor's frame only, drops the frames the cursor
  passed. Under no-skip those frames are the path: the policy is not admissible for DBT, and *stale* is not the
  measure. The cine on this branch still steps on a timer whether or not the frame was painted
  ([`cine-shows-every-slice.md`](cine-shows-every-slice.md): the fix is on its branch).

### 3.5 "An ask and the fill are two mechanisms"

They differ in one quantity, C. A run is the want's ascending head written without waiting for the client; an ask
is the want's head when it is not the next index. The run's advantage is the server reading ahead and no request a
frame; its price is that everything written is committed, and a turn or a jump then waits L. The measurements
agree: the one queue alone, which keeps a fill alive through an ask, read as today's server wherever the fill was
already written, and the send window that follows cwnd took the ask to ×0.24–1.01 of today's in every cell (M,
[`ask-during-a-fill.md`](ask-during-a-fill.md)). The smallest C that costs no throughput is what keeps the link
busy: about a congestion window and the frame being written (T; the lab flag's cwnd + two frames is that with a
margin). Under it a run and asks held at the saturating depth carry the same order, and whether the run is still
needed is one owed measurement ([`how-viewers-and-readers-ask.md`](how-viewers-and-readers-ask.md) G1).

## 4 · The rule

```
path(mode)     cine: the loop or the sweep from s, exactly.   scroll, dwell, jump: s → p, then outward from p.
need(i)        the path's distance to i ÷ the mode's rate (r for cine, v for a scroll; dwell: the distance alone).
want           the frames not held, by need, soonest first; replaces the one before.
               scroll: s → p first, then ahead of p.  dwell and after a jump: behind and ahead in turn.
hold           over the budget, let go the frame whose need is latest; refuse a fetch it would let go at once.
               cine: the frame just shown is the farthest on the path.  scroll: every frame behind before any
               ahead, the farthest first.  dwell and after a jump: the farthest either side (centred).
commit         no more than keeps the link busy; never ask a frame committed to arrive sooner than the ask would.
show           the next frame on the path once held and painted; none passed over (S1).
```

The rule needs no estimate: the mode and the direction of the last step asked are what the client already knows.
ρ decides how long the waits are, not which frame goes (§5). *Corrected 2026-11-22 (ASK-MODEL-FIX): the hold first
weighed a frame ahead at δ ÷ ρ̂, with ρ̂ estimated in the session; §5 strikes that split, and ρ̂ with it.*

**What each existing piece is, in the rule.**

| built or proposed | the rule at |
| --- | --- |
| the fill from frame 0 | a path from 0 that never turns, W = n, C whatever the server writes |
| an ask | a want of one frame |
| nearest-first (c, c + 1, c − 1, …) | dwell: both sides in turn |
| `waitAhead`'s ascending want | a path that never turns from c: cine's order, used for a scroll |
| the memory window of [`what-a-view-asks-for.md`](what-a-view-asks-for.md) | hold, with a fixed three quarters ahead |
| the useful frames first | a path that starts where the view opens |
| the play gate of a cine | need against arrival, checked before the first step (below) |
| one fill at a time across viewports | the want merged over series, C deep (§4.2) |

### 4.1 Cine

The path is exact, so need is exact, and the display steps only onto a held, painted frame. Starting at once is
right when each miss arrives before its turn. Number the path's next n places 0 to n − 1, place 0 the frame shown
now, places 0 to h − 1 held: place j is needed at j ÷ r and its miss arrives at (j − h + 1) ÷ μ. This holds for
every j when **h ≥ n − ρ(n − 1)**, about n(1 − ρ) (D, ρ = μ ÷ r); otherwise the cine stalls at the hole however
it is started. Then there are two honest behaviours, and the modality picks:

* **wait, then play at the clip's rate**: for ultrasound, where a slowed clip misstates motion. The rate rule read
  here is the Basic Image Review profile's cine ("The default shall be the frame rate specified in the DICOM
  attributes, if present", S2), a general viewer profile: no profile read here binds breast ultrasound;
* **play every frame at μ and say the rate**: what S1's note describes for DBT.

Every ultrasound clip fits memory (§3.3), so after one pass nothing is asked again; the gate matters once a clip.

### 4.2 Several series under one arbiter

The key does not stop at a series: need(series, i) orders one want across everything the page shows.

* **A visible viewport's frame on screen** has need 0. **The focused viewport** runs its mode's path. **A visible
  viewport not being moved** dwells: a short centred window. **Linked scrolling** moves both, so both are focused.
  **A series not on screen** has the need of its place in the hanging's order (**(A)**: the reader goes through the
  hanging in order; no source gives the order).
* **Memory follows need, not equal shares.** The earlier proposal split M by visible viewports. Under the key a
  dwelling viewport keeps a lead's depth either side and the focused one takes the rest; when focus moves, so does
  the budget, and what the old viewport lets go is its farthest frames.
* **The link.** Each series is its own session today, so two fills are two congestion controllers and two deep
  commitments, and no client order survives that. A client arbiter can gate which session is asked, and it holds
  the merged order only if each session's C is shallow: the same condition as §3.5. Carrying several series in one
  session is the clean form and a wire change (§6).

## 5 · What the hold decides at a turn

*Rewritten 2026-11-22 (ASK-MODEL-FIX, after ASK-MODEL-REVIEW's B2). The first version derived a window kept
behind by ρ ahead to 1 behind, with a leg of (W − 1) ÷ (1 − ρ²) frames and no wait, from a pipeline that keeps
adding frames ahead while the reader crosses the tail. Under no skip that fetch is what the split's hold refuses,
and the window it assumed at a turn never forms. The split and its table are struck; what follows is the same
model run through.*

Let a scroll be a sawtooth of legs ℓ frames at v, the window W, one fetch at a time at μ, ρ = μ ÷ v < 1, a store
that lets go only past its budget (`client/view/store.js:52`), and a hold that refuses a fetch it would let go at
once. The client learns of a turn when the input asks for the step back (§2's target).

1. **The window at a turn.** Once the held frames run out the display is held at μ, each frame fetched as it is
   needed, so nothing is ahead at the tip under any hold: about W − 1 frames are behind, the leg just crossed,
   less the frame in flight past the tip when the turn comes (T).
2. **What the hold controls on the way back** is when the pipeline may fetch past that tail: each fetch must let
   go a frame the reader has just crossed. If it may only after k₀ steps, the leg with no wait is
   **n = (β − ρk₀) ÷ (1 − ρ)**, β ≈ W − 1 (D). Letting go behind first gives k₀ = 0 and n = (W − 1) ÷ (1 − ρ);
   centred waits until the reader is halfway, k₀ = W ÷ 2; the struck split until k₀ = W ÷ (1 + ρ).
3. **A dwell before the turn.** While the reader stands, the client cannot know the next direction. Filling
   ahead spends the tail; centred keeps half of it. With p the chance a dwell ends in a turn and a fraction f of
   the window kept behind, the next leg's free run is about [pf + (1 − p)(1 − f)] (W − 1) ÷ (1 − ρ): linear in f,
   so the best split is all one side, set by p, and **centred is the best worst case when p is unknown** (T). No
   source gives p.

**Simulated** (derived: §2's model run as events, `claude/work-ledger:docs/queue/ASK-MODEL-FIX/legs.py` and
`legs-output.txt`; it reproduces ASK-MODEL-REVIEW's toy, `docs/queue/ASK-MODEL-REVIEW/sawtooth.py`, exactly where
the two share a case, and adds the turn seen only by the input and a dwell at each turn). W = 15, v = 25 frames a
second, no RTT, a lead of 0, a constant μ. Wait a leg after warm-up, seconds:

| case | behind first, moving or not | three quarters ahead | centred (as built) | the struck split | behind first moving, centred dwelling |
| --- | ---: | ---: | ---: | ---: | ---: |
| ρ = 0.216, legs of 12 (≤ W − 1) | 0 | 0 | 0 | 0.03 | 0 |
| ρ = 0.216, legs of 20 | 0.50 | 0.50 | 0.87 | 1.24 | 0.50 |
| ρ = 0.216, legs of 40 | 3.40 | 3.40 | 3.77 | 4.14 | 3.40 |
| ρ = 0.5, legs of 40 | 0.56 | 0.72 | 0.88 | 1.04 | 0.56 |
| ρ = 0.8, legs of 40 | 0 | 0 | 0.05 | 0.10 | 0 |
| ρ = 0.216, legs of 40, a 1 s dwell at each turn | 4.29 | 4.29 | 4.29 | 4.66 | 4.29 |
| ρ = 0.216, legs of 40, a 3 s dwell at each turn | 5.85 | 5.29 | 4.55 | 4.75 | 4.55 |
| ρ = 0.8, legs of 40, a 0.5 s dwell at each turn | 0.29 | 0.29 | 0.09 | 0.13 | 0.09 |

The closed form of item 2 orders the no-dwell rows the same way and reads 0.2–0.4 s lower: it leaves out the frame
in flight past the tip (one 1 ÷ μ, 0.19 s at ρ = 0.216) and the steps before the input shows the turn. A leg of at
most W − 1 frames is held whole after one pass under every hold that lets go only past its budget (ASK-MODEL-REVIEW
B1). Every dwell in the simulation ends in a turn (p = 1), the case most favourable to keeping frames behind; the
struck split wins no row even there. The limits: no RTT, one frame at a time, legs of one length, no reader data.

A reader who never turns is a cine, whose path the client knows: the hold lets go the frame just shown.

**What ρ is on a phone** for the `dbts_b1` view (3.71 Mbit a frame), at a reader's 25 frames a second (derived on
theory: [`../../decode/mobile/device-model.md`](../../decode/mobile/device-model.md) §4's effective decode, which that
file labels (T), and [`../../transport/link-profiles.md`](../../transport/link-profiles.md)'s goodputs):

| | μ, frames a second | ρ at 25 |
| --- | ---: | ---: |
| decode-bound, premium phone (33–48 ms) | 21–30 | 0.83–1 |
| decode-bound, middle (41–132 ms) | 7.6–24 | 0.30–0.98 |
| decode-bound, entry (90–200 ms) | 5–11 | 0.20–0.44 |
| wire-bound, LTE one far stream (27–85 Mbit/s) | 7.3–23 | 0.29–0.92 |
| wire-bound, 20 Mbit/s (the lab's `r20000`) | 5.4 | 0.22 |

So S1's "desirable" 25 frames a second past what is held is out of reach on most phones whatever the link, by the
decode alone (derived; the decode ranges are the device model's, one phone measured). Inside what is held a step
costs a paint. The window's place is what the client controls.

## 6 · The three settings, and what the wire would need

| setting | its evidence | in the model | default |
| --- | --- | --- | --- |
| `waitAhead` k | **(M)** k = 8 adopted by its rule on five decided CT cells, both engines, forward wait −88 to −1 044 ms, fill ×0.92–0.95; on DBT "no vote" at 8, and k = 2 and 4 later by +1.7 to +5.2 s at 5 Mbit/s in Chromium ([`ask-order-during-fill.md`](ask-order-during-fill.md) §Run) | two things under one name. Its order is the cine's path used for a scroll. Its wait is "never ask a committed frame": k\* = C ÷ b, at 6 MiB **38** for `ct_lidc`'s 164 kB, **11** for `dbt10_ea1141`'s 0.57 MB, **13** for the `dbts_b1` view, **2** for its exact frame, **1** for a 4.8 MB mammogram (D). Under a window that follows cwnd, 2 or 3; under one queue the wait is the server's ("skipping a frame already sent") and k has nothing to do | **stays off.** The scope is DBT and ultrasound stacks and no DBT cell voted for it. The model does not explain the DBT cells that got worse (k = 2, 4 are under its k\* of 11): a miss, and P3's first cell |
| `span` g | **not run**: on its review's model spanning costs 1.90–1.96× where the rule needed ≤ 0.6× ([`spanning-small-gaps-in-the-misses.md`](spanning-small-gaps-in-the-misses.md)) | a run crossing held frames. Under the rule the held frames of a series are one interval around the display (each side is filled nearest-first and let go farthest-first), so the misses have no small gaps to span. A single hole (a frame that failed its check, a failed cache read) is one ask | **0, and removed** |
| `holdEveryOther` | a lab lever that makes the half-held store `span` was to be tested on | no state the rule produces | **removed with `span`** |

**What the wire would need**, each structural and the owner's, none designed here:

1. **A shallow commitment** (`--send-window-follows-cwnd`, lab only today): the one lever every measured gain came
   from. It is also what lets a client arbiter order several sessions (§4.2).
2. **An ask that does not end the fill** (the one queue, PR 96, M3): the server's queue is then the want, and the
   client's re-ask of the rest, its three `refill` modes and `waitAhead`'s wait go. Measured alone it moves no time.
3. **A want as ordered ranges that replaces the queue**: `stream_frames` taking a list. Only if G1's owed
   measurement shows asks at the saturating depth lose to runs; a tie means the client holds the want and the wire
   stays as it is.
4. **Several series in a session** (a series field in each message): only when a viewer has viewports.

## 7 · Predictions a cloud run could refute (an outline for the next queue; nothing run)

A protocol row by another session writes the bands, the VOID rule and the A/A pair before any row. The existing
drivers: the sawtooth and cine traces of `lab/viewer/trace.js`, the viewer check's `--cine`, the store's budget as
the memory lever (never the browser's own pressure). Two things must be built first, as lab levers: a display
that never skips with p apart from s, and the hold key. Each cell measures μ̂ first, with no reader, and ρ is the
cell's own.

| | cell | prediction (T) | refuted when |
| --- | --- | --- | --- |
| P1 | `dbts_b1` view, W = 15, a sawtooth at 25 a second, ρ ≈ 0.22, no dwell, legs of 20 and of 40; arms, each letting go only past its budget: behind first, three quarters ahead, centred (as built), the struck split | wait a leg after the first pass (§5, simulated): legs of 20, 0.50, 0.50, 0.87, 1.24 s; legs of 40, 3.40, 3.40, 3.77, 4.14 s. The run adds an RTT and decode jitter, so the order and the gaps are predicted, not the values | centred or the struck split is the shortest, or behind first is not within the A/A spread of the shortest |
| P1b | legs of 40, a dwell of 3 s at each turn, every dwell ending in a turn; arms: behind first always, centred, behind first moving and centred dwelling | 5.85, 4.55, 4.55 s: the last two within the A/A spread of each other, behind first always longer by about 1.3 s | behind first always is not the longest |
| P1c | two controls: legs of 12 (≤ W − 1), and ρ ≥ 0.8 with legs of 40, no dwell | every arm within the A/A spread of the others (simulated: at most 0.03 and 0.10 s); legs of 12, no bytes received after the first pass in any arm | any arm differs: the hold acts where the model says it cannot |
| P2 | a one-way cine over W < n, the arms of P1 | behind first the shortest, the struck split the longest | the struck split wins a path that never turns |
| P3 | `waitAhead` k ∈ {1, 4, 8, 16, 32} on today's server: `ct_lidc`, `dbt10_ea1141`, the `dbts_b1` view | the forward wait falls until k ≈ C ÷ b (38, 11, 13) and is flat after | a minimum at one k across frame sizes, or the DBT cells again worse at k < 11 with C read at 6 MiB (then the model of C is wrong, and why is the finding) |
| P4 | the same under the window that follows cwnd | k from 1 to 32 within the A/A spread | any k differs |
| P5 | a cine at the clip's rate on `usb_cine` and `us_liver`, links with ρ < 1; started at once against gated at h ≥ n − ρ(n − 1), ρ from the cell's μ̂ | gated: no stall after the first step; at once: stalls, all of them at the first hole | a gated cine stalls, or the ungated one does not |
| P6 | two series, a client arbiter, each session's commitment shallow against deep | shallow: the focused series' forward wait within its single-series A/A; deep: later by about the other's C ÷ G | the two tie |
| P7 | every visit of P1–P5 | the held frames of a series are one interval at every sample; a mutant hold that lets go the nearest fails it | a hole appears without a failed check |

What a cloud run cannot decide: M on a phone and where a tab dies; ρ on a phone (the decode); the leg lengths of
real readers, which only a viewer's own log could give and telemetry is off.

## 8 · Against the earlier proposal

Kept from [`what-a-view-asks-for.md`](what-a-view-asks-for.md): one rule and not two modes; W from the budget and
the frame's size, not from the modality; the client arbiter before any wire change; its implementation steps 2
(the page view sends a want), 3 (a frame memory that frees: without it a window bounds bytes, not memory) and 5.

Kept too: "link rate stays out": no estimate enters the hold (§4).

Differs: the window's place (under no skip a scroll's window is the leg just crossed whatever the split, so the
hold lets go behind first while the reader moves and is centred while the reader dwells, not three quarters
ahead); `waitAhead` k = 8 as a default (not for DBT); M from `deviceMemory` (abandoned, S7); equal memory shares a
viewport (by need); and the reader's target apart from the display's frame. *Corrected 2026-11-22 (ASK-MODEL-FIX):
the first version differed here by a window behind by ρ̂ and took the link rate into the hold; both are struck.*

## 9 · For the owner, through the `asking` page

1. **The rule of §4**, as the design of *what a view asks for*: yes or no. Its hold changes the store as built in
   one case only: while the reader moves it lets go behind first; while the reader dwells it stays centred. A yes
   queues a protocol row for §7 (P1 and P1b decide the hold) and, after it, the two structural steps the earlier
   proposal already names (the page view's want; a freeing memory).
2. **Contradiction 1**: no slice skipped for DBT and ultrasound stacks, in a scroll and in a cine; the stride ADR
   corrected in place as not holding where S1 binds. And the reading of a scroll bar's thumb: a scroll or a jump.
3. **The three settings**: `waitAhead` stays off for the scope until P3; `span` and `holdEveryOther` removed.
4. **M3** (PR 96): the one queue moves no time alone; with the shallow commitment it deletes client code and makes
   the server's queue the want. The two together, the window alone, or neither.
5. **The budget M**: a deployment setting defaulting to 256 MiB, assumed, until a phone session reads the limit.

## 10 · What it would reopen, and builds nothing on

* The coded-bytes tier and frames held at the screen's size (§3.3): "An OPFS cache …, no re-decoding" (2026-10-10)
  and "no low-resolution preview" ([`../design.md`](../design.md) §Decided).
* The one queue removes "the downloader re-asks the rest of a fill on the asked frame's head" (*the rule*,
  2026-10-15). A want that replaces the server's queue drops what is not yet written, which
  [`../../adr/reject-server-cancel.md`](../../adr/reject-server-cancel.md) rejected as a server-side cancel; the
  order stays the client's, so [`../../adr/reject-server-ordering.md`](../../adr/reject-server-ordering.md) stands.

Amendment 22 (only a lost ask is asked again) is untouched: the want re-lists a miss, it does not retry a refusal.

## Where it holds, and its limits

**Fixtures: none used.** The measured numbers quoted are earlier rows': `ct_lidc` and `dbt10_ea1141` on 5 and
20 Mbit/s links through a relay, Chromium and Firefox headless, 4-core cloud hosts without a GPU, which voided up to
a third of their visits; `dbts_b1` of one DBT dataset; one phone on one home link behind the decode ranges; no
breast ultrasound cine, no reader, no radio.

**To DBT stacks:** §3.1 and §3.4 hold by S1 itself. §5's turns rest on one study's abstract, "a type of vigorous
drilling strategy" (S6); its leg lengths, and whether readers dwell before a turn (P1b), are unknown. §5's
numbers are a simulation of the model, not a measurement. **To ultrasound clips:** they fit
memory and are played, so the rule is the cine's (§4.1) and the hold never acts; that a breast ultrasound study is
many short clips makes §4.2's order across series its main part, and no source for that order was found.
**Not known:** M on any device; ρ on any phone but one; whether S1's rule is the right one for ultrasound scrubbing,
which no profile read here covers.

## 11 · Sources

Fetched 2026-11-22; sha256 of the file as fetched.

* **S1** IHE Radiology Technical Framework, Volume 2 (IHE RAD TF-2), "Revision 23.0 Final Text, August 8, 2025",
  §4.16.4.2.2.1.3.9 *Scrolling through Multi-frame Tomosynthesis Images* (lines 6170–6197),
  `https://www.ihe.net/uploadedFiles/Documents/Radiology/IHE_RAD_TF_Vol2.pdf`,
  `23b6e028b038ac7cedd0af958057b9be07c342d4ea42866d463189ec982e35ad`.
* **S2** The same, §4.16.4.2.2.6.9 *Cine* (line 6947), under §4.16.4.2.2.6 *Display of Images for Basic Image
  Review*: the Basic Image Review profile, not a DBT or ultrasound requirement.
* **S3** Android 16 Compatibility Definition, §2.2.7.3, the Media Performance Class requirements ([7.6.1/H-2-1], in
  full: "MUST have at least 8 GB of physical memory, with at least 6.64 GB available to the kernel as reported by
  android.app.ActivityManager.MemoryInfo.totalMem") and §2.2.1 ([7.6.1/H-0-2]: "MUST return "true" for
  ActivityManager.isLowRamDevice() when there is less than 1GB of memory available to the kernel and userspace"),
  `https://source.android.com/docs/compatibility/16/android-16-cdd`. The page is dynamic: its footer reads "Last
  updated 2026-08-04 UTC" and its body "Last updated: December 2, 2025", and its sha differs on each fetch
  (`f38fc852…` on 2026-11-22 by ASK-MODEL, `d4231f1e…` by its review, `0b74583c…` by ASK-MODEL-FIX); the quotes
  were found verbatim each time.
* **S4** Diaz et al., "Eye-tracking of nodule detection in lung CT volumetric data", Med Phys 2015;42(6):2925-32,
  the abstract, PubMed 26127046 (`eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=26127046`),
  `8282edb7c3d6c1aa64b01247be93e8a5d5ffaa884893d6321ccb126b69ddcfba`: "The scrolling speed of the naïve observers
  and the radiologists at the moment the signal was detected was measured at 25-30 fps."
  Three naïve observers and three radiologists; abstract only.
* **S5** Beard et al., "Eye movement during computed tomography interpretation", J Digit Imaging 1994;7(4):189-92,
  the abstract, PubMed 7858015, `3d96e53ba91a550ca0d74df5f533ba1a38a6013c23cf1a91a38bfba1a2ecdb65`: "Adjacent eye
  movements (+/- 1 image in sequence) averaged 0.54 seconds." Film, not a stack.
* **S6** Aizenman et al., "Comparing search patterns in digital breast tomosynthesis and full-field digital
  mammography: an eye tracking study", J Med Imaging 2017;4(4):045501, doi 10.1117/1.JMI.4.4.045501, the abstract,
  `eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=5658515` (the publisher withholds the body from
  that form), `8f699f7408adbbcdc899e6d22962376af895e1b26ee6fc2476df72b4c7a6611c`, fetched 2026-11-22 by
  ASK-MODEL-FIX: "Eleven radiologists examined eight DBT and FFDM cases"; "we found DBT viewers did not align with
  previously identified “driller” or “scanner” strategies, although their search strategy most closely aligns with
  a type of vigorous drilling strategy." The body's "3.8 image slices" and "sawtooth" are **not verified** (the
  article page answered an automated-client check); quoted as
  [`how-viewers-and-readers-ask.md`](how-viewers-and-readers-ask.md) recorded them on 2026-10-28.
* **S7** W3C, *Device Memory API*, "W3C Discontinued Draft, 20 October 2026",
  `https://www.w3.org/TR/2026/DISC-device-memory-1-20261020/` (fetched as `https://www.w3.org/TR/device-memory/`),
  *Status of this document*, `9101a1a4c32a6e0d4261c8295521e870ecf2b90999661708d13c6f24235a46d3`.

Not read: the ACR–AAPM–SIIM practice parameter and AAPM report 260 (quoted in the files linked above, not here).
