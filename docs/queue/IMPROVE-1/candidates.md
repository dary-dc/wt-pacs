# IMPROVE-1: candidates, ranked by what the device model predicts

*Row IMPROVE-1 (Fable) of `docs/queue-2026-11-24.md` (amendment 28 item 3.7), 2026-11-24. Reading, a model and
arithmetic; nothing built, nothing timed, no browser run. The code read is `origin/claude/unified` at `b059388b6`;
the device numbers are the 2026-11-22 round's (`claude/phone-run:docs/phone-rows/next-round-results.md` at
`8d77ba2b4`, and its raw rows, read again here per decoder and per frame); the device model is
`docs/decode/mobile/device-model.md` as that round calibrated it. No source outside the repository was fetched: every
statement about a browser's scheduler, compiler or governor below is a* **hypothesis** *and says so. Every choice stays
the owner's.*

Labels: **measured** (the round's rows), **derived** (arithmetic on measured numbers, written out), **model** (the
script beside this file over the product's own modules), **theory**, **hypothesis** (unsourced, to be tested).

## 1. What it shows

1. **The memory window and the AV1 group do not fit each other, and a scroll pays for it** (§2). `dbts_b1`'s window
   is 15 frames and its group is 8. The store holds and lets go single frames; the downloader fetches and decodes
   whole groups. The **model** said a forward scroll over the 50 frames delivers 398 frames, more bytes than the whole
   exact series. *Corrected 2026-11-25 (IMPROVE-1-FIX; §Review B1):* the product, **measured**, delivers fewer: 268
   forward and 280 back on a stand-in wire, and 104–113 frames forward (49.4 MB) on CLEAN and 72–77 (33.7 MB) on LTE
   in the browser; the build cut a pass's bytes ÷ 1.3 to ÷ 3.3, not ÷ 8. Every series larger than 256 MiB decoded is
   in this case. This is the first candidate, and it is a defect of what is built, not a new design.
2. **Three premises of the pages do not hold as stated** (§3, each **derived** from the round's rows):
   * *"The view saturates at three decoders"* holds only in part. The fourth decoder got 8 frames and the first two
     16 each, because 50 frames are 7 groups: the fill's span is the longest decoder's share, 16 frames with four
     decoders and 18 with three, so the group count bounds a fourth decoder's gain at −11 %. A frame's median also
     rose from three decoders to four (108–117 → 111–130 ms; the read's 110.2 → 118.8), eating that gain. Both bind;
     which binds past four is M12's to read. *(Corrected 2026-11-25, §Review m2: this said "the cores were not the
     limit (at most 3.3 of 8)"; the read's 3.32 is a partial sum, a lower bound.)*
   * *"The exact frame's 216 ms is unexplained."* A decoder's first HTJ2K decode takes 42 ms longer than its median
     (20 to 66 ms, 30 decoder starts). Cell 3's "idle 201 ms, busy 120 ms" is the load's first exact request against
     its second, not idle against busy: the harness always asks idle first.
   * *"A jump costs one frame."* A view frame at offset *k* of its group costs *k* + 1 frames of bytes and decode.
     From offset 4 on, `dbts_b1`'s exact frame is fewer bytes than the view's group prefix, on every link.
3. **Nine candidates** (§4), ranked on the first picture, the fill and the jump. **The top three that need no
   unanswered page** each get a build row and a measuring row in `docs/queue-2026-11-24.md`:
   WINDOW-WHOLE-GROUPS, DECODE-OVERLAP, DIAL-BEFORE-PAIR.
4. The largest predicted gain on the jump that *does* need a page (the exact frame serving a jump deep in a group)
   is sized for EXACT-UNASKED and FIT-ARM-PROTOCOL; nothing is built on it.

## 2. The window against the group (model)

`client/view/controller.js` (`b059388b6`): "const VIEW_MEMORY = 256 * 2 ** 20;" and `memoryWindow` returns
`Math.floor(VIEW_MEMORY / (width * height * channels * sample))`. `dbts_b1` is 2560 × 3328 at two bytes: 17.04 MB a
frame, so W = 15 (**derived**). `wantFrom` asks the current frame, then `c + d`, `c − d`: a window centred on the
frame in view, cut at W. `client/view/store.js` `put`: "while (this.#frames.size > this.#budget)
this.#frames.delete(this.#farthest());". `client/transport/downloader.js`: "Every frame of every group `indices`
touch: a group is asked whole, from its keyframe." and "if (m.kind === "ack") return void (m.gen === generation &&
records.delete(m.index));".

So a miss at the window's edge fetches its whole group; the frames of that group beyond the window are the farthest
held and are dropped as they arrive; nothing remembers them; the next step misses the next one and fetches the group
again.

`window-model.mjs` (beside this file) runs the product's `FrameStore` and `wantFrom` against a stand-in downloader
that keeps those two rules and delivers every miss before the next step. Frames delivered for one pass over 50
frames, a step at a time:

| W | G | forward | backward | a step, forward |
| ---: | ---: | ---: | ---: | ---: |
| 15 (`dbts_b1` today) | 8 | **398** | 234 | 7.96 |
| 16 | 8 | 267 | 140 | 5.34 |
| 24 | 8 | 218 | 112 | 4.36 |
| 50 (no bound) | 8 | 50 | 50 | 1.00 |
| 15 | 1 | 50 | 50 | 1.00 |

A window of two or three whole groups' *size* does not cure it (W = 16, 24): the window is centred on a frame, so it
always cuts two groups. The unit that is held, wanted and let go has to be the group.

What it costs a reader (**derived**; the round's phone, `dbts_b1`, view frame 3.71 Mbit, a frame's decode on one
decoder 110 to 176 ms **measured**):

* *Bytes*, the **model**'s: 398 × 0.464 MB = 185 MB for one forward pass, against 23 MB for the 50 frames once and
  107 MB for the whole exact series. **Measured** since (corrected 2026-11-25, §Review B1): the tip's forward pass in
  the browser is 104–113 frames, 49.4 MB, on CLEAN and 72–77, 33.7 MB, on LTE
  (`docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/findings.md` §Timed cells); after the build 34 frames, 15.8 MB, in every
  cell but LTE 1× forward (÷ 1.3 to ÷ 3.3 over the cells). The model overstates because its stand-in delivers every miss whole, where "the real
  downloader replaces a want's unsent asks" (ibid.).
* *The step at the window's edge*: the wanted frame is at offset *k* of its group and waits for *k* + 1 frames on one
  decoder; over *k* = 0…7 the mean is 4.5 frames: 16.7 Mbit and 0.50 to 0.79 s of decode. At ≥ 568 Mbit/s that is
  0.5 to 0.8 s a step; at 27 Mbit/s 1.1 to 1.4 s. A held frame's step was **measured** at 10.5 to 11.4 ms.
* *Other phones* (**theory**, device-model §4): the view's decode is 2 to 4 times slower on an entry phone, so 1 to
  3 s a step.

Limits: a model, not the product run. The real downloader's runs, its `ended` set and its same-want guard are not in
the stand-in; the store, the want and the two quoted rules are the product's. The gate's fixtures are all under
256 MiB decoded or key-frame only, so no gate step meets the case. WINDOW-WHOLE-GROUPS's first step is the failing
product test; if it does not fail, this section is wrong and the row says so. *Found since (2026-11-25):* it failed,
so the mechanism holds, but with the real downloader behind a stand-in transport the counts are 268 forward and 280
back, not 398 and 234 (`docs/queue/WINDOW-WHOLE-GROUPS.md`), and in the browser fewer again (above; MEASURE-2 and
MEASURE-3 in `findings.md`). The table is the model's, kept as such; the sizes a reader meets are the measured ones.

## 3. The round's rows, read per decoder (derived)

`rows.py` (beside this file) over `raw/2026-11-22/round/beacon.jsonl` at `618dd9cd`.

**Cell 1, the view (`dbts_b1`, 50 frames, 7 groups of 8, 8, 8, 8, 8, 8, 2).** The bench gives group *g* to decoder
*g* mod *n*:

| decoders | frames a decoder | a frame, median (ms) | span = the longest share (ms) |
| ---: | --- | --- | --- |
| 1 | 50 | 171–181 | 8 914–9 274 |
| 2 | 26, 24 | 115–141 | 3 275–3 756 |
| 3 | 18, 16, 16 | 108–117 | 2 007–2 314 |
| 4 | 16, 16, 10, 8 | 111–130 | 1 887–2 541 |

With four decoders the two that hold 16 frames end the fill; the fourth is idle from 1.05 to 1.37 s on. The span's
floor is ⌈groups ÷ decoders⌉ groups, so the "effective time a frame" of the read (span ÷ 50) measures the series'
group count as much as the phone. For this series: 18 frames at three decoders, 16 at four, 8 at seven. The phone
binds too: a frame's median rose from three decoders to four (108–117 → 111–130 ms), eating most of the 18 → 16
frames' −11 % (added 2026-11-25, §Review m2). Whether
seven decoders at 8 frames each beat three is not known (M12 never ran past four); it is, at 150 ms a frame, 1.2 s
against 2.0 s, and each decoder's memory is not measured.

Under the window the opening fill of `dbts_b1` is two groups, so two decoders work and the third is idle: 8 × 115 to
141 ms = 0.9 to 1.1 s (**derived**), whatever the decoder count.

**A decoder's first decode.** First frame minus the same decoder's median, 30 decoder starts each: HTJ2K **+42.0 ms**
(19.6 to 65.5), the view +26.2 ms (−5.8 to +81.6). In a view fill (cell 2, arms A, C1, C2, 24 loads a series) frame 0
is decoded 315 ms after the dial on `dbts_b1` and its own decode is 262 ms, against 173 ms for a frame's median in the
same loads (139, 88 and 49 ms on `dbts_a1`). So on that link the first picture is mostly one decode, and that decode
is the slowest of the fill. Why is a **hypothesis**: baseline-compiled WASM before the optimising tier, first-touch
faults on a new 17 MB buffer, the WebCodecs probe and `configure` inside the first frame's clock
(`client/decode/av1.js` `route` calls `webcodecs(layouts(…))` per payload; the probe runs on the first), cores at a
low clock.

**The exact frame.** Cell 2's C1 press, the first exact request of its load: 216.5 ms. Cell 3 (`round-page.js` at
`f5252051`: "for (const busy of [false, true])") asks the idle one first: 201.3 and 196.4 ms; the busy one second:
120.1 and 120.6 ms. The second request is 81 ms faster in the page view and 76 in the worker's (corrected
2026-11-25, §Review nit: "81 ms in both"). First against second explains it without the
busy page; the two are confounded in that harness and a swapped order would separate them.

**A lone decoder is slower a frame than one of three** (176 against 110 ms, the read's "not explained"). A
**hypothesis** that fits this and the 81 ms above: one decoder's work alternates between the browser's decode threads
and the worker's own thread (the read-back, the pack, the hash), so no thread is busy for long and the governor keeps
the cluster's clock low; three decoders overlap and raise it. DECODE-OVERLAP's first step reads the split.

## 4. The candidates

Effect on the round's phone (premium band) unless said; other bands by device-model §4's ratios (**theory**). "Page"
names the unanswered item a build would need; "none" means it may be built now (§Standing rules, *Builds*).

| # | candidate | kind | first picture | fill | jump | cost | page |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Whole groups in the window** | defect, design | — | bytes of a scroll ÷ 8 (model); ÷ 1.3 to ÷ 3.3 **measured** | a step at the window's edge 0.5–0.8 s → a held frame's 11 ms; 1–3 s on an entry phone (model); forward waits → 0 on three of four cells **measured** | ~40–70 lines in `store.js`, `controller.js`; one frame over 256 MiB (260 MiB on `dbts_b1`); on LTE 1× a backward pass still waits on four steps | none |
| 2 | **The next unit decoded while the last is read back** | optimization | — | −14 to −27 % where the decode binds (above 54–88 Mbit/s here, 19–41 on an entry phone), free cores only; −10 to −19 % **measured** on a 4-core host | a group prefix −18 to −32 %; −21 to −26 % at offset 7, 4× **measured** | ~50 lines in `av1-webcodecs.js`, `decoder.js` | none |
| 3 | **The dial waits for nothing it does not need** | design | −1 to −2 round trips: 0.05–0.2 s on LTE, 0.4–0.8 s at 400 ms; −2.0 to −2.3 **measured** | the same shift | — | ~15 lines in `viewer.js` | none |
| 4 | **The exact decoder warm before the first press** | optimization | — | — | the first exact frame −35 to −80 ms (216 → 135–180) | a decode's CPU once a load; a stream to decode | none; a trade-off (CPU) |
| 5 | **A jump deep in a group is served by the exact frame** | design | — | — | offset 7: 0.9–1.5 s → 0.07–0.12 s on the round's link, 2.0–2.5 → 0.7 s at 27 Mbit/s | a rule in the want; the label | `visually-lossless` 3, `phone-decode-route` 3–4 |
| 6 | **The view's decoder count follows the groups** | optimization | — | 0 to −40 % in memory, unknown sign | — | one number; memory a decoder unknown | `phone-decode-route` 5 |
| 7 | **The probe and `configure` at the decoder's start** | optimization | part of the first decode's +26 to +90 ms | — | — | inside form (c) | `client-calls` 3 |
| 8 | **The first frame to the first decoder that is ready** | code | 0 to −30 ms (theory, no stamp read) | — | — | ~5 lines in `downloader.js` | none |
| 9 | **The split and deep AV1 routes removed from the decoder** | simplification | 0 | 0 | 0 | −60 to −100 lines in `av1.js`, `av1-frame.js` | `unified-to-main` 1 (a removal) |

How each number is reached:

**1 · Whole groups in the window.** §2. The window becomes a count of whole groups, at least two (the one in view and
its neighbour on the side the reader is nearer or moving to), wanted and let go as groups; a key-frame-only series
(G = 1) is unchanged. On `dbts_b1` two groups are 16 frames, 260 MiB (272.6 MB; this said "273 MiB", corrected
2026-11-25), one frame over the 256 MiB default (the owner, amendment 28: the number "should be decided by you or the
other session"). It builds none of `asking` item 1's rule: the order stays nearest first. *Measured since
(2026-11-25, PR 446):* its first build made a backward step onto a group's last frame wait for that group (0.67–0.84 s
a pass at 1×, 4.8–5.0 s at 4×, §Timed cells B1); after its second fix no step waits either way on CLEAN or LTE 4×,
and on LTE 1× the backward pass still waits on its four group ends, 4.2–4.3 s against the tip's 9.6–10.4 s
(§Timed cells again, o1, not diagnosed). A reader turning back early in a group is *derived* only. *Serves the value
statement:* "low latency on every jump" and "lowest … network cost per reading session".

**2 · The next unit decoded while the last is read back.** `client/decode/decoder.js`: "A decoder that answers later
still takes its frames one at a time, in order." and `av1-webcodecs.js`'s `picture` sends a unit, waits for its
frame, copies it out, and only after the pack and the hash does the worker send the next. The browser decodes on its
own threads, so while the worker reads frame *k* back those threads have nothing to do, and while they decode
*k* + 1 the worker has nothing to do. With one frame in flight the decoder gives a frame per unit
(`optimizeForLatency`), so the next unit of the *same group* can be sent as soon as the last one's frame is out. If
the worker's share of a frame is *s*, a frame's time on a decoder falls from *t* to max(1 − *s*, *s*) × *t*. *s* is
not in any row (**theory**: a 25 MB copy, a pass over 8.5 M samples, a 17 MB hash: 20 to 35 ms of 110 ms, so
*s* = 0.18 to 0.32). Fill: 18 frames × 110 × (0.68 to 0.82) + 0.25 s = 1.6 to 1.9 s against 2.2 s (**derived on
theory**). On a request, the same change lets the target's frame be read back first and the frames before it after.
The formula holds on **free cores only**: the round's rows show at least 3.3 of 8 in use (a partial sum, so a lower
bound), and no other phone's rows exist. *Corrected 2026-11-25 (§Review m1):* this said "at most 3.3 of 8". Measured
since (DECODE-OVERLAP, a 4-core cloud host): *s* = 0.39 to 0.46 at 1×, where the formula predicts −39 to −46 %; the
fill fell −10 to −19 % (DECODE-OVERLAP-MEASURE), the decode and the read slowing each other with 2.9 to 3.6 of 4 cores
busy. The −14 to −27 % above was met only because *s* was guessed low; contention is the missing term. *Serves:* "a
fast full fill".

**3 · The dial waits for nothing it does not need.** `client/viewer/viewer.js`: line 43 "const pair = await (async ()
=> {" fetches the exact series' metadata and transport file, and line 138 awaits `built("dav1d")`, both before the
connect at line 159. The pair's check gates what may be *labelled*, not what may be dialled: the dial, the first
bytes and the first decode can run while it is fetched, and the first paint waits for the check as today.
`claude/work-ledger:docs/queue/FABLE-DESIGN.md` P2 named it ("The dial waits for nothing it does not need"); it was
never built. One to two round trips: nothing on the round's link, 50 to 200 ms at an LTE round trip of 50 to 100 ms,
0.4 to 0.8 s on the 400 ms profile; measured since at −2.0 to −2.3 round trips, at and just past the upper end
(DIAL-BEFORE-PAIR-MEASURE, §Review m4). It is the only candidate here that is the link's, not the device's.
*Serves:* "a fast first picture" on "unreliable wireless".

**4 · The exact decoder warm before the first press.** §3: +42 ms on a decoder's first HTJ2K decode, and the first
exact request 81 ms slower than the second. `docs/levers.md` records a warm-up decode at 6 to 28 ms in the cloud,
removed, "reopened on premise"; the phone's rows put it at 35 to 80 ms. It needs something to decode that is not the
reader's frame (fetching that one unasked is `visually-lossless` item 3's), and it spends a decode's CPU on every
load for a press that may not come. Not queued: fourth by effect, and its first step is the swapped-order cell
below, on the phone.

**5 · A jump deep in a group is served by the exact frame.** `dbts_b1`: exact 17.19 Mbit, view 3.71 Mbit, so the
view's prefix is more bytes from *k* + 1 > 4.63: offsets 4 to 7. Time, on one decoder, at a rate *R*: exact
17.19 Mbit ÷ *R* + 41 to 87 ms; view (*k* + 1) × (3.71 Mbit ÷ *R* + 110 to 176 ms). At *k* = 7 and 600 Mbit/s: 0.07
to 0.12 s against 0.93 to 1.46 s; at 27 Mbit/s 0.68 to 0.72 s against 1.98 to 2.51 s. At *k* = 0 the view wins below
100 to 586 Mbit/s. On `dbts_a1` (exact 9.69 Mbit, view 0.66 Mbit) the bytes never cross within 8, and the exact frame
is faster above 13 to 24 Mbit/s at *k* = 7 and 44 to 90 Mbit/s at *k* = 3 (**derived on theory**: its decodes scaled
by the model's 0.347 and 0.247; the phone missed the 0.247 carry, A on `dbts_a1` ÷ `dbts_b1` measured 0.33,
`next-round-results.md`). *Corrected 2026-11-25 (§Review m3, nit):* this said "13" and "45", one end of each range,
and wrote *G* for the rate beside *G* the group length. It would show an
exact frame nobody asked for: **it would reopen "the exact HTJ2K frame on an explicit Lossless request"**. Candidate
1 removes most of the jumps it would serve (a scroll no longer jumps); what is left is the true jump, far from the
window. For EXACT-UNASKED and FIT-ARM-PROTOCOL item (3) to size; nothing built.

**6 · The view's decoder count follows the groups.** §3. `phone-decode-route` item 5 rests on "the view is saturated
at three"; the rows say the series' seven groups were. Under candidate 1's window the opening fill is two groups and
the count does not matter. Left for the phone's M12, with the prediction that the span follows
⌈groups ÷ decoders⌉ × G × a frame's time.

**7, 8.** The first decode carries the probe and the decoder's `configure` (§3); form (c) of `client-calls` item 3
already moves the probe to the start. `downloader.js` `start` awaits every decoder ("if (cfg.decode) await
Promise.all(ready);") before the first dispatch; `docs/levers.md` lists it as never tried. No stamp in the round's
rows gives the gap between the first decoder ready and the last, so its effect is not known.

**9.** `client/decode/av1.js` still carries the split frame's `low` unit, `merge`, the lab's `mixed` and the deep
route's `refusedDeep`, which `docs/client/design.md` §Decided (11-09, 11-11) leaves unreachable for a product series.
A removal: it waits as every removal does.

## 5. The three rows queued

Each is a draft PR into `claude/unified`, then measured interleaved against the tip by a session that did not build
it. A non-regressor goes to a sync row; a trade-off to BRIEF-WEEKEND's table. Briefs in `docs/queue-2026-11-24.md`
§IMPROVE-1's rows.

| row | the claim its test makes | stops if |
| --- | --- | --- |
| WINDOW-WHOLE-GROUPS | a forward and a backward pass over a 50-frame G = 8 series under a 15-frame budget put each frame on the wire once | the failing test passes on the tip: §2 is wrong |
| DECODE-OVERLAP | within a group the next unit is sent before the last frame's read-back ends, and every frame still checks | the read-back's share of a frame is under 10 % in the cloud's stamps |
| DIAL-BEFORE-PAIR | the session is dialled before the pair's fetches settle, and no frame is labelled before the pair's check | — |

## 6. What this asks of the phone's next round (for PHONE-ROUND-2's plan; not appended there)

* The exact request with the order swapped (busy first), and a third request: separates first from idle (§3).
* The view to seven decoders in memory (M12), with each decoder's memory: tests §3's ⌈groups ÷ decoders⌉.
* A scroll past the window on `dbts_b1`, steps timed and the wire's bytes counted, before and after
  WINDOW-WHOLE-GROUPS.
* A stamp at the decoder's frame-out, so the read-back's share on a phone is a number.

## 7. Not here, and why

Tiles in the view's encode (measured, "AV1 tiles wait", TILES-STEP held); the 32-packet initial window
(`transport-stack` item 5); the wake at `pointerdown` (`client-calls` item 4, a phone decides); the view worker as
default (`view-target` item 1); a level picture first (`exact-frame-layout` item 5, a decided approach); the cache
(CACHE-DESIGN-1124). HTJ2K's fourth decoder (−18 % in memory, **measured**) is not a candidate: the exact fill is
wire-bound below 666 to 910 Mbit/s on the round's phone (`route-policy.md` §3), so it would move nothing a reader
meets.

## 8. Fixtures and limits

One premium Android phone, one home Wi-Fi link (≥ 568 to 595 Mbit/s), one evening, two DBT volumes of one dataset
(`dbts_b1`, 50 frames; `dbts_a1`'s cut, 56), the view at Q 8, G 8, software decode; cell 2's loads carried memory
between same-origin loads, so their absolute times are that evening's. No breast ultrasound, no second phone, no
other engine, no cellular link: every number for another device or link is the model's. §2 is a model over two
product modules, not a run. Candidates 2, 4, 7 and 8 rest on shares no row holds. Each limitation above names where
it was found: §2 by `window-model.mjs`, §3 by `rows.py` over the round's rows, the rest by the files quoted.

## Review

IMPROVE-1-REVIEW, 2026-11-25 13:10–13:40 UTC, by a session that wrote none of this file (`by:` in its status file).
Read: this file whole at `7703f2080`; `window-model.mjs` and `rows.py`; the code quoted at `origin/claude/unified`
`b059388b6`; `claude/phone-run` `8d77ba2b4:docs/phone-rows/next-round-results.md` and the raw rows at `618dd9cd`;
`docs/decode/mobile/device-model.md` at `b059388b6`; `round-page.js` at `f5252051`; the measuring rows of the three
queued candidates (`docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/findings.md` §The count and §Timed cells,
`docs/queue/DECODE-OVERLAP{,-MEASURE}.md`, `docs/queue/DIAL-BEFORE-PAIR-MEASURE.md`). Run: `window-model.mjs` against a
`b059388b6` checkout and `rows.py` over the raw rows (node 22, a 4-core cloud container); the arithmetic of §2–§4 by
hand. Nothing timed; no browser. The review runs after the three builds and their measures (its latest was 11-25
20:00; it was first due 11-25 08:00), so it checks the premises against what those rows measured.

**Reproduced.** `window-model.mjs` prints §2's table exactly (398/234, 267/140, 218/112, 50/50, 50/50). `rows.py`
prints §3's per-decoder table, both first-decode lines (HTJ2K +42.0, 19.6–65.5; the view +26.2, −5.8–81.6) and both
view-fill lines (315/262/173 ms; 139/88/49 ms). Every code quote of §2, §4 items 2, 3, 8 and 9 is at the cited file
(`controller.js:7,33`, `store.js:53`, `downloader.js:92,544,666`, `decoder.js:72`, `viewer.js:43,138,159`, `av1.js:35`),
and `round-page.js` asks idle first (`for (const busy of [false, true])`, lines 87, 99, 103). Recomputed and right:
W = 15 (2560 × 3328 × 2 = 17.04 MB; ⌊268.4 / 17.04⌋), the step's 4.5 frames, 16.7 Mbit, 0.50–0.79 s and 1.1–1.4 s;
the decoder shares 26/24, 18/16/16, 16/16/10/8; candidate 2's 1.6–1.9 s and −14 to −27 %; candidate 5's offsets 4–7
(17.19 ÷ 3.71 = 4.63) and its `dbts_b1` times at 600 and 27 Mbit/s.

* **B1 (blocker). Candidate 1's size is the model's, and the product measured it two to six times smaller; the file
  still states the model's as the effect.** §1 item 1 ("a scroll pays for it eight times over"), §2 (398 frames,
  "185 MB for one forward pass") and §4 row 1 ("bytes of a scroll ÷ 8 (model)") are what the ranking and
  WINDOW-WHOLE-GROUPS-MEASURE's prediction ("÷ 4 to ÷ 8") rest on. *Measured* since: the real downloader behind a
  stand-in transport put 268 frames forward and 280 back on the tip (`WINDOW-WHOLE-GROUPS.md`; the model said 398 and
  234, so backward is under-, forward over-stated); in the browser, `dbts_b1-q8-g8`, the tip's forward pass was 104–113
  frames on CLEAN and 72–77 on LTE (49.4 and 33.7 MB, not 185), because "the real downloader replaces a want's unsent
  asks, which the stand-in delivers whole" (`findings.md` §Timed cells); bytes fell ÷ 1.3 to ÷ 3.3 after the build,
  "a miss in every cell". The defect and the rank hold (forward waits 1–24 steps a pass → 0 on three of four cells),
  but the number a reader of this file takes away is refuted and not corrected, and two rows' costs are missing
  from §4 row 1: the backward step into a group's last frame now waits for the group (MEASURE-2 B1, 0.67–0.84 s a pass
  at 1×, 4.8–5.0 s at 4×), and the memory is 260 MiB (272.6 MB), not "273 MiB" (`WINDOW-WHOLE-GROUPS.md`'s Result).
  Fix: §1 item 1, §2 and §4 row 1 corrected in place, dated, the model's numbers kept as the model's beside the
  product's measured ones with why they differ (the stand-in's whole delivery), §2's *Limits* naming the rows that
  found it, §4 row 1's cost carrying the backward wait (as MEASURE-3 leaves it) and 260 MiB.
* **m1. Candidate 2's premise "the cores are free" is not supported as written, and its formula missed where the share
  was measured.** §4 item 2: "which the round's rows support (at most 3.3 of 8 in use)". The read says the opposite
  bound: "3.32 over the load's opened → ended (load 42) … the renderer is often a new process within a load, so the
  sum is partial" (`next-round-results.md`): 3.3 is a lower bound, not "at most". DECODE-OVERLAP measured the share at
  *s* = 0.39–0.46 at 1× (cloud), where max(1 − *s*, *s*) predicts −39 to −46 %; the fill fell −10 to −19 %
  (DECODE-OVERLAP-MEASURE), the decode and the read slowing each other on a 4-core host (2.9–3.6 of 4 busy). The
  −14 to −27 % was met only because *s* was guessed low. Fix: "at least 3.3 (a partial sum)", and the formula given a
  contention term or labelled "free cores only, not met on a 4-core host", the measured *s* beside the guessed.
* **m2. "The view saturates at three" is refuted only in part.** §1 item 2's first bullet and §3 put the plateau on the
  group count; the rows show both causes: the group count bounds four decoders' gain at 18 → 16 frames (−11 %), and a
  frame's median rose from three decoders to four (108–117 → 111–130 ms; the read's 110.2 → 118.8), eating it. "The
  cores were not the limit (Chrome used at most 3.3 of 8)" rests on the partial sum of m1. Fix: say both, and that
  which binds past four is M12's to read (candidate 6 already says "unknown sign").
* **m3. Candidate 5's `dbts_a1` crossings quote one end of their range, on a ratio the phone missed.** At the inputs
  stated (exact 41–87 ms × 0.347, view 110–176 ms × 0.247, `device-model.md:88`) the exact frame is faster above
  13–24 Mbit/s at *k* = 7 and 44–90 Mbit/s at *k* = 3 (*derived*, here), not "13" and "45"; and the read found the
  view's 0.247 carry missed on the phone (A on `dbts_a1` ÷ `dbts_b1` 0.33, `next-round-results.md`). Fix: the ranges,
  and the 0.33 named. Moves no row (candidate 5 is not queued).
* **m4. Candidate 3 measured at, and just past, its upper end** (−2.0 to −2.3 round trips against −1 to −2,
  DIAL-BEFORE-PAIR-MEASURE); §4 row 3 can say so in one clause. Moves nothing.
* **Nits.** §3 "81 ms faster in both views": 81 (page, 201.3 → 120.1) and 76 (worker, 196.4 → 120.6). §4 item 5's
  "17.19 ÷ G" uses *G* for Gbit/s beside *G* the group length; write the rate.

**Premises checked and holding.** §2's mechanism (the window cuts two groups, the store lets go single frames, the
downloader asks whole groups) is the product's (WINDOW-WHOLE-GROUPS's failing test on `b059388b6`). §3's first-against-
second reading of the exact frame holds on the harness's order (idle is always first). Candidate 3's "the pair gates
the label, not the dial" was built and held (no frame painted before the check, both views). Candidate 2's mechanism
(the next unit sent once the last frame is out) was built and is a non-regressor; only its size and its "free cores"
are off (m1). Candidates 4–9 are not queued; their premises are quotes that check, and their effects are labelled
theory or hypothesis as they should be.

**Verdict.** One blocker (B1), docs only on this branch. IMPROVE-1-FIX and IMPROVE-1-FIX-REVIEW appended to §Opus rows
of `docs/queue-2026-11-24.md`. No build stops: each queued row's premise holds (the brief's "if IMPROVE-1-REVIEW
refutes a row's premise before its build is done" does not apply); the sizes are corrected, not the rows.

Fixtures and limits of this review: the round's rows (one premium phone, one home Wi-Fi link, one evening, `dbts_b1`
and `dbts_a1`'s cut, Q 8 G 8, software decode); the cloud rows are the measuring rows' (4-core host, no GPU, headless
Chromium, software WebCodecs, a userspace relay); no ultrasound; nothing re-measured here.

### Fix

IMPROVE-1-FIX, 2026-11-25, by a session that wrote neither this file nor its review (`by:` in its status file); in
place, each change dated. **B1**: §1 item 1, §2's *Bytes* and *Limits*, and §4 row 1 and item 1 give the product's
measured counts and bytes beside the model's, kept as the model's, with why they differ (the stand-in delivers every
miss whole); row 1's cost carries 260 MiB and the backward wait as MEASURE-3 leaves it (none on CLEAN or LTE 4×, four
waits on LTE 1×, half the tip's). **m1**: item 2 "at least 3.3 (a partial sum)", the formula "free cores only", the
measured *s* and fill beside the guessed. **m2**: §1 item 2 and §3 name both causes. **m3**: item 5's `dbts_a1`
ranges and the 0.33. **m4**: item 3 and row 3. **Nits**: 81 and 76 ms; *R* for the rate. Nothing re-measured; the
numbers are the cited rows', each recomputed (m3's ranges, 16 × 17.04 MB = 260 MiB).
