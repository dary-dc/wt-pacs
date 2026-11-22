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
latest *after subtracting the time the pipeline would take to bring it back*. The transport commits (writes where
no later ask can pass) no more than keeps the link busy. A fill, an ask, a cine run, a window and an arbiter over
several series are this rule at different parameter values; none is a mechanism of its own (§4).

Four things follow that no earlier text here states:

1. **With no slice skipped, the order inside each direction needs no model of the reader.** The display reaches
   frame c + 2 only through c + 1, so nearest-first on each side is never worse (§3.1). The whole ordering problem
   is one merge of two lists.
2. **A reader who goes back and forth wants the memory window behind, not ahead.** The earlier proposal assumed
   three quarters of the window ahead. For a sawtooth, which is what the DBT source describes, the longest leg with
   no wait is (W − 1) ÷ (1 − ρ²) frames when what is behind is kept, against a quarter of (W − 1) ÷ (1 − ρ) with the
   window three quarters ahead: ×2–4 shorter, 4 ÷ (1 + ρ) (§5; ρ is the pipeline's rate over the reader's).
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
* Sources for the scroll: readers of DBT "scrolled through 3.8 image slices during a single fixation" and make
  "sawtooth plots as the observer moves back and forth through the stack multiple times" (S6, as this repository
  recorded it; not refetched); lung CT readers scrolled at "25-30 fps" at detection, against their own "subjective
  estimate of 5 frames per second" (S4); adjacent looks on film "averaged 0.54 seconds" (S5). So v runs from about
  2 to 30 frames a second, and a scroll is a sawtooth whose leg length no source gives **(unknown)**.

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
               scroll: s → p first, then ahead of p to the lead's depth, then behind and ahead in turn.
hold           over the budget, let go the frame with the largest need − bring-back.
               cine: the frame just shown is the farthest on the path.  scroll: a frame ahead at distance δ counts
               as δ ÷ ρ̂, a frame behind as δ.  dwell and after a jump: ρ̂ = 1, the window is centred.
commit         no more than keeps the link busy; never ask a frame committed to arrive sooner than the ask would.
show           the next frame on the path once held and painted; none passed over (S1).
```

ρ̂ is the one estimate: frames that arrived a second while the pipeline was busy, over the reader's steps a second
while scrolling, both seen by the client in this session, capped at 1. It needs no table of devices or links, and
by this repository's rule for estimators a constant ships instead if it does as well (§7, P1's control arm).

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
right when the misses will each arrive before their turn: frame j of the misses ahead at j ÷ μ against its place on
the path ÷ r. With h frames held ahead of n this holds when **h ≥ n × (1 − ρ)** (D, ρ = μ ÷ r); otherwise the cine
stalls at the hole however it is started. Then there are two honest behaviours, and the modality picks:

* **wait, then play at the clip's rate**: for ultrasound, where the rate is the acquisition's ("The default shall
  be the frame rate specified in the DICOM attributes, if present", S2) and a slowed clip misstates motion;
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

## 5 · Where the window sits: behind, by how much

Let a scroll be a sawtooth of legs ℓ frames long at v, the window W, and ρ < 1 (at ρ = 1 the pipeline keeps up and
only the lead's depth matters). At a turn, what is held behind becomes the buffer ahead. With a tail of β frames
kept, the reader crosses them while the pipeline adds ρ a frame, so the leg with no wait is **β ÷ (1 − ρ)** (D).
During it the frames fetched ahead reach ρβ beside the β kept, so β = (W − 1) ÷ (1 + ρ) is the most the budget
allows, and the split is ρ ahead to 1 behind: the rule's δ ÷ ρ̂.

| what is kept at a turn | longest leg with no wait (T) | W = 15, ρ = 0.22 | W = 15, ρ = 0.8 |
| --- | --- | ---: | ---: |
| all ahead (the ascending want alone) | the lead's depth | ~0 | ~0 |
| three quarters ahead ([`what-a-view-asks-for.md`](what-a-view-asks-for.md) §4, assumed) | (W − 1) ÷ 4(1 − ρ) | 4.5 | 17.5 |
| centred (the store as built, `client/view/store.js`) | (W − 1) ÷ 2(1 − ρ) | 9.0 | 35 |
| by the rule, ρ ahead to 1 behind | (W − 1) ÷ (1 − ρ²) | 14.7 | 38.9 |
| a leg of at most W − 1 frames, by the rule | any: the leg is held whole after one pass, nothing asked again | 14 | 14 |

A reader who never turns reverses the table: all ahead gives (W − 1) ÷ (1 − ρ) and the rule's split less. That
reader is a cine, whose path the client knows, which is why the rule asks the mode and not a guess.

**What ρ is on a phone** for the `dbts_b1` view (3.71 Mbit a frame), at a reader's 25 frames a second (D, from
[`../../decode/mobile/device-model.md`](../../decode/mobile/device-model.md) §4's effective decode and
[`../../transport/link-profiles.md`](../../transport/link-profiles.md)'s goodputs):

| | μ, frames a second | ρ at 25 |
| --- | ---: | ---: |
| decode-bound, premium phone (33–48 ms) | 21–30 | 0.84–1 |
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
| P1 | `dbts_b1` view, W = 15, a sawtooth of 12 frames at 25 a second, ρ ≈ 0.22; arms: three quarters ahead, centred, the rule, the rule with ρ̂ fixed at 1 (the control) | wait a leg after the first pass: 1.09 s, 0.44 s, 0; bytes received after the first pass: 0 for the rule only | the rule's wait is over the A/A spread above 0, or the order of the three differs |
| P1b | the same with legs of 20 | 2.25 s, 1.6 s, 0.77 s a leg | the rule is not the shortest |
| P1c | the same at ρ ≥ 0.8 | every arm within the A/A spread | any arm differs: ρ does not carry the split |
| P2 | a one-way cine over W < n, the same arms | the order reverses: all ahead shortest | the rule's hold wins a path that never turns |
| P3 | `waitAhead` k ∈ {1, 4, 8, 16, 32} on today's server: `ct_lidc`, `dbt10_ea1141`, the `dbts_b1` view | the forward wait falls until k ≈ C ÷ b (38, 11, 13) and is flat after | a minimum at one k across frame sizes, or the DBT cells again worse at k < 11 with C read at 6 MiB (then the model of C is wrong, and why is the finding) |
| P4 | the same under the window that follows cwnd | k from 1 to 32 within the A/A spread | any k differs |
| P5 | a cine at the clip's rate on `usb_cine` and `us_liver`, links with ρ < 1; started at once against gated at h ≥ n(1 − ρ̂) | gated: no stall after the first step; at once: stalls, all of them at the first hole | a gated cine stalls, or the ungated one does not |
| P6 | two series, a client arbiter, each session's commitment shallow against deep | shallow: the focused series' forward wait within its single-series A/A; deep: later by about the other's C ÷ G | the two tie |
| P7 | every visit of P1–P5 | the held frames of a series are one interval at every sample; a mutant hold that lets go the nearest fails it | a hole appears without a failed check |

What a cloud run cannot decide: M on a phone and where a tab dies; ρ on a phone (the decode); the leg lengths of
real readers, which only a viewer's own log could give and telemetry is off.

## 8 · Against the earlier proposal

Kept from [`what-a-view-asks-for.md`](what-a-view-asks-for.md): one rule and not two modes; W from the budget and
the frame's size, not from the modality; the client arbiter before any wire change; its implementation steps 2
(the page view sends a want), 3 (a frame memory that frees: without it a window bounds bytes, not memory) and 5.

Differs: the window's place (behind by ρ̂, not three quarters ahead); `waitAhead` k = 8 as a default (not for DBT);
M from `deviceMemory` (abandoned, S7); equal memory shares a viewport (by need); "link rate stays out" (it enters
the hold as ρ̂, measured in the session, and never sets W); and the reader's target apart from the display's frame.

## 9 · For the owner, through the `asking` page

1. **The rule of §4**, as the design of *what a view asks for*: yes or no. A yes queues a protocol row for §7 and,
   after it, the two structural steps the earlier proposal already names (the page view's want; a freeing memory).
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

**To DBT stacks:** §3.1 and §3.4 hold by S1 itself. §5 holds if DBT readers go back and forth, which rests on one
study recorded here and not refetched (S6), and its leg lengths are unknown. **To ultrasound clips:** they fit
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
* **S2** The same, §4.16.4.2.2.6.9 *Cine* (line 6945).
* **S3** Android 16 Compatibility Definition, "Last updated 2026-08-04 UTC", §2.2.7.3 ([7.6.1/H-2-1], in full: "MUST
  have at least 8 GB of physical memory, with at least 6.64 GB available to the kernel") and §2.2.1 ([7.6.1/H-0-2]:
  "MUST return "true" for ActivityManager.isLowRamDevice() when there is less than 1GB of memory available to the
  kernel and userspace"), `https://source.android.com/docs/compatibility/16/android-16-cdd`,
  `f38fc85202b24c98594dce16779333ba122589e5530e7f68176bec25c8cc1c13`.
* **S4** Diaz et al., "Eye-tracking of nodule detection in lung CT volumetric data", Med Phys 2015;42(6):2925-32,
  the abstract, PubMed 26127046 (`eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=26127046`),
  `8282edb7c3d6c1aa64b01247be93e8a5d5ffaa884893d6321ccb126b69ddcfba`: "The scrolling speed of the naïve observers
  and the radiologists at the moment the signal was detected was measured at 25-30 fps." Three radiologists; abstract only.
* **S5** Beard et al., "Eye movement during computed tomography interpretation", J Digit Imaging 1994;7(4):189-92,
  the abstract, PubMed 7858015, `3d96e53ba91a550ca0d74df5f533ba1a38a6013c23cf1a91a38bfba1a2ecdb65`: "Adjacent eye
  movements (+/- 1 image in sequence) averaged 0.54 seconds." Film, not a stack.
* **S6** Aizenman et al., J Med Imaging 2017;4(4):045501 (PMC5658515): **not refetched** (the site answered an
  automated-client check, its API an error); quoted as [`how-viewers-and-readers-ask.md`](how-viewers-and-readers-ask.md)
  recorded it on 2026-10-28. A review fetches it or strikes §5's reliance on it.
* **S7** W3C, *Device Memory API*, "W3C Discontinued Draft, 20 October 2026",
  `https://www.w3.org/TR/2026/DISC-device-memory-1-20261020/` (fetched as `https://www.w3.org/TR/device-memory/`),
  *Status of this document*, `9101a1a4c32a6e0d4261c8295521e870ecf2b90999661708d13c6f24235a46d3`.

Not read: the ACR–AAPM–SIIM practice parameter and AAPM report 260 (quoted in the files linked above, not here).
