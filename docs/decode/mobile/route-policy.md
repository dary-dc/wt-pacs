# Choosing a route on a phone: one for all, one per device class, or one per session

*Queue row ROUTE-POLICY, 2026-11-22 (`claude/work-ledger:docs/queue-2026-11-14.md`). Theory and sources; nothing
built, run or timed. It generates policies and questions premises; it does not re-derive the option files beside it
([`README.md`](README.md)). Every choice stays the owner's.*

**The question.** Across the phones and links a reader may have, how does the product choose what it sends and how
it decodes?

Labels: **(S)** a source quoted verbatim, listed in §9 with its URL, section and revision; **(R)** a result of this
repository, by its file; **(M)** measured in the phone round of 2026-11-22
(`claude/phone-run:docs/phone-rows/next-round-results.md` at `093bd105`; one phone, one link, one evening; its
re-review and PHONE-READ-CODE-CHECK were not done when this was written); **(D)** derived here, the arithmetic
written out; **(T)** theory; **(A)** an assumption, named so that a measurement can replace it. Fixtures and
limits: §10.

Words used below, all defined elsewhere: *the view* is the optimal-quality AV1 series, *the exact series* its HTJ2K
pair ([`../../glossary.md`](../../glossary.md)); arms A (the view alone), B (the exact series alone), C1 and C2 are
the delivery comparison's (`claude/delivery:docs/client/evidence/delivery-comparison.md` §1); the device classes are
`claude/unified:docs/decode/mobile/device-model.md` §4's price bands; the link profiles are
`claude/unified:docs/transport/link-profiles.md` §1's.

## 1. What it shows

* **The choice has one inequality under it, and it needs two numbers a fill already measures.** The exact series
  fills faster than the view when the session's goodput is above *an exact frame's bits ÷ the view's effective
  decode time* (§3, D). Both terms are read from the first group of any view fill. The exact series' own decode
  time does not enter the choice; it only bounds the gain.
* **That threshold moves by ×10 across device classes and by ×1.4–2.4 between two series on one phone** (§3, D on M):
  53–191 Mbit/s on an entry phone, 220–521 at the top, and on the round's phone 251–408 Mbit/s for `dbts_b1` against
  590 for `dbts_a1`. A route fixed per phone, or per class, is wrong for some series on every phone. The series is a
  variable no option file had.
* **A table per device class cannot be keyed** (§4.3): what a page can read of its device does not separate the
  classes, and the one API made for it is a discontinued draft (S2). A class is known only by measuring a decode,
  which is the per-session policy.
* **The policy nobody listed is a split, not a switch** (§4.6, T). A decode-bound fill leaves the link idle and a
  wire-bound fill leaves cores idle. Asking each group in the form that spends the idle resource (the exact frames
  when bytes wait for a decoder, the view when decoders wait for bytes) uses both, needs no threshold, table or
  goodput estimate, and has arms A and B as its two ends. Predicted on the round's phone: 36 ms a `dbts_b1` frame at
  200 Mbit/s against the view's 42 and the exact series' 86 (D on M and A); up to 32 % under the better pure route.
  The band where it gains, from 54–88 up to 666–910 Mbit/s on that phone, holds the median home Wi-Fi, public
  Wi-Fi and 5G sub-6 profiles. A pure switch gains only above 251–408 Mbit/s.
* **A probe before the fill is dominated** (§4.4): it spends a round trip and a frame of each form to learn what the
  fill's first group reports unasked.
* **The first picture and the fill do prefer different routes, in a band** (§2.3, D): the exact frame is the faster
  first picture above 96–264 Mbit/s on the round's phone, below the fill's threshold.
* **The decoder count is a property of the form, not of the phone** (§2.4, M): the view saturated at three decoders,
  HTJ2K gained 18 % from a fourth.
* **Who pays is the owner's question, and it has a price** (§2.2, D on M): on the round's link arm B bought 1.94 s
  of fill for 84 MB more on `dbts_b1` and 0.24 s for 63 MB more on `dbts_a1`.
* **A leaning, labelled as one** (§7): the view first, as today, on every phone; the fill measures itself and the
  rule of §3 is evaluated but only *reported* until a cloud row has tested the split's model. No table, no probe.

## 2. The premises, each questioned

### 2.1 That one route must serve every phone

It need not, and cannot serve all equally (`device-model.md` §5: "The slower the phone, the lower the goodput at
which the exact series alone is the faster fill"). The round confirmed the shape on one phone: B faster than A in 15
of 15 rounds at ≥ 568–595 Mbit/s (M), where the model had predicted a tie. But "per phone" is itself too coarse:
§3 shows the threshold differs as much between two series on one phone as between two classes.

### 2.2 That the choice is between codecs, not between who pays

Each stored form turns two scarce goods into frames at a different rate. Per `dbts_b1` frame (R, M, D):

| form | bits on the wire | core time on the round's phone | precision | stored at ingest |
| --- | --- | --- | --- | --- |
| the view (AV1, Q 8 G 8) | 3.71 Mbit (0.2161 of exact, R) | 42.1 ms effective at three decoders, which is where it saturates (M) | 10 bits; the depth cut above 10 (R) | today, 0.07–0.22 of the exact bytes at Q 8 (R, three volumes) |
| the exact frame (HTJ2K) | 17.19 Mbit (R) | 18.9 ms effective at three decoders, 15.5 at four (M) | the stored depth, bit for bit | today |
| the exact frame's level 1 prefix ([`htj2k-preview.md`](htj2k-preview.md)) | 25.8–29.0 % of the exact frame (R) | ×0.27–0.31 of the exact frame's (R, cloud; T on a phone) | exact at its level; failed the visually lossless proxy at display scale (R) | the same bytes; level offsets and a digest per level not built |

So the payer differs by regime, not by codec. Where the wire binds, bytes are scarce and the view is 4.6–14.6×
cheaper (R). Where the decode binds, the phone's cores are scarce and the exact frame is 2.2× cheaper (D: 42.1 ÷
18.9, M). The reader pays in wait and, on a metered link, in data; the server pays in egress (the value statement's "lowest server and network cost per reading session",
`claude/work-ledger:docs/queue-2026-11-14.md` amendment 27); precision is paid only by the view. Arm B's price on the round's link (D on M and R):

```
dbts_b1: fill 3.68 − 1.74 = 1.94 s saved for 107 410 134 × (1 − 0.2161) = 84.2 MB more   (23 ms a MB)
dbts_a1: fill 1.20 − 0.96 = 0.24 s saved for  67 815 186 × (1 − 0.0742) = 62.8 MB more   (3.8 ms a MB)
```

The extra bytes are not extra if the reader would have asked for the exact frames anyway
(`claude/vl-criterion:docs/av1/vl-criterion.md` on what the view may claim). Whether a second saved is worth 43 to
260 MB is not a measurement.

### 2.3 That the first picture and the fill need the same route

They do not (D). The first picture is start + first unit's bits ÷ *G* + one frame on one decoder + a paint. The
view's first frame is a key frame of about the average size (R: Q 8 G 1 is 0.2186 of exact against G 8's 0.2161) and
takes one decoder 109–181 ms on the round's phone; the exact frame takes 40–59 ms (M, cell 1's per-decoder times).
The exact frame is first when

```
G > (17.19 − 3.71 Mbit) ÷ (the view's frame − the exact frame, one decoder each)
  = 13.48 ÷ (181 − 40 … 110 − 59 ms) = 96 … 264 Mbit/s on the round's phone        (D on M)
```

which is under the fill's threshold (251–408 Mbit/s, §3). Between the two the best first picture is the exact frame
in view and the best fill is the view. The split (§4.6) does this without a rule of its own; any other policy
needs one, and one more ask. Below ~96 Mbit/s nothing is gained.

### 2.4 That the decoder count is fixed

`client/transport/downloader.js` takes `min(3, navigator.hardwareConcurrency || 3)` for every form (R). On the
round's phone the view's fourth decoder was 10 % *slower* (42.1 → 46.2 ms) and HTJ2K's fourth 18 % faster (18.9 →
15.5 ms) (M). One AV1 decoder runs many threads (`av1-software.md` §2) and one HTJ2K decoder one, so the count that
saturates is the form's. Three choices: keep one count (today); a count per form (HTJ2K one more than the view, A
beyond this phone); or add a decoder while the last one shortened the effective time by more than 10 %, within the
fill. In a wire-bound fill none of them matters. Each is a default, so the owner's.

### 2.5 That a per-session measurement conflicts with "no per-browser-version defaults"

The decision as recorded (`claude/unified:docs/decode/README.md`, *keyParse, measured and not adopted*): "**Not
adopted** (the owner, 2026-11-04): no default may depend on the browser version; it adds a code path that applies
only at G = 1; and it regressed `dbts_b1` at 4× in Chromium 156."

* **Its letter: no conflict.** A session measurement reads no version, model or name. It reads how long this
  session's frames took.
* **Its first reason, staleness: the measurement serves it and a class table breaks it.** A table of classes is a
  default per device, stale the way a default per version is (§4.3).
* **Its second reason, a code path that few sessions take: this does bind.** Every route a policy can pick is a path
  whose fixtures and limits must be stated (the same line of 2026-11-04). So a policy is cheaper the fewer paths it
  adds. Switching between the view and the exact series adds none to the decode: both fills exist. The split adds
  one to the asking. Hardware painting adds a decoder route and a stored form.
* **What a measurement costs that a default does not**: two sessions on one phone may take different routes, so a
  result must name the route each load took (the round's rows already do), and the switch needs a margin so that it
  does not flap (§4.5).

## 3. The rule under every policy

Per frame: *b* its bits, *d* its effective decode time (per-decoder time ÷ decoders), *G* the goodput. A fill costs
max(*b* ÷ *G*, *d*) a frame plus a rest (`delivery-comparison.md` §4.1; the rest was 0.25–0.45 s, M). With E the
exact frame and V the view, *b*_E > *b*_V always, and *d*_E < *d*_V on every phone class the model covers
(`device-model.md` §4; M on one phone). Three goodputs follow (D):

```
G_A = b_V ÷ d_V   below it both fills are wire-bound; the view wins by its bytes
G*  = b_E ÷ d_V   above it the exact series fills faster than the view:  b_E ÷ G < d_V
G_B = b_E ÷ d_E   above it the exact series is decode-bound too; nothing more is gained
```

*G*\* needs *G* and *d*_V only. Both are observed in the first group of a view fill: bytes over time while the
decoders are not yet the limit, and the group's decode times.

Per class, `dbts_b1` (*b*_E 17.19, *b*_V 3.71 Mbit). *d* is `device-model.md` §4's band at three decoders; its upper
end is multiplied by the round's fill ÷ bench ratio, ×1.36 for HTJ2K (25.8 ÷ 18.9 ms) and ×1.63 for the view (68.6
÷ 42.1 ms), **(A)**: one phone, and the view's ratio is confounded by a renderer that kept earlier loads' memory
(the read, *A grows over the round*).

| | *d*_E (ms) | *d*_V (ms) | *G*_A | ***G*\*** | *G*_B (Mbit/s) |
| --- | --- | --- | --- | --- | --- |
| entry (D on A) | 33–83 | 90–326 | 11–41 | **53–191** | 207–521 |
| middle (D on A) | 15–54 | 41–215 | 17–90 | **80–419** | 316–1146 |
| premium (D on A) | 14–31 | 33–78 | 47–112 | **220–521** | 550–1228 |
| the round's phone, bench … in a fill (M, D) | 18.9 … 25.8 | 42.1 … 68.6 | 54–88 | **251–408** | 666–910 |
| the round's phone, `dbts_a1` in a fill (M, D) | 11.1 | 16.4 | 44 | **590** | 875 |

```
round's phone, dbts_b1:  in a fill  d_V = (3.68 − 0.25) ÷ 50 = 68.6 ms   d_E = 1.29 ÷ 50 = 25.8 ms
                         G* = 17.19 ÷ 0.0686 = 251     17.19 ÷ 0.0421 = 408 Mbit/s
round's phone, dbts_a1:  b_E = 542.5 ÷ 56 = 9.69 Mbit   b_V = 0.0742 × 9.69 = 0.72 Mbit
                         d_V = (1.20 − 0.28) ÷ 56 = 16.4 ms   d_E = 0.62 ÷ 56 = 11.1 ms   G* = 9.69 ÷ 0.0164 = 590
entry:   G* = 17.19 ÷ (0.200 × 1.63) = 53 … 17.19 ÷ 0.090 = 191     the other rows the same way
```

What the table says:

* **The same phone has two thresholds, 251–408 and 590 Mbit/s, for two series.** `dbts_a1` is a 12-bit series whose
  view is its depth cut at 0.074 of the exact bytes and a quarter of `dbts_b1`'s decode. The read's 596 Mbit/s for
  it is this number.
* **Entry phones are where the route matters most and is known least**: *G*\* reaches down into the public Wi-Fi and
  LTE profiles, on bands no phone has tested (`device-model.md` §6).
* The measured link (≥ 568–595 Mbit/s, M) sat above the phone's *G*\* for `dbts_b1` and at it for `dbts_a1`, as
  the 15 of 15 and the two medians (0.513, 0.771) say.

## 4. The policies

What each must store, what the wire or client must gain, and how it fails on a device the model does not cover.
"Structural" names what `CLAUDE.md` makes a proposal first. The wire is `claude/unified:docs/WIRE.md`'s: a session
names one series by its URL (§Naming the series), so two forms are two sessions, as the viewer's exact downloader
already is (`connectExact`).

| policy | stored at ingest, beyond today | wire | client | fails, on an uncovered device, as |
| --- | --- | --- | --- | --- |
| 4.1 the view always (today) | nothing | nothing | nothing | the slow fill it has now; never wrong on bytes |
| 4.2 the exact series always, on phones | nothing; the view unused by phones | nothing | the viewer opens the exact series (arm B's path) | 4.6–14.6× the bytes on every wire-bound link, which is most profiles |
| 4.3 a table per device class | nothing | nothing | a classifier and a table to maintain | a wrong class, silently, and the same route for every series |
| 4.4 a probe before the fill | nothing (frame 0 of each series) | nothing | a probe step; a second session before the first picture | a start later by the probe on every load |
| 4.5 the fill measures itself, one switch | nothing | nothing | the rule of §3 on the first group; the rest asked from the other series | at worst one group of the view sent and not shown longer than the switch |
| 4.6 a split fill | nothing | nothing | **structural**: the asking picks a form per group from two queues | no worse than the better pure route if its assumption fails (below) |
| 4.7 hardware paints first, software confirms | a form the hardware decoder takes (below) | nothing | a hardware decoder route, an unchecked paint, a replace on confirm | the decoder refusing the size or form, found at configure or flush; then 4.1 |

### 4.1 The view always

Today's product, with the exact frame on request. Right on every wire-bound link. On a decode-bound phone it is
the slowest fill of the seven and the slowest first picture above ~96 Mbit/s. It costs nothing and is the control.

### 4.2 The exact series always, on phones

Fastest above *G*\*, and the only policy whose every frame is exact with no ask and no claim to word. Below *G*\* it
is slower by up to the byte ratio: at LTE's 27–85 Mbit/s a `dbts_b1` fill is 10–32 s against the view's 2.4–7.3 s on
a premium phone (§5). "On phones" needs the page to know it is on a phone, which is 4.3's problem in small.

### 4.3 A table per device class

A table needs a key. What a page can read:

* The core count: "The `navigator.hardwareConcurrency` attribute's getter must return a number between 1 and the
  number of logical processors potentially available to the user agent" (S1). It counts cores, not fast cores: the
  round's premium phone read 8 (M), and the model's classes differ in how many of the cores are fast (2 or 4, or 5
  and more, `device-model.md` §4), which the count does not show.
* Memory: `deviceMemory` is rounded to a power of two between "an implementation-defined minimum bound" and "an
  implementation-defined maximum bound", and "The range between the upper and the lower bounds should include the
  majority of device memory values but exclude rare device memory values to mitigate device fingerprinting" (S2).
  The round's phone read 8 (M). The document is a "W3C Discontinued Draft, 20 October 2026" (S2).
* The model: "The Sec-CH-UA-Model request header field gives a server information about the device on which a given
  user agent is executing" (S3). A table keyed by model strings is the device database S2's introduction names as
  the thing to avoid ("Such solutions frequently rely on commercial device databases, which are costly, hard to
  integrate, and hard to maintain."), and model names in a public repository are the owner's to allow.

None of the three orders phones by decode speed. A table keyed by a *measured* decode time is 4.5 with coarser
steps. And a class fixes one route for all series, which §3 shows wrong on the round's own phone. Dominated.

### 4.4 A probe before the fill

As the brief words it: one frame of each stored form decoded and timed, the goodput from the first bytes, the arm
picked by the inequality. It works, and it costs every load, including the majority where the answer is "the view":
a second session's start (3 round trips and 20 ms, A, `delivery-comparison.md` §4.3), one exact frame's 2.15 MB
(0.64 s at 27 Mbit/s, D), and one frame of each form on a cold decoder, which the round showed is not the fill's
time (one view decoder alone took 176 ms a frame, each of three 110 ms, M, unexplained). §3 says the probe's third
measurement, *d*_E, does not enter the choice. So the probe measures more than the rule needs, less faithfully than
the fill does, before the first picture. Dominated by 4.5.

### 4.5 The fill measures itself, one switch

Start every series as the view. From the first group: *G* from its bytes and arrival times, *d*_V from its decode
times at the decoder count in use. If *G* > *m* × *b*_E ÷ *d*_V, ask the remaining frames from the exact series;
else go on. *m* is a margin over 1 **(A, to be chosen by a run)**: the rule is exact only if the measured *G*
persists, and a fill that is decode-bound paces the wire by the decoders' credits, so its observed rate is a floor
on *G*, not *G* (`device-model.md` §2: such fills "bound nothing"). The first group's bytes arrive before any credit
is spent, which is why the first group, not the fill's average, is the reading.

* One switch a series, never back: after the switch *d*_E is observed, and if the exact fill is slower than the
  view was (a device where *d*_E > *d*_V, outside the model), the next series starts and stays as the view.
* The session keeps its last reading for the next series; nothing is kept between sessions, so nothing goes stale.
* Wrong start costs at most the first group: 8 frames, 3.7 MB on `dbts_b1` (D), all of them shown.
* It adds no decode path. It changes a default, so the owner's; its rule and margin want a cloud test of *G*'s
  reading under credits first.

### 4.6 A split fill: each group asked in the form that spends the idle resource

Between *G*_A and *G*_B a pure route wastes something. The view leaves the link idle (it needs 88 of 200 Mbit/s on
the round's phone); the exact series leaves cores idle (it waits for bytes). A fill that sends a share *x* of its
groups as exact frames and the rest as the view, with both the wire and the cores busy, takes a frame (D)

```
wire:   b_V + (b_E − b_V) x = G t          cores:  d_V − (d_V − d_E) x = t
t = (b_E d_V − b_V d_E) ÷ (G (d_V − d_E) + (b_E − b_V))            for G_A ≤ G ≤ G_B

round's phone, bench, dbts_b1 (ms a frame):
G (Mbit/s)        100    200    300    408    600
the view          42.1   42.1   42.1   42.1   42.1
the exact series  171.9  86.0   57.3   42.1   28.7
the split         41.4   36.1   32.0   28.5   23.9     (x = 0.03, 0.26, 0.44, 0.59, 0.78)
```

The gain peaks at *G*\*, where the pure routes tie and the split is 32 % under both (28.5 against 42.1 ms).

* **No threshold is needed to run it.** The client already knows which resource is idle: bytes waiting for a
  decoder mean the link is ahead, so the next group is asked as exact frames; decoders waiting for bytes mean the
  cores are ahead, so the next group is asked as the view. That converges on *x* and follows a link that changes
  mid-fill (a handover), which no start-of-session choice does. Arms A and B are its ends, reached on their own
  where they are right.
* **Its assumption (A): decode times add.** The formula takes a core-second spent on one form as lost to the
  other. The round suggests better than that: Chrome used at most 2.7–3.3 of the phone's 8 cores in a fill (M, a
  partial sum), and the view saturated at three decoders while HTJ2K still gained from a fourth. If an HTJ2K decoder
  runs on cores the view leaves idle, the split is faster than the table; if the forms contend worse than linearly,
  slower, and it falls back to the better pure route. Not measured anywhere.
* **What it costs.** Structural in the asking: two queues and a form chosen per group, on the two sessions that
  exist; `claude/ask-model:docs/client/evidence/ask-model.md` owns what a view asks and in what order, and a split
  must fit its rule. On screen, frames of one series carry different labels (exact, optimal quality), which the
  label already does per frame. Bytes: between the view's and the exact series', by *x*.
* **The exact frame's level 1 prefix is a third form in the same rule** (§2.2's table): fewer bits than the exact
  frame and less core time than the view on `dbts_b1`. It reaches 1 of 19 volumes upright on a phone and failed the
  quality proxy (`htj2k-preview.md`); phase 2's fit arm measures it. The rule does not change: ask the form that
  spends what is idle.

### 4.7 Hardware paints first, the checked software frame confirms

Acceptable, not ideal (amendment 23). What the round adds (M, one phone, 256 × 256 units only): the hardware AV1
decoder was allocated and its codec list declares up to 8192 × 8192 (the list's section inferred); full-range 4:2:0 frames decoded (8-bit exact, 10-bit returned as 8
bits, off by one on 19 480–49 002 of 65 536 samples a channel); **4:0:0 frames failed at flush**. The view is
stored 4:0:0 (`claude/unified:docs/av1/payload-format.md`: "The ingest keeps 4:0:0").

* **Stored**: the view as full-range 4:2:0, either instead of 4:0:0 (+0.20–0.23 % bytes at 8 bits, R, the form
  *not adopted* on Chromium's software cost) or beside it (the view's bytes again, 0.07–0.22 of exact).
* **Gains**: the first paint and each scrolled frame at the hardware decoder's time, unmeasured at a volume's size
  (≤ 31.1 ms a `dbts_b1` frame if the decoder takes it, D, [`README.md`](README.md)); 8 bits on screen until the
  software frame lands.
* **Does not gain**: the fill of *checked* frames, which is still the software decode; and it paints unchecked
  frames, the owner's to allow (amendment 1).
* **Fails as**: a decoder that refuses the size (no phone is promised one above 1080p, [`README.md`](README.md) §3
  item 4), found at configure or at the first flush.
* It composes with any of 4.1–4.6 as a first-paint layer; it is not an answer to which bytes to send.

## 5. Predicted ranges, per device class and link profile

All derived; none measured except where marked. `dbts_b1`, 50 frames, three decoders. A profile's *G* is what
`link-profiles.md` §2 says "a session might see"; enterprise Wi-Fi has no number and no row.

**Fill** (s) = max(50 × *b* ÷ *G*, 50 × *d*) + rest, rest 0.22–0.45 s (M: 0.25–0.45), *d* from §3's table. The
split's column is §4.6's formula, on assumption (A).

| profile, *G* (Mbit/s) | class | the view | the exact series | the split |
| --- | --- | --- | --- | --- |
| LTE, 27–85 | entry | 4.7–16.8 | 10.3–32.3 | 4.1–13.7 |
| | middle | 2.4–11.2 | 10.3–32.3 | 2.4–10.3 |
| | premium | 2.4–7.3 | 10.3–32.3 | 2.4–7.3 |
| public Wi-Fi, 101 | entry | 4.7–16.8 | 8.7–9.0 | 3.9–7.4 |
| | middle | 2.3–11.2 | 8.7–9.0 | 2.2–6.3 |
| | premium | 2.1–4.4 | 8.7–9.0 | 2.1–3.8 |
| home Wi-Fi median, 218 | entry | 4.7–16.8 | 4.2–4.6 | 3.0–4.6 |
| | middle | 2.3–11.2 | 4.2–4.4 | 1.9–4.1 |
| | premium | 1.9–4.4 | 4.2–4.4 | 1.7–3.0 |
| 5G sub-6, 284–771 | entry | 4.7–16.8 | 1.9–4.6 | 1.9–4.6 |
| | middle | 2.3–11.2 | 1.3–3.5 | 1.2–3.4 |
| | premium | 1.9–4.4 | 1.3–3.5 | 1.1–2.7 |
| home Wi-Fi, measured, 600 | entry | 4.7–16.8 | 1.9–4.6 | 1.9–4.6 |
| | middle | 2.3–11.2 | 1.7–3.2 | 1.3–3.2 |
| | premium | 1.9–4.4 | 1.7–2.0 | 1.3–2.0 |
| | the round's phone | **3.68** (M) | **1.74** (M) | 1.4–1.8 |
| 5G mmWave, 1 467 | entry | 4.7–16.8 | 1.9–4.6 | 1.9–4.6 |
| | middle | 2.3–11.2 | 1.0–3.2 | 1.0–3.2 |
| | premium | 1.9–4.4 | 0.9–2.0 | 0.9–2.0 |

```
entry, public Wi-Fi:  the view  max(185.7 ÷ 101, 50 × 0.090 … 0.326) + 0.22 … 0.45 = 4.7 … 16.8 s
                      exact     max(859.3 ÷ 101, 50 × 0.033 … 0.083) + 0.22 … 0.45 = 8.7 … 9.0 s
                      split     50 × t(101; 33, 90 … 83, 326 ms) + 0.22 … 0.45      = 3.9 … 7.4 s
```

* The widths are the class model's, not the links': the view's column spans ×3.6 on an entry phone at any *G* above
  41 Mbit/s. A second phone narrows this table more than any link measurement (§6).
* Mid-table (public and median home Wi-Fi, 5G sub-6) neither pure route wins on every class: the view on premium,
  the exact series on entry, an overlap in the middle. That is the band where a fixed route is wrong for someone.
* The mmWave row assumes its goodput reaches one session; Cubic's loss bound may make it a wire-bound row
  (`link-profiles.md` §2).

**First picture** (ms) = start + first unit's bits ÷ *G* + one frame on one decoder + 17 for the paint. Start is 3
round trips + 20 ms (A, `delivery-comparison.md` §4.3). One frame on one decoder: the exact frame per
`device-model.md` §4's fast-core row; the view's 3 to 4.3 × its effective time at three decoders (D on M: 110 and
181 ms against 42.1), an (A) outside the round's phone.

| | start | + the view's wire | + the exact frame's wire |
| --- | --- | --- | --- |
| LTE, 27–85 Mbit/s, 38 ms | 134 | 44–137 | 202–637 |
| public Wi-Fi, 101, 20 ms (A) | 80 | 37 | 170 |
| home Wi-Fi median, 218, 10 ms | 50 | 17 | 79 |
| 5G sub-6, 284, 26 ms (A) | 98 | 13 | 61 |
| home Wi-Fi, measured, 600, 2 ms | 26 | 6 | 29 |
| 5G mmWave, 1 467, 56 ms | 188 | 3 | 12 |

| one frame, one decoder (ms) | entry | middle | premium | the round's phone (M) |
| --- | --- | --- | --- | --- |
| the view | 270–860 | 123–568 | 99–206 | 109–181 |
| the exact frame | 100–143 | 46–94 | 37–59 | 40–59 |
| the exact frame is first above (Mbit/s, §2.3's rule) | 18–106 | 26–465 | 80–337 | 96–264 |

On an entry phone the exact frame is the faster first picture from 18–106 Mbit/s up, so on most profiles: the
decode difference (127–760 ms) outweighs the wire's.

**Exact-frame latency** (the press to *✓ Lossless*), after a fill, on an idle session. Under 4.2, and for every
frame a split or a switch delivered exact, it is **zero**: nothing is asked. Under the view it is
`link-profiles.md` §2's round trips plus one exact frame on one decoder plus the paint:

| | the wire's part (`link-profiles.md`, D) | premium | middle | entry |
| --- | --- | --- | --- | --- |
| home Wi-Fi, measured | ~0.04 s | 0.09–0.12 s | 0.10–0.15 s | 0.16–0.20 s |
| home Wi-Fi median | ~0.13 s | 0.18–0.21 s | 0.19–0.24 s | 0.25–0.29 s |
| LTE | ~0.5 s | 0.55–0.58 s | 0.56–0.61 s | 0.62–0.66 s |
| 5G mmWave | 0.25–0.5 s | 0.30–0.58 s | 0.31–0.61 s | 0.37–0.66 s |

**The round missed this model**: 216.5 ms on `dbts_b1` and 126.5 ms on `dbts_a1` (M) on the measured home link,
against 0.09–0.12 s here and DEVICE-THEORY's 80–130 ms. The 0.10–0.12 s over is unexplained (hypotheses, not
checked: cores clocked down after the fill, as the lone view decoder's 176 ms suggests; the harness's press path).
Until it is, every cell of this table is a floor, and the premium column carries +0.10–0.12 s on the one phone
measured.

## 6. The one measurement on a second phone

**Cell 1 of `next-round.md` on a middle-band phone with two fast cores**, as `device-model.md` §6 named before the
round, and the round's read strengthens it. Every threshold of §3 is *b*_E ÷ *d*_V, and *d*_V is the widest input:
41–215 ms in the middle band and 90–326 ms at entry (×5.2 and ×3.6), on two assumptions no phone has tested (the
slow core's share, the view's doubling). The round's phone could test neither: it has five fast cores. Cell 1 needs
static HTTPS only and about 28 loads (`device-model.md` §7's routes).

One arm added to it would decide the split before anything is built: **the view at three decoders and HTJ2K at one
and two, decoding together in memory**, against each alone. If the two effective rates add, the split is at least
§4.6's table; if the view's rate holds while HTJ2K's is added, it is better; if their sum falls below the view's
alone, the split is dead and only the switch remains. The same arm on the round's phone costs four loads.

## 7. A leaning, labelled as one

* **Keep the view first on every phone (4.1), and make the fill report §3's two numbers**, *G* from the first group
  and *d*_V, with the route §3 would have picked, in the load record the round's harness already writes. That is a
  lab change, decides nothing, and turns every later phone or cloud load into a test of the rule and its margin.
* **No table per class and no probe** (4.3, 4.4): each is dominated by the fill's own reading.
* **The switch (4.5) before the split (4.6)**, and neither as a default until measured: the switch adds no decode
  path and its rule is one inequality; the split is the better policy on paper, on more of the population, and
  structural. A cloud host can test the split's formula on the wire side and the idle-resource rule's convergence
  (two cores for the browser, a relay under 90 Mbit/s, software decode; never a phone's place on it); §6's arm tests
  its assumption on a phone.
* **A decoder count per form** (§2.4) is the cheapest measured gain here (18 % of HTJ2K's decode floor on one
  phone) and wants cell 1's second phone before it is a default.
* **Hardware painting (4.7)** stays an option for the first paint; the round moved it from "unknown" to "needs a
  4:2:0 form" on one phone.

**What this would reopen** among the decided approaches: nothing by the leaning. The exact series always (4.2), or a
switch or split that reaches *x* = 1, serves a phone without the view; "AV1 only for cine-like series" and "optimal
quality plus the exact HTJ2K frame on request" (2026-11-09) stand as written but would describe fewer loads. The
level prefix as a third form touches "no low-resolution preview"; it is named here, not proposed.

**The owner's**: whether seconds are worth bytes, and at what rate (§2.2); any default that changes (the route, the
decoder count); the split, as structural; unchecked paints (4.7).

## 8. Rows a yes would queue (not appended: phase 2's plan is PHASE2-PLAN's)

1. The fill's record carries *G* from its first group, *d*_V and the route §3 picks (lab; with its test, mutated).
2. A cloud protocol for the split and the switch: the formula of §4.6 and the idle-resource rule against arms A and
   B on the delivery comparison's rig, predictions pre-registered from that host's own K1–K3.
3. §6's together-in-memory arm in the next phone round's cell 1.

## 9. Sources

Fetched 2026-11-22; each pinned by the SHA-256 of the bytes served.

* **S1** WHATWG, *HTML Standard*, "Living Standard — Last Updated 22 November 2026",
  <https://html.spec.whatwg.org/multipage/workers.html>, §10.2.7 *Concurrent hardware capabilities*; sha256 `68f1b80a4d3d1c6b2826f31e5e89e770401f7062dc1d408e070dcaa1af9c8471`.
* **S2** W3C, *Device Memory API*, "W3C Discontinued Draft, 20 October 2026",
  <https://www.w3.org/TR/2026/DISC-device-memory-1-20261020/> (served at <https://www.w3.org/TR/device-memory/>),
  §1 *Introduction* and §2 *Computing device memory value*; sha256
  `9101a1a4c32a6e0d4261c8295521e870ecf2b90999661708d13c6f24235a46d3`.
* **S3** WICG, *User-Agent Client Hints*, "Draft Community Group Report, 26 October 2026",
  <https://wicg.github.io/ua-client-hints/>, §3.8 *The 'Sec-CH-UA-Model' Header Field*; sha256
  `8bc3c11181cee5679b32a1fa6b7aeb5c98d74372c7ac8e26e2d90e964fe53f9d`.

**Read, not quoted**: WICG's *Network Information API* (<https://wicg.github.io/netinfo/>, served as unrendered
source with no date): its `downlink` is an estimate "based on recently observed application layer throughput across
recently active connections", so not this session's path to this server; the policies here read *G* from the fill
itself. **Not read**: any engine's source for how it bounds `deviceMemory` or schedules decoder threads; no reading
rate (ASK-MODEL's file owns it).

## 10. Fixtures and limits

Nothing measured by this row. Behind every (M): one premium phone (Android 16, Chrome 157, eight cores of which five
fast), one home Wi-Fi link at ≥ 568–595 Mbit/s with the server one hop away, one evening, two DBT volumes of one
dataset (`dbts_b1`, 50 frames, 10-bit; `dbts_a1`'s cut, 56 frames, 12-bit), the view at Q 8 G 8 only, software
decode, 15 paired rounds a volume less two void loads; no wire time was recorded, so no fill's regime was read. The
read behind them was reviewed and fixed once; its re-review and the check of which code each load ran were open.
Behind the classes: `device-model.md`'s model, whose HTJ2K bands held on that phone and whose view bands missed at
one and four decoders; no entry or middle phone, no iPhone, no second engine. Behind the profiles: other people's
measurements and one standard's targets, none of a reader in a hospital. Behind the split: one formula on one
assumption, tested nowhere. No breast ultrasound: a clip's frames are 8-bit and smaller, so both *b*_E ÷ *b*_V and
*d*_V differ, and §3's rule carries by its form only, with no number.
