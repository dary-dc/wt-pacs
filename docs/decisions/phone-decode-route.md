# How a phone decodes a series, and on which phones

Written 2026-11-22 by row PHONE-ROUTE-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none
of this question's rows, from pushed results only; nothing run. Inputs at: `claude/mobile-decode` `d3f6d3892`
(`docs/decode/mobile/route-policy.md`, ROUTE-POLICY, at `75d11fcd4`/`6eb0ac322`; `docs/decode/mobile/README.md` §1, §2,
§6 and §6.1 as MOBILE-DECODE-REJUDGE left them at `30f9757b`; the option files beside them; PR 397's body
§ROUTE-POLICY-REVIEW, no blocker, minors m1–m5 carried below); `claude/unified:docs/decode/mobile/device-model.md`
(DEVICE-THEORY, PR 414) §4–§7; `claude/phone-run:docs/phone-rows/next-round-results.md` at `1e9f1714` (PHONE-READ,
fixed and re-reviewed, no blocker open); `claude/reviews-2026-11-18:docs/reviews-2026-11-18.md` §2–§3 (B1).
PHONE-READ-CODE-CHECK (whether each load of the 2026-11-22 round ran the run commit's client) was done 2026-11-23
07:34 (`claude/phone-run` `2b242245`): every load carries fields only the newer code writes, no load set apart, no
result corrected; 18 of 29 changed modules leave no field, so that much is not established. Read again 2026-11-23 by
row DECISION-PAGES-FIX under the owner's word of 2026-11-23 ~02:00 (the program, amendment 28: "for the next demo, we
will accept hardware decoding and not checking"; `docs/decisions/README.md` §Review B1): items 6 and 9 changed, §7
names the reopen. Read again 2026-11-24 by row PHONE-CARRY (`claude/work-ledger:docs/queue-2026-11-24.md`): no mark
**provisional**; PHONE-READ, -FIX, -CODE-CHECK, PHONE-READ-3D and its review are carried as they stand, and §8.1
names the PHONE-ROUND-2 cell each open item waits for.

Labels: **source** (quoted in the file named), **theory**, **derived**, **measured**; **(A)** an assumption named so
that a measurement can replace it. *The view* is the optimal-quality AV1 series, *the exact series* its HTJ2K pair
([`../glossary.md`](../glossary.md)); arms A (the view) and B (the exact series) are the delivery comparison's.

## 1 · The question

Across the phones and links a reader may have, how does the product choose what it sends and how it decodes: one
route for all, one per device class, or one chosen per session from a measurement? And, as its own call (B1): is a
checked 8-bit hardware view ever acceptable? Under the owner's word of 2026-11-23 ~02:00 a hardware view need not be
checked, so B1 becomes: in which form would a hardware view run, unchecked? Both are the owner's: each answer is a default, a structural change to
the asking, or a trade of the reader's seconds against bytes the server and the reader pay for, which no
measurement can price.

## 2 · The recommendation, and the owner's yes or no

**Keep the view first on every phone, with no class table and no probe; make the fill report the one inequality that
would switch it, and test the switch and the split in the cloud before either is a default; answer B1 no for now,
with lossy HTJ2K (M17) asked first, and build no 8-bit form now that a hardware view may run unchecked; measure the
4:2:0 form a hardware view needs before any hardware route; send cell 1 to one middle-band phone through a
real-device cloud.**

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | The view first on every phone stays the route (policy 4.1); no table per device class (4.3), no probe before the fill (4.4) | **yes** | nothing in the product; 4.3 and 4.4 closed as dominated | an open policy question on every phone page |
| 2 | The fill's load record carries *G* from its first group, *d*_V and the route §5's rule would pick (lab, with its test, mutated) | **yes** | one phase 2 Opus row (`route-policy.md` §8 item 1); every later load tests the rule | the rule stays untested on real fills |
| 3 | A cloud protocol for the switch (4.5) and the split (4.6) against arms A and B on the delivery rig, predictions pre-registered from that host's own K1–K3 | **yes** | phase 2 rows (protocol, build, review, run); amendment 28 rule 2 lets it run without a further word, no product code | the split stays one formula on one untested assumption |
| 4 | Arm B's bytes are bought for fill seconds by default on phones (B on, or a switch made a default) | **no, for now** | — | bytes stay the payer: 1.94 s for 84 MB on `dbts_b1`, 0.24 s for 63 MB on `dbts_a1` (**derived** on **measured**) not taken until item 3's run |
| 5 | A decoder count per form (HTJ2K one more than the view) as a default | **no, for now** | — | `min(3, hardwareConcurrency)` for every form; decided after cell 1 on a second phone |
| 6 | **B1**, read again under the word: a hardware view, unchecked, is built as a phone route; of its forms, the 10-bit stream in 4:2:0 (not the two 8-bit forms, whose only purpose was a check) | **no, for now** (**changed** reason: the check no longer binds the view, so no 8-bit form is needed; what blocks a hardware view now is its form, measured only at 256 × 256) | — | the view in software at 10 bits (the depth cut above), checked where it can be ([`frame-integrity.md`](frame-integrity.md) item 6); M5 at a volume's size (item 7) decides whether the 4:2:0 form decodes, and at what depth it reaches the painter; amendment 16's 8-bit fallback stays on paper |
| 7 | M17 (lossy against lossless HTJ2K, in memory) and M5 at a volume's size (a form other than 4:0:0) go into PHONE-ROUND-2 | **yes** | two asks in its preparation rows (PHASE2-PLAN) | the one result that questions whether AV1 stays the phone's view stays unmeasured |
| 8 | Cell 1 on one middle-band phone with two fast cores, through a real-device cloud (AWS Device Farm's free trial; the account is the owner's to open) | **yes** | the owner opens the trial; one phase 2 row writes the run; static HTTPS, public fixtures, no patient data | the class table stays **derived**, ×3.6–5.2 wide in its view column |
| 9 | Hardware paints first, unchecked, the software frame confirms (4.7) | **no** (**changed** reason: the confirming software decode pays a second decode a frame for a check the word no longer asks of the view, so 4.7 is dominated by hardware alone, item 6) | — | 4.7 closed; the hardware view, unchecked, waits for item 7's M5 as item 6 says |
| 10 | The held AV1 rows (§Trimmed; `README.md` §6.1): the decode audit's three checks **released**; GROUPS-SHARD2 held until M17; NOISE-RATIO-RUN held (the view claims nothing, `visually-lossless.md`); TILES-STEP held behind M13; the other codecs' and the strips' byte cells held until a second phone's M4 and item 7's M5 | **yes, as listed** | the audit's checks queued in phase 2 (no encoding; DELIVERY-RUN's model quotes the view's cloud decode) | all six stay held; PROGRAM-CLOSE lists them |

**How it serves the value statement** (amendment 27 item 7): "a fast first picture, a fast full fill, and low latency
on every jump" pull toward the exact series on fast links; "the lowest server and network cost per reading session"
pulls toward the view. Item 1 keeps the cheaper payer; items 2–3 measure how many seconds the dearer one buys, per
session, so the trade is priced before it is made. "Every frame the reader asks to see exactly is the original, bit
for bit, and checked" is about the exact frame, which every policy here keeps checked; a view decoded in hardware
would be unchecked (the word), a recorded disadvantage against the exact series (4.2) and against DELIVERY-FIT-ARM,
the HTJ2K-only control of phase 2 (amendment 28), every frame of which is exact and checked.

## 3 · The options

**The route policies** (`route-policy.md` §4, its numbers on `dbts_b1`, 50 frames, three decoders):

| policy | stored beyond today | client | fill on the round's phone, home Wi-Fi ~600 Mbit/s | fails, on an uncovered device, as |
| --- | --- | --- | --- | --- |
| 4.1 the view always (rec., today) | nothing | nothing | **3.68 s** (**measured**) | the slow fill it has now; never wrong on bytes |
| 4.2 the exact series always | nothing | arm B's path | **1.74 s** (**measured**); 10–32 s at LTE's 27–85 Mbit/s against the view's 2.4–7.3 on a premium phone (**derived**) | 4.6–14.6× the bytes on every wire-bound link (**derived**: 1 ÷ three volumes' Q 8 ratios, `payload-format.md`) |
| 4.3 a table per class | nothing | a classifier and a table | as 4.1 or 4.2 per class | no readable key orders phones by decode speed (`hardwareConcurrency` counts cores, `deviceMemory` is a discontinued draft, a model string is a device database: **source**, its S1–S3); one route for every series, wrong on the round's own phone |
| 4.4 a probe before the fill | nothing | a probe step, a second session | the better of 4.1 and 4.2, later by a start (3 round trips + 20 ms, A) and one exact frame (2.15 MB, 0.64 s at 27 Mbit/s, **derived**) | every load pays; measures *d*_E, which the rule does not use |
| 4.5 the fill measures itself, one switch | nothing | the rule on the first group | the better of the two plus at most one group (8 frames, 3.7 MB) at the view's rate (**derived**) | a margin *m* (A) to choose; *G* under credits is a floor |
| 4.6 a split fill | nothing | **structural**: a form chosen per group from two queues | **1.4–1.8 s** (**derived**, on assumption A: decode times add) | no worse than the better pure route if A fails |
| 4.7 hardware paints, software confirms | a 4:2:0 form (+0.20–0.23 % bytes instead of 4:0:0, or the view's bytes again beside it, **source**) | a hardware route, an unchecked paint | the checked fill unchanged; the first paint unmeasured | the decoder refusing size or form; 4:0:0 failed at flush (**measured**, 256 × 256) |
| 4.8 hardware decodes the view, unchecked (the word) | the same 4:2:0 form | a hardware route; the check skipped for it | unmeasured: *d*_V on hardware not measured at a volume's size | as 4.7; on the round's phone 10-bit forms came back as 8-bit `RGBA` (cell 4, below), so the painter windows 8 bits a sample, not the stored 10 |

**The threshold under every policy** (`route-policy.md` §3): the exact series fills faster when *G* > *b*_E ÷ *d*_V.

| | *d*_E (ms) | *d*_V (ms) | *G*\* (Mbit/s) | *G*_B (Mbit/s) |
| --- | --- | --- | --- | --- |
| entry (**derived** on A) | 33–83 | 90–326 | 53–191 | 207–521 |
| middle (**derived** on A) | 15–54 | 41–215 | 80–419 | 316–1146 |
| premium (**derived** on A) | 14–31 | 33–78 | 220–521 | 550–1228 |
| the round's phone, `dbts_b1` | 18.9 (**measured**), 25.8 (**derived**: 1.29 s ÷ 50) | 42.1 (**measured**), 68.6 (**derived**: (3.68 − 0.25) s ÷ 50) | 251–408 (**derived**) | 666–910 |
| the round's phone, `dbts_a1`'s cut | 11.1 (**measured**) | 16.4 (**measured**) | 590 (**derived**) | 875 |

**B1, the 8-bit question, both forms** (`reviews-2026-11-18.md` §2–§3; `README.md` §2 on `claude/mobile-decode`):

| form | levels on screen | bytes against today's view | checked | where it runs | on the round's phone |
| --- | --- | --- | --- | --- | --- |
| today's view, software | the stored depth ≤ 10, the depth cut above | 1× | yes | every engine | 42.1 ms effective (**measured**) |
| a hardware frame inverted, studio swing (needed only for a check, which the word drops) | 220 (7.78 bits), ~200 with the headroom luma needs; 4.67 source units a step at 10 bits, 18.70 at 12 (**derived**) | **1.16–2.49×** (**measured**, 19 volumes) | yes, against an 8-bit luma digest | Android Chromium and Firefox, if the map is one-to-one (a device fact) | an 8-bit full-range unit came back exact at 256 × 256; no volume-size frame tried (**measured**) |
| the 8-bit cut, read back as `NV12` (likewise) | 256 | **1.14–1.86×** (**measured**, DEPTH8-MEASURE) | yes | desktop Chromium; Safari by `NV12` (its decoder unconfirmed, **theory**) | not on Android: frames come back as `RGBA` (**source**, **measured**) |
| lossy HTJ2K (not 8-bit; the alternative for the same band) | the stored depth, no cut | median **1.05×** (0.85–1.47) at the noise rule's bar (**measured**) | yes, by the one WASM build's digest | every engine with WASM SIMD | 21.2–22.9 ms effective (**derived** on A: the cloud's 1.12–1.21 × lossless's 18.9) |

Ten bits did not come back from hardware on that phone: the 10-bit forms returned as 8-bit `RGBA`, off by one on
19 480–49 002 of 65 536 samples a channel (**measured**, cell 4, 256 × 256 only). So an unchecked hardware view of the
10-bit stream (the word) puts 8 bits a sample on screen on that phone, and window/level would act on those; whether
that is acceptable is a question the word does not answer, and item 6 waits on it with M5.

**Real-device routes for cell 1** (`device-model.md` §7, **source** for costs): AWS Device Farm, "one-time free trial
of 1,000 device minutes", "$0.17 per device minute"; cell 1 on 20 phones at 15 min ≈ $51 (**derived**), within the
trial. Firebase Test Lab, "30 minutes of test time per day on physical devices" free, but built for apps (a wrapper
not built). A public bench page opened by colleagues (no cost; uncontrolled state, needs a host and a consent line).
The product's own load report (telemetry off, rate 0; `reports.md`). Each sends the page's address, the public
fixtures and timings outside, no patient data.

## 4 · Where it holds

**Fixtures and limits.** One premium phone (Android 16, Chrome 157.0.8103.78, eight cores of which five fast), one
home Wi-Fi link at ≥ 568–595 Mbit/s of goodput (a lower bound), the server one hop away, one evening; two DBT volumes
of one dataset (`dbts_b1`, 50 frames, 10-bit; `dbts_a1`'s cut, 56 frames, 12-bit), the view at Q 8 G 8 only, software
decode; cell 2's fills with a renderer that kept earlier loads' memory; cell 4 at 256 × 256 units only; no wire time
recorded, so no fill's regime was read. Bytes: 19 DBT volumes of one dataset. Cloud ratios: 4-core hosts without a
GPU, headless Chromium. No iPhone, no second engine on a phone, no entry or middle phone, no breast ultrasound cine.

**The population**, carried by `device-model.md` §4 (price bands of 2025 shipments: entry 40.6 %, middle 38.3 %,
premium 21.1 %, **source**/**derived**) and `route-policy.md` §3. Its tested predictions, misses included:

* HTJ2K's bands **held** at every decoder count (premium fast core 37–59 ms predicted, 40.4 measured).
* The view's bands **missed** at one decoder (176 ms, slower than each of three at 110) and at four (10 % slower
  than three); so the *d*_V column, the widest input, is the least trusted.
* Arm B against arm A: a tie predicted at the round's link; B faster in **15 of 15** rounds, median 0.705 (**measured**).
* The exact-frame latency: 80–130 ms predicted, **216.5 ms** measured on `dbts_b1` (126.5 on `dbts_a1`); the
  0.10–0.12 s over is unexplained, so every latency below is a floor.
* `htj2k-software.md`'s own 78–127 ms a frame (**theory**) missed: 40.4 measured on one decoder.

**US and DBT stacks** (amendment 27 item 6). DBT: measured on two volumes, carried to the 19 by bytes and to the
classes by the model. Breast ultrasound clips: the rule (*G*\* = *b*_E ÷ *d*_V) carries **by its form only**: a clip's
8-bit, smaller frames change both *b*_E ÷ *b*_V and *d*_V, so no threshold is known (no US clip run; `usb_cine` exists, lossy-sourced). For B1, a US
clip is 8-bit already: the 10-bit question does not arise, and under the word a hardware route needs no inversion
(it would have served a check); its frames still come back as RGB (**source**), so a colour clip's hardware view is
the closest of any series to what software paints (**theory**). Whether a clip's software decode is fast enough
without hardware is not yet known.

**Links** (`../transport/link-profiles.md` §2, other people's measurements and one standard's targets): the profiles'
*G* sit across every class's *G*\*, which is why no fixed route is right everywhere (§5).

## 5 · The mechanism

A fill costs max(wire, decode) a frame plus a rest. The view is cheap on the wire (0.07–0.22 of the exact bytes) and
dear on the phone's cores (42.1 against 18.9 ms effective on the one phone); the exact series is the reverse. So the
exact series wins exactly when the link carries an exact frame in less than the view takes to decode one:
*G* > *b*_E ÷ *d*_V. Both terms are in the first group of any view fill, which is why a class table (no readable key)
and a probe (measures more, less faithfully, before the first picture) are dominated by the fill reading itself. The
threshold differs ×1.4–2.4 between two series on one phone and ×10 across classes, so the choice is per series and
session, not per phone. Between *G*_A and *G*_B each pure route leaves one resource idle; asking each group in the form
that spends the idle one (the split) uses both and needs no threshold, if two forms' decodes add (A). The 8-bit
question is a separate axis: hardware hands a browser an image, not samples, so a check needs an 8-bit form the
picture maps back to one-to-one, at 1.14–2.49× the bytes. Under the word the check is not asked of the view, so that
cost goes; what stays is the image itself: 8 bits a sample on the one phone tried. Lossy HTJ2K reaches the same
decode band at the stored depth at about the view's bytes, checked, if the cloud's ratio carries to the phone.

## 6 · What would change the recommendation

* **Item 3's run** shows the switch's rule holds under credits and the split's formula on the wire side: items 4 and
  the split (structural) come back as a default with a measured price per second.
* **Cell 1 on a middle-band phone** (item 8) narrows *d*_V (×5.2 wide today); one arm added (the view at three
  decoders and HTJ2K at one and two, decoding together in memory, `route-policy.md` §6) decides the split's
  assumption: rates add, it holds; their sum below the view's alone, the split is dead and only the switch remains.
  It decides item 5 too.
* **M17 fails** (lossy HTJ2K's decode not under the view's on the phone): the hardware view (M5, then M6–M7) is
  weighed again, unchecked under the word, so the 220-level form is no longer first.
* **M5 at a volume's size** (item 7): the 4:2:0 form decoding in hardware on the phone, with the depth it reaches the
  painter, makes item 6 a build question (policy 4.8) with a measured *d*_V on hardware, which moves *G*\* up.
* **A browser ships plane access** (WebCodecs `P010`, WebGPU's planes): 10 bits come back on hardware and B1 is moot.

## 7 · What it would reopen

**Amendment 1's "every frame checked", for the view.** The owner's word of 2026-11-23 ~02:00 reopened it for a view
decoded in hardware; items 6 and 9 are read under it here, and nothing further is reopened by the recommendation. A
yes to item 6's hardware view would show the view at 8 bits a sample on a phone like the round's (cell 4), which
touches "the view ≤ 10 bits" and "10 bits on hardware the goal, 8 bits the fallback" (amendment 16) by the picture,
not the stream; the 8-bit forms, no longer needed for a check, would reopen "no 8-bit preview" (2026-11-10) and are
not proposed. Item 4's yes, or a switch reaching *x* = 1, leaves "AV1 only for
cine-like series" and "optimal quality plus the exact HTJ2K frame on request" standing but describing fewer loads.
The level-1 prefix as a third form (`route-policy.md` §4.6) touches "no low-resolution preview"; named, not proposed.

## 8 · Rows and links

**Carried from ROUTE-POLICY-REVIEW (PR 397's body), not yet corrected in `route-policy.md`:** m1, the view's
one-decoder time is 2.6–4.3 × its effective time measured, not 3–4.3, so "the exact frame is first above" reads
18–146 (entry), 26–1027 (middle), 80–495 Mbit/s (premium), not 18–106, 26–465, 80–337 (**derived**; the round's
phone's 96–264 unaffected). m2, `dbts_a1`'s cut is 0.0685 of exact: *b*_V 0.66 Mbit, *G*_A 40 Mbit/s, 63.2 MB more
(used in §2 item 4); *G*\* unchanged. m3, the first picture and exact-frame latency per policy are not computed as
ranges: 4.1 is §5's view column, 4.2 the exact column, 4.4 the better of them plus a start and an exact frame's wire,
4.5 the view's, 4.6 and 4.7 have no number. m4, PHONE-READ-CODE-CHECK open (above). m5, the HTJ2K fill factor ×1.36
may be the receive path, not decode; it moves only *G*_B's lower ends and the exact column's upper ends. (m4 is
closed: PHONE-READ-CODE-CHECK done 2026-11-23, no load set apart.)

### 8.1 · What still waits for a phone (PHONE-CARRY, 2026-11-24)

Each item against the cells PHONE-ROUND-2-PREP's brief carries (`claude/phone-run-2:docs/phone-rows/round-2.md`,
not yet written); the round is the owner's local session.

| item | waits for | cell |
| --- | --- | --- |
| 6, 9 (the hardware view, unchecked) | M5 at a volume's size, the depth it reaches the painter | PHONE-ROUND-2, item 7's M5 |
| 7 (M17, M5) | the two asks themselves | PHONE-ROUND-2, item 7's M17 and M5 |
| 5 (decoders per form), 8, the class table's *d*_V | cell 1 on a second phone | §Middle-band phone (MIDDLE-PHONE-RUN, the owner's account), not PHONE-ROUND-2 |
| 10 (the byte cells held) | a second phone's M4 and item 7's M5 | §Middle-band phone and PHONE-ROUND-2's M5 |
| the exact frame's 216.5 ms against 80–130 predicted (§4) | a cause | **no cell asks it** in PHONE-ROUND-2-PREP's brief: named for that row |

**The round's code bounds the view's memory** (PR 435, on `claude/unified` since UNIFIED-SYNC-1124 `b7cc007f7`, which
`claude/phone-run-2` merges). **Theory, from the code, not run:** `memoryWindow` gives 15 frames on `dbts_b1` (2560 ×
3328 at two bytes), and with no cache the fill asks no more than the window; the round page's `fillFailure`
(`claude/phone-run:lab/devices/round.mjs`) fails a load that "received" fewer than the series' `frameCount`. So a
viewer fill (cells 2 and 3; cell 1 is the bench) of `dbts_b1` on that code fails as written, and a fill that passes is
not the 11-22 fill this page's 3.68 s and 1.74 s measured. PHONE-ROUND-2-PREP's dry run decides it; the bound's size
at two values (its brief) needs a lab setting `claude/unified` does not have (`viewer.js` passes no budget).

Rows: DEVICE-THEORY, -REVIEW, -FIX, -FIX-REVIEW (PR 414); PHONE-ROUND (the owner's local session), PHONE-READ,
-REVIEW, -FIX, -FIX-REVIEW, MOBILE-DECODE-REJUDGE (client queue); ROUTE-POLICY, ROUTE-POLICY-REVIEW (PR 397); earlier,
MOBILE-DECODE-OPTIONS, the MOBILE-OPT rows, MOBILE-DECODE-COMPARE and its fix, AV1-HW-CHIPS, HTJ2K-PREVIEW-MOBILE
(PR 397), DEPTH8-MEASURE (PR 389), HW-DECODE-DEEP (PR 387), HW10-ROUTES (PR 392); PHONE-READ-CODE-CHECK
(`claude/phone-run` `2b242245`).
Files: `claude/mobile-decode:docs/decode/mobile/route-policy.md`, `…/README.md` §6, §6.1, the option files;
`claude/unified:docs/decode/mobile/device-model.md`; `claude/phone-run:docs/phone-rows/next-round-results.md`;
[`../transport/link-profiles.md`](../transport/link-profiles.md), [`../av1/payload-format.md`](../av1/payload-format.md),
[`../WIRE.md`](../WIRE.md); [`visually-lossless.md`](visually-lossless.md), [`reports.md`](reports.md),
[`paused-lines.md`](paused-lines.md).

## Review (PHONE-CARRY-REVIEW, 2026-11-24)

By a session that wrote none of this page or of PHONE-CARRY. Read: PHONE-CARRY's `87e3867ba`, `b77ba07ba`, `138b35022`,
`a962ba03f`; against `origin/claude/unified` `b059388b6`, `claude/phone-run-2` `21c8102b0`
(`docs/phone-rows/round-2.md`, written by PHONE-ROUND-2-PREP at 13:09, after PHONE-CARRY), the status files named.
Nothing run but git reads and `scripts/check_links.py` (17 unresolved, as before).

**Checked and holding.** No mark **provisional** on the page (grep). `memoryWindow` on `dbts_b1`: ⌊2²⁸ ÷ (2560 × 3328 ×
2)⌋ = ⌊15.75⌋ = 15 frames (**derived**; 10 of 16 bits stored, `docs/FIXTURES.md`, so two bytes a sample); `viewer.js`
on unified constructs the `Controller` with no `budget`; `#fillSize()` is the window with no cache; the round page's
`fillFailure` compares `frames.length`, and `ledger()` lists the store's keys, i.e. the frames held, so a fill of
`dbts_b1` at the default fails it (**theory, from the code**, as the page says). Items 5, 8 and 10's middle-band cell
matches `round-2.md` §Middle-band phone (item 8). The 216.5 ms against 80–130 is §4's. PHONE-READ-3D concerns cell 3
only, so "carried as it stands" adds nothing here, correctly.

* **B1. §8.1 sends items 6, 7, 9 and 10 to PHONE-ROUND-2 cells the round does not carry.** The table names "PHONE-ROUND-2,
  item 7's M17 and M5" (and M5 for 6, 9, 10). `round-2.md` §5, *Cells a page asks for that this round does not carry*:
  M17 "no lossy HTJ2K series in `demo-series`; cell 1's bench has no lossy arm"; M5 at a volume's size "`make_hw_units.py`
  at 2048² stops in `ingest.decode` (`av1 decode failed (-2)`, *measured* here)"; "Each needs a build first". So the
  owner reading §2 item 7's yes ("a yes changes: two asks in its preparation rows") and §8.1 would take both asks as
  scheduled; they are not, and no row of `claude/work-ledger:docs/queue-2026-11-24.md` builds either. Fix: §8.1's cells for 6, 7, 9, 10
  read "not in PHONE-ROUND-2 (`round-2.md` §5): needs <its build>", and §2 item 7's *a yes changes* says the
  preparation row found each needs a build; the two builds go to BRIEF-WEEKEND's list for the next queue (no row fits
  before 2026-11-27 20:00 with a phone round after it).
* **m1. The bound paragraph is superseded.** "PHONE-ROUND-2-PREP's dry run decides it; the bound's size at two values
  ... needs a lab setting `claude/unified` does not have": PREP built that setting on `claude/phone-run-2` (`?budget`,
  `313ad1b55`, lab only, the product unchanged without it) and `round-2.md` §2 sets cell 3's budget to the series and
  runs cell M at *w* and 2*w*. Say so; keep the theory label, since `round-2.md` §6 says the 15-frame window "is not
  exercised by the synthetic pair, whose 20 frames all fit".
* **m2. The exact frame's 216.5 ms is "named for that row" and that row did not take it**: `round-2.md` names it
  nowhere, §5 included. It falls through unless carried: to BRIEF-WEEKEND's list, with the cell that would ask it.
* **m3. §8.1 splits §8.** It sits between §8's carried findings and its *Rows:* and *Files:* paragraphs, which now read
  as §8.1's. Move §8.1 after them (or under §6, what would change the recommendation).
* **n1.** "UNIFIED-SYNC-1124 `b7cc007f7`" is the sync's tip, the merge of PR 437, not of PR 435; "the sync's tip" or
  PR 435's own merge commit.
* **n2.** "cells 2 and 3": PHONE-ROUND-2 runs cell 3 and cell M only (`round-2.md` §0).

Verdict: one blocker; PHONE-CARRY-FIX and PHONE-CARRY-FIX-REVIEW appended to the queue (amendment 17). The page's
yes lines in BRIEF-WEEKEND wait on the re-review.
