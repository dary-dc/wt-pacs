# Who owns a frame's memory

**Question:** How is the memory of decoded frames bounded: a window, a ring of slots, transferred buffers, or the disk
alone?

*Moved 2026-11-14 from `docs/adr/frame-path.md` at `e5b20cba` (§Who owns a frame's memory, §Options, and what each
costs, §Questions for the owner, §Sources, 2026-10-22, §Sources, 2026-10-27), word for word but for queue-row names. A
bare §N or §Name is a section of that ADR: [its map](../../adr/frame-path.md) names the file each now lives in.
Choices 1–8 are [the cache's](cache-in-opfs.md#the-choices-and-what-decides-each). The design these findings shape is
[`../design.md`](../design.md).*

## Who owns a frame's memory (2026-10-28)

**Status:** theory and a reading of the engines' sources; nothing built, nothing run. *Corrected 2026-10-30:* M5 has
run, on Chromium and Firefox; its results are below (*M5, run 2026-10-30*), and Firefox again with the rig's driver fixed (*Firefox, run again*). The shape it assumes is the
owner's of 2026-10-28, written nowhere else yet: one dedicated **view worker** holds the frame store (the memory window,
OPFS behind it), the controller and the paint; the decoders, nested in the downloader worker, post each checked frame
straight to it. The question: who owns a decoded frame's memory, so that the window bounds peak memory during a fill on
every engine. The finding it answers is M2's (*Fixes*, above); choice 2 names the ring.

**What each engine's collector sees** (pinned sources below):

| engine | a `SharedArrayBuffer`'s backing store | a transferred `ArrayBuffer` | what starts a collection |
| --- | --- | --- | --- |
| V8 | **counted as 0 bytes** in every isolate that holds it, "to avoid GC thrashing" (a TODO) | counted at its length in the isolate that holds it; the sender's count is cleared on detach | external memory past limits set from the last GC (the soft one 64 MiB over its low since then) starts marking or a collection. *Corrected 2026-10-29 (independent review):* the soft limit is defined there and called nowhere in the files read; an allocation past its low since the last GC + 128 KiB starts marking only once the global limit is reached, which grows that low by a factor (`heap-controller.cc` 307–315, 487–490): proportional, not 64 MiB |
| SpiderMonkey | counted at its length, once per zone (each worker is its own), whatever the holders | counted at its length | a zone's malloc bytes past max(retained, 38 MiB) × 1.5–3.0 |
| JavaScriptCore | counted at its length by every wrapper ("probably overcounts") | the same | the heap, extra memory included, past a proportional multiple of the last live size |

So M2's failure is V8's alone by source: a dropped frame weighs nothing there, and only a collection the JS heap
itself asks for frees it. Gecko and JSC should collect a dropped frame on pressure, with slack in proportion to what is
held. No web API forces a collection; V8's `ExternalMemoryAccounter` is the embedder's, not a page's. *Not measured:*
M2 never ran on Firefox, and WebKit not at all.

**The candidates.** Copies are of the decoded samples, in script, from the decoder's output to the store, per frame;
the paint's upload (GL) and the OPFS write (the kernel) are the same in all. Today, counted from the code
(`htj2k.js` `decodeWith`, `av1-frame.js` `begin`, `av1-webcodecs.js` `read`, `viewer.js` `write`): HTJ2K **2** (the heap
into a new `SharedArrayBuffer`, then the page's copy for the store, *Fixes*), dav1d **2** (its pack is the first),
WebCodecs **3** (`copyTo`, the pack, the page's). The decode-side count of
[`../ARCHITECTURE.md`](../../ARCHITECTURE.md) §The container campaign, *Per frame, counted from the code* (3 for HTJ2K, the coded bytes' two included) rises to 4
with the store's copy.

| | **(a)** a `SharedArrayBuffer` a frame, collected sooner | **(a′)** a transferred `ArrayBuffer` a frame | **(b)** a ring of largest-frame slots | **(c)** slots carved once per series |
| --- | --- | --- | --- | --- |
| memory during a fill | V8: unbounded, as M2; Gecko and JSC: window + collector slack | window + collector slack on every engine: V8 64 MiB and its marking's length (*corrected 2026-10-29:* V8's is proportional too, above), Gecko up to 0.5–2 × the window, JSC proportional | **fixed**: the ring | **fixed**: the ring |
| copies, HTJ2K / dav1d / WebCodecs | 1 / 1 / 2 | 1 / 1 / 2 | 1 / 1 / 2 | 1 / 1 / 2 |
| what the window holds at 256 MiB | the budget | the budget | the study's largest frame sets every slot: with a mammogram in it, 9 slots, so a CT series keeps 9 frames, not 512 | the series' own: 512 at 512², 9 at 3328×4096 |
| new machinery | none, and nothing to build it with on V8 | the decoder's output type and a transfer list | a slot table, backpressure, the races below | the same as (b) |
| races | none (single-threaded reads, frames never reused) | none: a transfer detaches the sender | below | below |

The copy falls by one under every candidate, and the fall is the **shape's**, not the owner's choice: in one thread the
store writes OPFS from what it holds, so the page's copy for the store goes. Against each other the four copy the same.
Writing into a slot is the copy the decoder already makes: `set(out)` into the slot's view in place of a new buffer;
dav1d's pack writes its output view over the slot. WebCodecs' `copyTo` takes a shared view (`AllowSharedBufferSource`),
so it could write the slot directly, but a grey 4:2:0 frame brings its chroma (a slot half as large again at 8 bits)
and the split and offset still want a pass: not counted. (b) wastes the window whenever a study mixes frame sizes;
(c) does not, because one series has one frame size (choice 3). A tab shows one series today (a server serves one), so
(c) carves one `SharedArrayBuffer` of the budget once; several series on screen would share it, re-carved only with
every slot free, which is not designed here. A second buffer is never allocated: on V8 the first would never be freed.

**How (c) works.** A slot table of one `Int32` a slot, in a small `SharedArrayBuffer` sent once with the ring: free,
or the decoder writing it, or held by the store, with a take count. A decoder takes a slot by `compareExchange` when it
**begins** a frame (not when one is queued, so at most one slot a decoder, three of nine on a mammogram), decodes,
hashes the slot (the exactness check, unchanged, while the decoder still owns it), and posts `{ index, slot, take }`.
The store frees a slot on eviction. A decoder that finds none free says so on its port and the store answers when one
frees; the store checks on receipt, so no wake-up is lost, and no thread blocks. A read back from OPFS takes a free
slot the same way, reads into it (sync access handles take shared views, §4) and re-checks it there.

* **Every slot held.** With OPFS a slot frees one synchronous write after its frame lands, so a fill dries the ring
  only when nothing can be dropped: no OPFS, or a write refused. Then the decoders stop, their two frames each stay
  queued, and dispatch stops. That reaches the wire only through the reader pause, proposed and not built
  ([`../ARCHITECTURE.md`](../../ARCHITECTURE.md) §The downloader, *Memory*); until it is, coded bytes queue, at most the
  series' coded size. Under (c) question 2's *keep everything* cannot be had: past the budget the fill stops or drops
  the farthest. An ask outranks the window: the store evicts the farthest frame for it, on disk or not.
* **Races.** The paint's `texSubImage2D` and the OPFS `write` both read the slot synchronously in the view worker, so
  neither can see it reused mid-read; nothing else in that thread yields between them. A decoder writes only a slot it
  took, and a frame decoded again after a mismatch reuses its own. Three cases need a rule: an AV1 preview layer stays
  its own transferred buffer outside the ring (a slot would be overwritten by the exact frame while the preview is shown); a
  cancelled frame's decoder frees its slot itself; a dead decoder's slots are freed by the store only once the
  downloader has terminated it. A double free would paint another frame silently, after the check: the store compares
  the slot's take count before and after each read (two `Atomics.load`), and drops and re-asks on a change.

**Recommendation: (c).** It is the only candidate that bounds a fill by construction on V8, where M2 failed, and
on the other engines by a number we choose instead of a growth factor. Its cost is the slot table and the rules
above, on the decoders' output and in the store. **What would turn it over:** (a′) meeting the same rule on
Chromium and Firefox in the protocol below: then the collector's slack is small enough in practice, and (a′) needs no
table, no backpressure and no new failure mode. Also: the ring losing fill time beyond its A/A (decoders waiting on
slots); a hanging protocol putting series of different frame sizes on screen at once, which wants a byte allocator,
not slots; a budget under four of a series' frames (three decoders and the frame shown), which (c) cannot serve.

**Protocol, M5, pre-registered 2026-10-28, before any build or data** (amended 2026-10-29, *M5 amended* below). M2's rig (`lab/opfs-cache/run.mjs` at `0920153d`, cell `m2`)
and its rules carry over: the 4-vCPU container, the 80 × 3328×4096 series (2.03 GiB) on loopback, a 256 MiB window,
a fresh profile an arm, the browser tree's PSS each second, peak less the value before the dial; every frame checked
by the decoder's XXH3 and the rig's SHA-256; arms ordered per round by `lab/order.mjs`; ≥ 7 rounds; each arm's
settings printed with its rows; CPU busy recorded. Chromium as M2; Firefox on Xvfb, which needs the rig's Firefox
driver taken from M3 to `m2` (a rig change, made in the later row). WebKit is not run (no build in the container). *Corrected 2026-10-29:* `browser` already sends `m2` to the
Firefox driver under `--engine firefox`; what `m2` lacks is the engine in its settings and rows. The arms are three
client trees, and the rig serves one (`today`'s `was` was a stand-in): serving them side by side is a rig change too.

| arm | build |
| --- | --- |
| `ring`, `ring′` | the view worker with (c); `ring′` the same, run again: the A/A |
| `today` | `claude/opfs-cache-fixes` as measured 2026-10-28 (the page's window, the store handed copies) |
| `transfer` | the view worker with (a′): the same shape, the decoder posting a transferred `ArrayBuffer` |

* **Measured:** growth, the fill's time (dial → last frame checked), exactness, and on `ring` the decoders' slot waits
  (count and total ms).
* **Predicted:** `ring` 530–600 MiB on both engines: the floor once everything is collected, 531–537 MiB (*Fixes*), holds
  the window and the workers already, and the ring adds nothing to it. `today` on Chromium as on 2026-10-28,
  2.6–3.2 GiB; on Firefox bounded by collection, 0.6–1.2 GiB. `transfer` 600–800 MiB on Chromium, 650–1 100 on
  Firefox. (*Corrected 2026-10-29:* Chromium's 600–800 rested on the 64 MiB slack, which the sources do not give: a
  guess, not a derivation.) Fill: `ring` ≤ `today` (one copy and one hop fewer); slot waits near zero with OPFS.
* **VOID**, per engine: the median |`ring′` − `ring`| over 64 MiB, or the median `ring′`/`ring` fill time outside
  0.90–1.10.
* **Rule.** On each engine, (c) **holds** if in every round not VOID the fill is complete, every frame exact by both
  checks, `ring`'s growth ≤ 608 MiB (the budget + 352: the floor's 537 and the A/A bar's 64, rounded up), and the median
  `ring`/`today` fill time ≤ 1.10. It **fails** otherwise, and choice 2 returns to the owner with the numbers.
  **Turned over to (a′)** if `transfer` also meets the 608 MiB bar and the time bar in every round not VOID, on both
  engines. (*Corrected 2026-10-29:* VOID is the engine's cell, not a round: read "in every round of a cell not VOID";
  a VOID cell decides nothing on that engine.) `today` is reported, not ruled: on Firefox it may already be bounded, which tests the source reading above.
* **Mutants**, each a stand-in as M2's: the store never frees a slot, which must stall the fill (predicted after nine
  frames, the ring's count) and fail completeness within 120 s, 15 × today's fill; and a ring that allocates a fresh buffer when dry,
  which must fail the 608 MiB bar. *Corrected 2026-10-29 (independent review):* with OPFS the ring is predicted
  near never dry (slot waits near zero, above), so that mutant may allocate nothing and pass: it runs with the store
  off (the `off` stand-in), where the ring dries after nine frames. The 120 s is a rig change too: `fill` waits 1 800 s.
* **After it, if (c) holds:** the 13 GiB series on `ring`, Chromium only: growth as at 2 GiB and the fill complete,
  where every earlier arm stopped at ~12 GiB, the container's limit (M2).

**Sources, 2026-10-28**, fetched for this section and added to [`frame-path-sources.txt`](sources.txt).
V8 at `f428bb0` (Chromium `52c75e5`'s `DEPS`); Gecko and WebKit at §9's pinned commits; WebCodecs at `2b849bb`.

| claim | source |
| --- | --- |
| V8: a shared backing store counts 0 bytes per isolate | `src/objects/backing-store.h` 203–209; `src/objects/js-array-buffer.h` 291–298 |
| V8: an array buffer's count added on attach, removed on detach; 0 skipped | `src/heap/array-buffer-sweeper.cc` 358–372, 388–402, 426–438 |
| V8: what external memory starts; the 64 MiB | `src/heap/heap.cc` 1389–1401, 6976–7022; `include/v8-internal.h` 1233 |
| V8: the start is the global limit, external memory's low × a factor (*added 2026-10-29*) | `src/heap/heap-controller.cc` 307–315, 482–490; `src/heap/heap-controller.h` 219; `src/heap/heap.cc` 5607–5611, 5646 |
| V8: the accounting API is the embedder's | `include/v8-external-memory-accounter.h` 15–49 |
| Gecko: a shared buffer counted once per zone, at its length; the trigger checked | `js/src/vm/SharedArrayObject.cpp` 777–800; `js/src/gc/Zone.cpp` 89–113 |
| Gecko: an array buffer's contents counted and released as cell memory | `js/src/vm/ArrayBufferObject.cpp` 1885–1910 |
| Gecko: the malloc trigger, base and growth | `js/src/gc/GC.cpp` 2158–2188; `js/src/gc/Scheduling.h` 409–431; `js/src/gc/Scheduling.cpp` 466–497, 580–597 |
| JSC: each wrapper counts the whole buffer, shared or not | `runtime/JSArrayBuffer.cpp` 45–50; `runtime/ArrayBuffer.h` 379–383; `heap/Heap.cpp` 646–653 |
| JSC: the next collection, proportional | `heap/Heap.cpp` 171–203, 1905–1911 |
| WebCodecs: `copyTo` takes a shared view | `index.src.html` 3446–3448 |

**Not traced:** Blink's own accounting of a shared buffer outside V8; whether Gecko's high-frequency mode holds during a
fill (it picks 1.5 or 3.0); JSC's growth factor on a phone; `Atomics.waitAsync` per engine, which the design avoids.

**M5 amended, 2026-10-29, before any data.** Two reviews on PR #235 bear on M5: the red team's finding 3 (no
backpressure; the revised Target adopts credits, K open) and the independent design's *no frame memory* (the disk the
only frame store, one reused read buffer per viewport, the OS page cache as the window, predicted there at 530–600 MiB
like `ring`). The question stays one: which frame memory bounds a fill. The pre-registration above stands as written;
the arms, the bar and the rule below replace its own. The arms are built in `lab/opfs-cache/` only, nothing in
`client/` changes, and M5 is not run here: its runs are a separate row.

**The build.** A stand-in view worker (`arms-view.js`, page `arms.html`) runs the product's downloader with its decoder
seam pointed at `arms-decoder.js`: the product's OpenJPH build and frame check, then each exact frame written to an
OPFS file of its own **before** it is posted. Every arm so writes the same bytes from the same threads (who writes is
not this row's question), and the arms differ in one lever, what the view holds:

| arm | what the view holds | build |
| --- | --- | --- |
| `ring`, `ring′` | (c): ⌊256 MiB / frame⌋ slots of one `SharedArrayBuffer` carved once, 9 at 3328×4096 (234 MiB), with `arms-slots.js`'s table. A decoder takes a slot by `compareExchange` as it begins a frame (*corrected 2026-10-29, independent review:* once its decode ends, before the copy into the slot, as `arms-decoder.js` does); with none free it tells the view, which evicts the frame farthest from the current one, and waits for one to free | `arms-*.js` |
| `transfer` | (a′): a new `ArrayBuffer` a frame, transferred; past 256 MiB the farthest dropped | `arms-*.js` |
| `transfer-k` | `transfer` under credits: the downloader dispatches only while fewer than K frames are unacknowledged, and each ack dispatches again | `downloader.js` through the rig's stand-in `credits` |
| `disk` | nothing: no samples are posted; a frame asked or stepped to is read back into the one read buffer and checked | `arms-*.js` |
| `today` | as pre-registered: the product page, its window, the store handed copies | the product |

The lab's simplifications: a decoder waiting for a slot blocks in `Atomics.wait` (the design blocks no thread; the
decoder has nothing else to do, and the downloader's 10 s decode deadline still guards it); the view paints nothing
(the upload is the same in every arm); the current frame is 0 until the first ask, then the frame last asked.

**What disk-only costs on the asked-frame path.** Every frame shown that is not in a buffer is a read and a check: M1
measured 22.3 ms to read and re-check a 3328×4096 frame with the page cache warm (row *§7's rule, from M1*, above), the
cost the independent design's comparison concedes. M5 times it on two paths, each from the frame being at the view
to its samples checked in hand, the wire and the decode being the same in every arm: three asks during the fill
(frames 79, 69, 59, once 10, 30 and 50 frames are in, each becoming the current frame) and three steps after it (the
three frames before the last asked, inside the window around it). In `ring` and `transfer` both are a lookup; in
`disk` both are a read and an XXH3. *Corrected 2026-10-29 (independent review):* the 22.3 ms is M1's R / n, a 32-frame
reopen's time from the store worker's start divided by its frames, on Chromium only: a throughput, not one read's
latency, and 5.6 ms over the bar. That `disk` misses the time bar is predicted, not shown; Firefox's read is not measured.

**Credits, and where they matter.** The consumer acks a frame when the view takes it, and every frame is on disk
before it is posted, so "held within budget or written" holds at receipt in every arm. What credits bound is what
waits in the view's port before then: live frames no collector can free, in a queue HTML gives no bound. That matters
only where a waiting message carries samples, `transfer`: in `ring` the slots are the credits (a dry ring stops the
decoders), and in `disk` a message carries none. So credits cross `transfer` only, at two loads: the main cell, and
**`m5-busy`**, the view held 200 ms a frame, twice M2's measured delivery period (7.87 s over 80 frames), a stand-in
for a view busy reading, checking and painting (red team, 4). **K = decoders × `perDecoder` = 6** on this host: the
most frames the decoders hold at once, so credits bind only once the view falls behind, and a fill under them holds at
most the window and K frames more. K is not swept: if `transfer-k`'s median fill time at full speed falls outside
0.90–1.10 × `transfer`'s, K was too small, and `m5-busy` runs again at 12.

**Measured**, each round and arm, besides the pre-registration's: the host's page-cache growth (`Cached`, which no
PSS counts and which holds `disk`'s window); the SHA-256 check as every OPFS file read back after the fill, outside
the PSS sampling; the asked frame's times; and the view's own counts: peak bytes held, frames taken outside the ring,
the most frames waiting in its port at once (from each frame's decode-end and receipt stamps), slot waits.

**The bar and the rule, restated.**

* **Memory bar**, per engine: every round's growth ≤ the median `disk` growth on that engine + 320 MiB (the budget
  and the A/A's 64). It replaces 608 MiB, which rested on Chromium's floor of 2026-10-28 (531–537 MiB, a window
  included): Firefox's floor was never measured, and `disk`, holding no frame, measures each engine's floor in the
  same rounds. `disk` itself must hold nothing (peak bytes held 0). *The order, said plainly:* this bar was set after
  a Firefox smoke round showed the engines' floors apart; its reason does not rest on that round.
* **Time bar:** an arm's median asked-frame time ≤ `ring`'s + 16.7 ms, one display period: the bar the independent
  design set for its own read-back (its protocol, 3).
* **An arm qualifies** on an engine if, in every round not VOID, the fill is complete, every frame exact by both
  checks, the memory bar met, its own check true (`ring`: no frame outside the ring; `transfer-k`: never more than K
  waiting), and over the rounds the median fill time ≤ 1.10 × `today`'s and the time bar met. VOID as pre-registered.
* **Rule.** The simplest arm that qualifies on both engines is chosen: `disk` (no frame memory), then `transfer` (no
  table), `transfer-k`, `ring`. None: choice 2 returns to the owner with the numbers. `m5-busy` rules credits: needed for
  `transfer` if there `transfer` misses the memory bar and `transfer-k` meets it with never more than K waiting.
  `lab/opfs-cache/summary.py` (at `0920153d`) applies both.

**Predicted, from the sources** (cited above and below; *floor* is an engine's growth with no frame held, which
`disk` measures):

| arm | V8 (Chromium) | SpiderMonkey (Firefox) | JavaScriptCore (WebKit, not run) |
| --- | --- | --- | --- |
| `ring` | floor + the ring: the one shared buffer counts 0 and is never garbage; 530–600 MiB as pre-registered. **Qualifies** | floor + the ring: counted once per zone that holds it (the view and three decoders), which raises each zone's trigger and frees nothing. **Qualifies** | floor + the ring: each wrapper counts it, so collections come sooner, not memory larger |
| `transfer` | floor + up to 260 MiB of window + V8's slack: a received buffer counts in the view's isolate, a sent one stops counting at detach, and 64 MiB of external memory past the last collection starts one. At the bar (floor + 324–350 against + 346): the rule decides. *Corrected 2026-10-29 (independent review, merged from §Who owns a frame's memory):* the 64 MiB is not V8's trigger; external memory starts marking past a limit that grows its low by a factor (`heap-controller.cc` 307–315, 487–490), so the slack is proportional and the + 324–350 is not sourced: the rule decides | floor + window + 1.5–3.0 × what survived the last collection: the contents count as cell memory, removed from the sender at the transfer. + 128–512 MiB over the window: **misses**. *Corrected 2026-10-29 (independent review):* the excess is (1.5–3.0 − 1) × what survived (the trigger is that × the factor; the 128–512 is already so); at 1.5 on a 234 MiB window, floor + 351 against + 346, inside the A/A's 64: the rule decides there, and misses at 3.0 | the sender's estimate falls to 0 at the transfer; the next collection proportional to the live heap: misses, as Gecko (the factor 2 under a quarter of RAM, 1.5 under a half: `runtime/OptionsList.h` 219–226, added in review) |
| `transfer-k` | as `transfer` at full speed; in `m5-busy` the window + ≤ 6 frames (156 MiB), where `transfer` holds every frame waiting, about half of them at 200 ms against 98 | the same | the same |
| `disk` | floor + one read buffer, 300–370 MiB (the floor's 531–537 less a window, plus 26; *corrected 2026-10-29, independent review:* that is 301–329, the 370 from `ring`'s predicted 600): the sync handle writes through the renderer's own file, so the samples sit in the page cache, outside PSS. Meets the memory bar; **misses the time bar**, ~22 ms in hand (M1) against ~0 | the write a stream copy into the content process's file, returning the bytes copied; floor + one read buffer; misses the time bar alike | the write and read through the handle's file; not run |
| `today` | as pre-registered, 2.6–3.2 GiB | as pre-registered, 0.6–1.2 GiB | — |

**Predicted outcome:** `disk` misses the time bar on both engines (22.3 > 16.7 ms), `transfer` misses the memory bar on
Firefox, so `ring` is chosen: (c), as recommended above. *Corrected 2026-10-29 (independent review):* neither miss follows
from the sources alone (both corrections above); `ring` is chosen only if `disk` and
both `transfer` arms each miss on an engine. On 512² frames the read is 0.7 ms (M1) and `disk` would meet
the time bar; M5 runs only the mammogram, where the two bars disagree, and says nothing of a CT series.

**Mutants**, each a stand-in written over its file by the rig, each caught in one smoke round on both engines (no
smoke number here is a result): `slots-never-freed`, the view never frees a slot, stalls the fill after nine frames
(completeness, within 120 s); `fresh-when-dry`, a decoder takes a fresh `SharedArrayBuffer` when the ring is dry
(frames outside the ring); `credits-ignored`, the ack dispatches but the gate is gone (in `m5-busy`, more than K
waiting); `disk-keeps-frames`, the decoder posts a copy in `disk` and the view keeps a window (peak bytes held).

**Amended 2026-10-29, before any data**, closing the independent review's four open items on the harness (PR #241):

* **`m5-busy` has its own A/A.** It runs `ring` and `ring′` interleaved with the two `transfer` arms, and is VOID by the
  main cell's thresholds: the median |`ring′` − `ring`| over 64 MiB, or the median `ring′`/`ring` fill time outside
  0.90–1.10. A VOID busy cell decides nothing about credits. `ring` there is reported, not ruled.
* **The time bar holds on each path.** An arm meets it if its median ask is within `ring`'s median ask + 16.7 ms, and
  its median step is within `ring`'s median step + 16.7 ms. `summary.py` used to pool the six times into one median.
  That reading let through an arm whose steps alone miss, so this changes the rule's meaning, not just its code.
* **A decoder that fails after taking a slot frees it.** The view reports the slots still marked as decoding at its
  end (`slotsDecoding`). A fixture, `throws-after-slot` (the fill's last frame fails after its decoder takes a slot),
  must end with 0. Its mutant, `throws-slot-kept`, drops the release and must end with 1.
* **`--mutant` on an M5 cell without a valid `--arm`** is refused with the arms listed (it crashed before).

**What smoke changed in the rig**, before this text was final: a stand-in routed by Playwright never reached a script
loaded by a worker's own worker, so the credits build had not bound; every stand-in is now written over its file and
put back after each browser, in both engines, M2's included. M5's series (2.03 GiB) is over the 1 300 MiB site limit
the rig set for M3, where Gecko's write comes back short without throwing (above), so M5's cells set 4 096 MiB and the
decoder counts a short write as not stored. Firefox now runs any cell (the pre-registration's "rig change, made in the
later row"). Not run: M5 itself, WebKit, and the 13 GiB follow-up, which keeps its condition on `ring` being chosen.
*Corrected 2026-10-30:* M5 has run (below); WebKit and the 13 GiB follow-up have not.

| claim, 2026-10-29 | source |
| --- | --- |
| Chromium: a sync handle reads and writes through a file the renderer holds | `third_party/blink/renderer/modules/file_system_access/file_system_access_regular_file_delegate.cc` 22–25, 51–61, 63–90 |
| Gecko: a read or write is a stream copy on an I/O queue into a stream deserialized in the content process; it returns the bytes copied | `dom/fs/api/FileSystemSyncAccessHandle.cpp` 523–630, 633–642 |
| WebKit: read and write through the handle's file | `Source/WebCore/Modules/filesystem/FileSystemSyncAccessHandle.cpp` 128–170 |
| Gecko: a transferred buffer's contents leave the sender's count | `js/src/vm/ArrayBufferObject.cpp` 3110–3123 |
| JSC: a transferred buffer's contents detached from the sender; a wrapper's estimate is its contents | `Source/JavaScriptCore/runtime/ArrayBuffer.cpp` 498–522; `runtime/JSArrayBuffer.cpp` 81–86; `runtime/ArrayBuffer.h` 379–383 (added in review) |
| JSC: the heap's growth factors (added in review) | `Source/JavaScriptCore/runtime/OptionsList.h` 219–226 |
| HTML: a port's message queue, with no bound given | `source` 134810–134816 |

**M5, run 2026-10-30.** The rows are [`lab/opfs-cache/rows/m5/`](https://github.com/dary-dc/wt-pacs/tree/91069eb31e8816bcd4460322e38e8f719a5c0c07/lab/opfs-cache/rows/m5), with the smoke
rows beside them in `m5-smoke/`, at `claude/core-m5@91069eb3`, not in this tree; `python3 lab/opfs-cache/summary.py
lab/opfs-cache/rows/m5` there prints every number below. The host is the 4-vCPU, 16 GiB container. The browsers are Chrome for Testing 153.0.8010.12 headless, and
Firefox 159.0 on Xvfb. The decoders are the pinned builds of `claude/decoders-committed`, each file checked against
`manifest.sha256`. Each cell ran 7 rounds in `lab/order.mjs`'s order. WebKit did not run.

**The verdict, by the rule as written:**

* **Chromium: `ring`.** It is the only arm that qualifies. The cell is not VOID: the A/A differs by a median 4 MiB,
  and `ring′` fills in 1.05 × `ring`'s time.
* **Firefox: VOID.** The A/A differs by a median 92 MiB, over the 64 MiB limit, because three of its seven pairs hold
  a run that never received a frame (*Firefox's fills that never start*, below). A VOID cell decides nothing on Firefox.
* **M5 as a whole cannot be applied.** The rule wants the simplest arm that qualifies on both engines, and Firefox
  gives no verdict. Choice 2 returns to the owner with Chromium's verdict and the numbers below.
  *Corrected 2026-10-30:* Firefox, run again with the driver fixed, is not VOID and qualifies no arm (`ring` misses
  only the fill bar), so the rule now applies on both engines and says the same: choice 2 returns to the owner
  (*Firefox, run again*, below).

| arm | Chromium growth, median [range] | fill / `today` | in hand, ask / step (ms) | Chromium | Firefox growth, median [range] | fill / `today` | in hand, ask / step (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bar | `disk` + 320 = **684 MiB** | ≤ 1.10 | `ring`'s + 16.7 | | `disk` + 320 = **881 MiB** | ≤ 1.10 | `ring`'s + 16.7 |
| `ring` | 580 [572–581] | 1.01 | 0.03 / 0.03 | **qualifies** | 810 [158–877] | 1.41 | 0.02 / 0.03 |
| `ring′` | 576 [562–580] | 0.98 | 0.03 / 0.03 | A/A | 815 [166–851] | 1.37 | 0.02 / 0.02 |
| `transfer` | 957 [828–1 021] | 1.02 | 0.02 / 0.01 | misses the memory bar | 1 037 [957–1 191] | 1.72 | 0.02 / 0.00 |
| `transfer-k` | 885 [767–1 007] | 0.99 | 0.02 / 0.01 | misses the memory bar | 1 078 [902–1 176] | 1.75 | 0.02 / 0.00 |
| `disk` | 364 [357–369] | 0.93 | **19.5** / 10.1 | misses the time bar on asks | 561 [178–608] | 1.39 | **26.1** / 13.4 |
| `today` | 2 748 [2 687–2 866] | 1 | — | reported | 2 226 [155–2 288] | 1 | — |

Every round of every arm on Chromium filled, and every frame was exact by both checks. On Firefox, `transfer` and
`transfer-k` have six rounds, not seven (below). Both engines' `transfer` arms qualify on the time bar and
miss only on memory.

* **`disk` misses only because the time bar holds on each path**, amended before any data, above. Its asks during
  the fill take a median 19.5 ms (10.2–29.5) against a bar of 16.7. Its steps after the fill take 10.1. Pooled, the
  six times have a median of 11.1 ms, which would have passed, so the reading is said here. The doc's own words, "an
  arm's median asked-frame time", give a miss too. The asks run while three decoders hold the CPU; the steps run on a
  quiet host. M1's 22.3 ms (R / n) and this cell's 19.5 sit 13 % apart.
* **`ring` waits for a slot 71 times a fill**, every frame past the ring's nine, against "slot waits near zero with
  OPFS" (predicted, pre-registration). That prediction was wrong for this build: the lab's window is the whole ring, so a
  slot frees only when the ring runs dry. It costs no fill time (1.01 × `today`).
* **Firefox does not bound `today`**: 2 226 MiB against the 0.6–1.2 GiB predicted from the sources' collection
  triggers. The source reading in *What each engine's collector sees* does not hold for this page on Firefox 159;
  why is not traced.
* **The other predictions:** `ring` on Chromium, 530–600, holds at 580. `disk` on Chromium holds at 364 inside the
  pre-registered 300–370, but not the corrected 301–329. `transfer` misses on both engines, the case the rule had
  left open.

**Firefox's fills that never start.** Five of the 40 runs in Firefox's `m5` stopped at the start and received no frame
in 120 s, with the CPU idle: `ring` and `disk` in round 1, `ring′` in round 4, `today` and `ring′` in round 5. The
same happened to one run in `m5-busy`. `today` is the product's own page, which said "decoders: none yet": so the
fault sits beneath the lab's arms, in the downloader with its nested decoders or in Firefox's WebTransport dial.
~~Which, is not traced: the page logs nothing before its first frame.~~ Chromium never did this, in its 70 timed runs.
*Corrected 2026-10-30: traced, and it was the rig's driver* (*Firefox's start fault, found*, below).

Firefox also twice failed to start a WebDriver BiDi session in 60 s, which killed the cell. *Rig changes during the
run, which change no measurement:* each BiDi call fails in 60 s instead of hanging, a browser that does not start
is started once more, and `--first-round` resumes a cell in its order. Firefox's `m5` resumed at round 3, after the
first hang held for 52 min, and at round 6. `m5-busy` resumed at round 5. Rounds 5 of `m5` and 4 of `m5-busy` kept
the arms run before the cell died, so `transfer` and `transfer-k` have six Firefox rounds, not seven.

**Firefox, with the runs that never received a frame set aside.** This is descriptive, not the rule:
`summary.py --set-aside-start-hangs`. The A/A becomes 39 MiB and 1.02, not VOID. The bar becomes 882 MiB, from
`disk`'s 562. Still no arm qualifies on Firefox:

* Every arm misses the fill-time bar, at 1.37–1.75 × `today`.
* `ring` meets the memory bar (822 [798–877] against 882) and the time bar.
* `disk` also misses the time bar on asks (26.1 ms).

Read that way, the rule says *none: choice 2 returns to the owner*.

The fill bar compares different ends. `today`'s fill ends at its last frame delivered, ahead of its store's writes,
while each arm writes a frame before posting it. When `today`'s fill ended, 68–75 of 80 frames were on disk on
Chromium and 50–54 on Firefox. Firefox's page cache had grown 1 394 MiB for `today` against ~2 000 for the arms.
The rig's wall time to `today`'s last write on Firefox, page load included, was 9.5–10.9 s, about the arms'
fills (8.0–9.9 s). On Chromium the writes keep
up and the bar compares like with like; on Firefox they do not. The bar is pre-registered, so it is reported as run;
how much of Firefox's miss is that gap is not measured.

**`m5-busy`**, the view held 200 ms a frame:

| arm | Chromium growth | most waiting | Firefox growth | most waiting |
| --- | --- | --- | --- | --- |
| `ring`, `ring′` (A/A) | 571, 577: 4 MiB apart, fill 1.00 | 5–6 | 778, 808: 30 MiB apart, fill 0.99 | 5–6 |
| `transfer` | 1 722 | 40 | 1 835 | 46.5 |
| `transfer-k` | 854 | 6 = K | 1 030 | 6 = K |

Neither engine's busy cell is VOID. Credits hold the port at K exactly, and halve `transfer`'s growth on Chromium and
cut it 44 % on Firefox. Still, `transfer-k` misses the memory bar on both engines (854 against 684; 1 030 against
881). By the rule credits are *not shown needed*: credits are not enough to qualify `transfer`, and neither
`transfer` arm qualifies anyway. K = 6 stands: at full speed `transfer-k` fills in 0.98 × `transfer`'s time on
Chromium, inside 0.90–1.10, so `m5-busy` did not run again at 12.

On Firefox, `ring′` in round 4 stopped at 46 of 80 frames, every one exact and stored, with no error and the CPU idle.
That is either a slot deadlock that only Firefox's timing reaches, or the start fault met mid-stream; which is not
traced. `ring` never stopped on Chromium, in 28 runs. *Corrected 2026-10-30:* still not traced; the re-run below
says whether it recurs without the BiDi driver.

**The host.** Nothing stopped on the 1 536 MiB floor of available memory. The CPU is 0.66–0.80 busy through the main
cell's fills on both engines, and 0.34–0.45 in `m5-busy`. Three decoders on four vCPUs set the main cell's pace, so
its fill times say nothing of a faster decode; the busy cell is paced by the view's hold.

**The harness, checked live.** The review's mutants ran on stub decoders; here each ran once on the live rig (rows in
`m5-smoke/`, at `claude/core-m5@91069eb3`), and every one was caught:

* `slots-never-freed` stalled at 9 frames on both engines, as predicted.
* `fresh-when-dry` took 28 frames outside the ring on Chromium and 29 on Firefox. Firefox's first run of it never
  started (the fault above) and was run again.
* `disk-keeps-frames` held 293 MiB on both engines.
* `credits-ignored`, in `m5-busy` on Chromium, had 34 frames waiting against K = 6.

The fixture `throws-after-slot` held on both engines, with 0 slots lost. Its mutant `throws-slot-kept` was caught on
Chromium, with 1 slot lost; it was not run on Firefox.

**What this decides.** On Chromium, transferred buffers miss the memory bar at full speed, credits or not, and the
ring meets every bar: for the view-worker target, the ring on Chromium. On Firefox nothing is decided, by the rule
or out of it: the cell is VOID, and set aside it qualifies no arm. So the owner decides:

* **Choice 2** (ring or transferred buffers).
* **K.** Credits bound the port exactly; on `transfer` they do not bring memory under the bar.
* **The fix for M2 (#204):** `ring` holds Chromium's fill at 580 MiB, against 2 748 for `today`.

Two things would let the rule decide on Firefox: the start fault found and fixed, and the fill bar's two ends made
the same. Both are changes to the protocol after data, and so a new pre-registration.

**Firefox's start fault, found (2026-10-30).** It was the rig's driver, not the product and not the lab's arms.

* **Where it stops.** Stage marks logged to Firefox's stdout, in four hung starts on the live pages (BiDi-driven, as the
  M5 rig drove), all show the same thing: the downloader's worker entered its second or third `new Worker(...)` for a
  decoder and never returned. Its thread so never took the `dial` message the consumer had already posted, and no
  session reached the server; the decoders already made came up and idled. The marks are in
  [`rows/m5-start/hung-stages.txt`](https://github.com/dary-dc/wt-pacs/tree/91069eb31e8816bcd4460322e38e8f719a5c0c07/lab/opfs-cache/rows/m5-start/hung-stages.txt) (at `claude/core-m5@91069eb3`, as are the rows below).
* **Why, from Gecko's source (Firefox 159, a reading, not stepped through):**
  * A WebDriver BiDi session registers a worker-debugger listener in every content process
    (`remote/shared/messagehandler/RootMessageHandler.sys.mjs`, its constructor; `WebDriverWorkerListenerChild.sys.mjs`).
  * With any listener present, a worker that creates a worker blocks in `WaitForIsDebuggerRegistered` until the main
    thread registers the child (`dom/workers/WorkerDebuggerManager.cpp` 227–250).
  * The main thread ends that wait with `mCondVar.Notify()`, which wakes one waiter (`dom/workers/WorkerPrivate.h`
    303–312, 340–353). The child's own thread is already started by then (`WorkerPrivate.cpp` 3278–3298) and waits on
    the same condition variable for its events (4824–4832). When the one wake-up goes to the child, the parent sleeps
    forever, with the CPU idle.
  * The product never meets this outside automation or a debugger: without a listener the parent does not wait.
    Firefox's DevTools register listeners too, so a developer with them open might. Not tested.
* **Measured.** On a page whose worker starts 300 workers one after another
  ([`test/nested-workers.html`](../../../lab/opfs-cache/test/nested-workers.html)), 10 rounds interleaved: under BiDi every
  round hung, after 3–273 starts; under Marionette every round reached 300, in 1.8–3.6 s
  ([`rows/m5-start/nested-workers.jsonl`](https://github.com/dary-dc/wt-pacs/tree/91069eb31e8816bcd4460322e38e8f719a5c0c07/lab/opfs-cache/rows/m5-start/nested-workers.jsonl)). The rule, fixed
  before the rows: Marionette cleared if all its rounds reach 300 and BiDi hangs in ≥ 8 of 10. A first such run was
  discarded whole: a mutant test put the BiDi driver in place under it for a moment, and one of its Marionette rounds
  stopped at 83 ([`nested-workers-discarded.jsonl`](https://github.com/dary-dc/wt-pacs/tree/91069eb31e8816bcd4460322e38e8f719a5c0c07/lab/opfs-cache/rows/m5-start/nested-workers-discarded.jsonl)).
  On the live pages themselves, 50 starts each, BiDi hung 2 and a browser with no driver at all 0
  ([`live-pages.jsonl`](https://github.com/dary-dc/wt-pacs/tree/91069eb31e8816bcd4460322e38e8f719a5c0c07/lab/opfs-cache/rows/m5-start/live-pages.jsonl)); the rule set for those (BiDi ≥ 3)
  was not met, so they alone decide nothing.
* **The fix.** The rigs drive Firefox over Marionette, which registers no listener
  ([`browser.mjs`](../../../lab/opfs-cache/browser.mjs)); `lab/opfs-arms` (at `0920153d`) shares the driver.
  [`browser.test.mjs`](../../../lab/opfs-cache/browser.test.mjs) checks its framing and, with `FIREFOX_PATH`, the 300 nested
  workers; the gate runs it. Both mutants were caught: framing that counts characters, not bytes, and the driver put
  back on BiDi (stopped at 3 of 300).

**Firefox's fill, ×1.41 of `today`: where the time goes.** One `ring` and one `today` fill per engine, twice, on the
M5 run's code with per-frame stage marks added and no driver at all (the browser opened on the page's URL, its console
read). The marks, the patch and the reader are in [`rows/m5-profile/`](https://github.com/dary-dc/wt-pacs/tree/91069eb31e8816bcd4460322e38e8f719a5c0c07/lab/opfs-cache/rows/m5-profile), at `claude/core-m5@91069eb3`, not in this tree. Two
fills an arm: indicative, not a measurement by the protocol.

| fill | decoders' first decode → last post | decode | samples into place¹ | OPFS write in the decoder | the store's writes |
| --- | --- | --- | --- | --- | --- |
| Firefox `ring` | 12.0 s, 9.1 s | 13.7 s, 14.8 s | 2.4 s, 2.6 s | **18.6 s, 8.9 s** (median 186, 38 ms a frame) | — |
| Firefox `today` | 7.9 s, 9.2 s | 17.3 s, 18.3 s | 5.1 s, 7.9 s | — | 10.8 s, 11.8 s; the last ends 11.9 s, 13.4 s after the first decode |
| Chromium `ring` | 9.9 s, 8.2 s | 14.4 s, 13.9 s | 4.6 s, 4.7 s | 9.4 s, 5.0 s (median 127, 31 ms) | — |
| Chromium `today` | 8.3 s, 8.6 s | 17.6 s, 16.8 s | 6.4 s, 7.5 s | — | 8.7 s, 7.7 s; the last ends 10.8 s, 9.7 s after |

Sums are over the three decoders' frames. ¹ `ring`: the slot taken, the copy and the range pass; `today`: the new
buffer, the copy and the range pass. Hashing is 0.6–0.9 s in every fill; posting nothing.

* **It is the rig, not the ring.** The ring's own work, a slot taken and the samples copied in, is 0.7 s over a whole
  Firefox fill, less than `today`'s own allocation and copy. What `today`'s decoders never do is the arms' OPFS write
  before posting, which every arm does (`disk`, with no ring, reads ×1.39 too). On Firefox that write is the slowest
  and most variable step: 38–186 ms a frame, against 31–127 on Chromium.
* **And the bar compares different ends.** `today` defers the same writes to its store worker, which on Firefox
  finishes them 11.9–13.4 s after the first decode: after the ring's last post (9.1–12.0 s). Measured to the last
  frame on disk, the ring is not slower than `today` in these four fills. That is the gap *M5, run* already named;
  closing it is a change to the protocol, and so a new pre-registration.

**Firefox, run again 2026-10-30, with the driver fixed.** The same protocol, rule and bars, run from the M5 run's
own code (its arms, its `today` with #212's store, its server build) with only the driver swapped to Marionette, so
both engines' rows come from the same build. Rows: [`rows/m5-rerun/`](https://github.com/dary-dc/wt-pacs/tree/91069eb31e8816bcd4460322e38e8f719a5c0c07/lab/opfs-cache/rows/m5-rerun), at `claude/core-m5@91069eb3`, not in this tree, beside
a copy of Chromium's, so `python3 lab/opfs-cache/summary.py lab/opfs-cache/rows/m5-rerun` there applies the rule over both
engines. The first run's VOID rows in `rows/m5/` stand as run.

* **Not VOID now.** All 42 runs of `m5` and all 28 of `m5-busy` filled, every frame exact by both checks: no start
  hang, and `ring′`'s stall at 46 frames did not recur (so it was most likely the same fault; not shown). The A/A is
  22 MiB and 1.01 (`m5`), 24 MiB and 1.00 (`m5-busy`).

| arm | Firefox growth, median [range] | fill / `today` | in hand, ask / step (ms) | Firefox |
| --- | --- | --- | --- | --- |
| bar | `disk` + 320 = **862 MiB** | ≤ 1.10 | `ring`'s + 16.7 | |
| `ring` | 828 [790–850] | **1.30** | 0.04 / 0.04 | memory, checks and time bars met; **misses the fill bar** |
| `ring′` | 810 [756–841] | 1.33 | 0.02 / 0.02 | A/A |
| `transfer` | 1 061 [982–1 175] | 1.50 | 0.02 / 0.00 | misses the memory and fill bars |
| `transfer-k` | 1 078 [957–1 168] | 1.57 | 0.02 / 0.00 | misses the memory and fill bars |
| `disk` | 542 [528–584] | 1.27 | **29.1** / 16.1 | misses the fill bar and the time bar on asks |
| `today` | 2 351 [2 202–2 646] | 1 | — | reported |

* **`m5-busy` on Firefox:** `transfer` 1 588 MiB with up to 36 waiting, `transfer-k` 986 MiB with at most 5 (K = 6):
  credits *not shown needed*, as on Chromium; `ring` 823, `ring′` 790.
* **The verdict, by the rule as written: none qualifies on Firefox, so none on both engines: choice 2 returns to the
  owner.** Chromium's verdict stands: `ring`. On Firefox `ring` meets every bar but the fill time, and the fill bar
  is the one *M5, run* and the profile above show comparing different ends: `today`'s fill ended with 42–52 of 80
  frames on disk, its page cache up 1 202 MiB against ~2 070 for the arms.
* **Every Firefox fill was slower than in the first run** (`ring` 9.8 s against 8.4, `today` 7.5 against 5.8,
  medians); the two runs were not interleaved, so the driver and the host are not told apart, and nothing here rests
  on the absolute times. The ratio to `today`, which is interleaved, fell from 1.41 to 1.30.
* **What would let the rule choose:** the fill bar measured to the last frame on disk in every arm, `today` included.
  That is a change to the protocol after data, and so a new pre-registration; read that way, the four profiled fills
  put `ring` at or under `today` on Firefox.

**How the ring works**, in plain words, as M5 built it in the lab: [`arms-slots.js`](https://github.com/dary-dc/wt-pacs/tree/0920153d2a44916c6832a9d8dd0befabc0923681/lab/opfs-cache/arms-slots.js)
(the table), [`arms-decoder.js`](https://github.com/dary-dc/wt-pacs/tree/0920153d2a44916c6832a9d8dd0befabc0923681/lab/opfs-cache/arms-decoder.js) (who takes a slot),
[`arms-view.js`](https://github.com/dary-dc/wt-pacs/tree/0920153d2a44916c6832a9d8dd0befabc0923681/lab/opfs-cache/arms-view.js) (who frees one).

* **The slots.** At the fill's start the view worker carves one `SharedArrayBuffer` into as many frame-sized slots as
  the 256 MiB budget holds: 9 for a 3328×4096 frame (234 MiB). Beside it sits a small table, shared too: per slot a
  state (*free*, *decoding*, *held*) and a take count, and one count of frees. The view and the three decoders all see
  both. No other memory is ever allocated for samples.
* **Who takes a slot.** A decoder, once its decode ends: it walks the table and claims the first free slot with one
  `compareExchange` (*free* → *decoding*), so two decoders cannot claim the same one. It copies the samples in, checks
  them, writes the frame to OPFS, and posts the view the slot's number, not the samples. The view marks the slot
  *held*. The view also takes a slot to read a frame back from disk when it wants one it no longer holds.
* **Who frees one.** Only the view, when it lets a frame go: the one farthest from the frame being looked at. It sets
  the slot *free*, adds one to the free count and wakes any decoder waiting on it. A decoder that fails after taking a
  slot frees it itself (the `throws-after-slot` fixture checks this). Each take adds one to the slot's take count, so
  the view can tell that a slot under a frame it holds was reused since, and read that frame from disk instead.
* **What bounds memory.** The ring is all there is. The samples can never exceed the 234 MiB carved at the start,
  however fast the wire or the decoders, and however slow the view. A message carries a slot number, so nothing grows
  in the ports between threads. That is what M5 measured: 580 MiB on Chromium against 2 748 MiB for `today`, which
  holds a fresh shared buffer per frame that V8 counts as 0 bytes, so it never collects them in time (M2).
* **When the slots run dry.** A decoder that finds no free slot tells the view (a `BroadcastChannel` message, "dry"),
  then sleeps on the free count (`Atomics.wait`, a second at a time). The view lets its farthest frame go, which frees a
  slot and wakes the decoder. So a slow view slows the decoders, and they stop taking frames off the wire: the ring
  is its own backpressure. In M5 it ran dry for every frame past the ninth, about 71 times a fill, because the lab's
  window is the whole ring. That cost no fill time on Chromium (1.01 × `today`). A view that never frees stalls the
  fill at 9 frames: the `slots-never-freed` mutant.
* **What credits K add.** Credits belong to the downloader. It hands a decoder a frame only while fewer than K frames
  are decoded but not yet taken by the view; K = 6 here (3 decoders × 2). With the ring they add nothing: a dry ring
  already stops the decoders, and no message carries samples. In `m5-busy` (the view held 200 ms a frame) the ring's
  port never held more than 5–6 frames, with no credits at all. Credits matter only where each message carries a
  frame's samples, as with `transfer`: there K held the port at exactly 6 and roughly halved the growth, still over
  the bar.
* **What building it into the core would change.** The core's frame store (`client/view/store.js`) keeps frames in a
  `Map` and lets a frame go by dropping it, leaving the memory to the collector. Its decoders allocate a fresh buffer
  per frame (`client/decode/frame-buffer.js`). With a ring:
  * The store would own the slots and the table, sized from its budget. Letting a frame go would mean freeing its slot.
  * The decoders would take their table at `init` and claim a slot instead of allocating.
  * The store's eviction would also answer a dry ring.
  * Every holder of a frame's samples, the paint above all, would check the slot's take count, or copy, before using
    it. A slot is only valid until it is reused.
  * The decoder's wait on a dry ring would block its thread. The lab accepts that (the decoder has nothing else to
    do), the Target says no thread blocks, so the product would need an `Atomics.waitAsync` or a message instead.
  * A series whose frames differ in size, or a second viewport, would need the ring re-carved or a ring each.
  * Cross-origin isolation stays required: the ring is a `SharedArrayBuffer`. `transfer` would not need it.
  * Credits K would stay off on this path.

  None of this is built. M5 decides only which frame memory bounds a fill. Building the ring in is a change to the
  core's frame store and decoders, proposed for review first.

## Options, and what each costs

| option | changes | costs | switch later |
| --- | --- | --- | --- |
| **packed file per series** (choice 3) | one handle, quota failure up front, no index | eviction by series only; one tab per series writes | a format change inside OPFS: drop the cache, refill |
| file per frame (§8.3) | per-frame eviction, several writers | a handle opened per access; quota failure mid-fill | the same |
| window by distance, `Map` (choice 2) | memory bounded by a constant | depends on collection; one constant for every device | the constant is configuration |
| slot ring (choice 2) | memory fixed by construction | the decoders' hand-off changes | structural |
| the engine's limit, LRU to fit, by series (choice 5; *corrected 2026-10-27*, was "own LRU budget by series: the browser never evicts us") | multi-GB studies held up to each engine's quota; fit tested by `truncate` | the browser may still clear the origin unless persisted | configuration |
| ~~a budget of our own (fixed, or a fraction of `estimate()`)~~ *cut 2026-10-28* (`claude/opfs-multigb` 07ffd873): the row above's choice 5 weighs and rejects it, so it is not a second option | a margin we choose | refuses multi-GB studies or never binds; `estimate()` means three things | configuration |
| without OPFS: drop and re-ask | the tab survives | a second decode of a dropped frame | configuration |
| without OPFS: keep all | no frame decoded twice | today's ceiling, the tab at risk | configuration |

## Questions for the owner

1. **The packed file per series, revising §8.3?** It rests on one size per series, which the ingest enforces.
2. **Without OPFS** (Firefox and Safari private windows, a quota too small): past the window's budget, drop the farthest
   frame and ask for it again, or keep everything as today? Per engine: choice 8.
3. **The window's starting budget:** 256 MiB until D5 says what a phone kills a tab by, or D5 first? *2026-10-27:* the
   owner's reply on budgets concerns the store on disk (choice 5); the window, RAM per tab, stays at 256 MiB.
4. **Eviction across series:** plain LRU inside a budget of ours (proposed), or the size- or link-weighted variant now?
   *Answered 2026-10-27 (choice 5):* no budget of ours; least recently opened first, only when a `truncate` is refused;
   a series open in any tab never.

   *A contradiction for the owner (2026-11-14):* `claude/opfs-multigb` 07ffd873 (2026-10-28, the newer text) rewrites
   question 4's note to "choice 5 proposes no budget of ours, eviction only to fit; still the owner's" and drops
   question 3's "the window, RAM per tab, stays at 256 MiB". This file still prints both as answered. Which is the
   owner's answer is the owner's to confirm.
5. **`persist()`** (§8.5): ask for it on the first series opened, or never? Per engine: choice 8. *2026-10-27:* choice 5
   recommends asking, for multi-GB studies; still the owner's.
6. **A series already whole in OPFS:** dial the session anyway (ready for asks, one handshake), or only on a miss?

## Sources, 2026-10-22

Fetched 2026-10-22 for choice 8 and added to [`frame-path-sources.txt`](sources.txt); source files at §9's
pinned commits, MDN at mdn/content `468fcd1`.

| claim | source |
| --- | --- |
| a grant is a permission; persistent buckets cleared only with the user | storage `storage.bs` 498–508, 573–579, 686–690 |
| Chromium: top level only; cookies; installed; 10 important sites; a refusal not stored | `chrome/browser/storage/persistent_storage_permission_context.cc` 68–79, 88–105, 116–128, 130–156 |
| Chromium: what makes a site important | `chrome/browser/engagement/important_sites_util.cc` 190–194, 341–352 |
| Chromium: eviction skips the persisted default bucket | `storage/browser/quota/quota_database.cc` 642, 663–668 |
| Gecko: private windows refused; the prompt; no gesture | `dom/quota/StorageManager.cpp` 318–329, 651–667; `browser/modules/PermissionUI.sys.mjs` 267–269, 1853–1925 |
| Firefox for Android: the dialog, default ask | `…/feature/sitepermissions/SitePermissionsFeature.kt` 936–945; `mobile/android/fenix/…/utils/Settings.kt` 1873–1876, 1929 |
| WebKit: the grant is ITP's exempt set | `NetworkProcess/storage/NetworkStorageManager.cpp` 914–944; `NetworkProcess/NetworkProcess.cpp` 837–846; `Classifier/ResourceLoadStatisticsStore.cpp` 791–800, 2895–2897; `Classifier/WebResourceLoadStatisticsStore.cpp` 775–781, 1590–1597; `UIProcess/WebsiteData/WebsiteDataStore.cpp` 2091–2101 |
| WebKit: quota eviction spares persisted; clearing all data removes the grant | `NetworkStorageManager.cpp` 566–567, 607, 1474–1476; WebKit blog 14403 |
| user clearing; Firefox's persisted quota; engines' prompting | MDN *Storage quotas and eviction criteria* (`index.md` 44, 50–52, 91, 164); web.dev *Persistent storage* (2020-05-12) |

**Not traced:** Gecko's rule for a third-party frame; Firefox for Android's quota; which installs count on Android
Chrome; ITP in third-party iOS browsers and in-app web views; `SFSafariViewController`.

## Sources, 2026-10-27

Fetched 2026-10-27 for choice 5 at §9's pinned commits and added to [`frame-path-sources.txt`](sources.txt).

| claim | source |
| --- | --- |
| the quota must not follow free space | storage `storage.bs` 543–552 |
| `removeEntry` takes no lock | fs `index.bs` 993–1035 |
| Chromium: `estimate()` reports usage + 10 GiB, static by default | `storage/browser/quota/quota_manager_impl.cc` 136–155, 1170–1200; `quota_features.cc` 38; `content/browser/quota/quota_manager_host.cc` 26–31; `content/browser/storage_partition_impl.cc` 1414–1426 |
| Chromium: the enforced limit, its override, and the eviction round's trigger | `quota_manager_impl.cc` 250–256, 1346–1380, 1670–1683; `quota_settings.cc` 127–141; `quota_features.cc` 18–35; `quota_temporary_storage_evictor.cc` 25, 188–211 |
| Chromium: `truncate` and growing writes ask for quota; the file sized by `ftruncate` | `…/file_system_access_regular_file_delegate.cc` 76–81, 112–123; `base/files/file_posix.cc` 450–456 |
| Gecko: the limits, `estimate()`, eviction skipping persisted and open origins | `dom/quota/ActorsParent.cpp` 1413–1440, 2137–2172, 8377–8390, 8410–8455 |
| Gecko: `truncate` checks quota | `dom/fs/api/FileSystemSyncAccessHandle.cpp` 322–356; `dom/quota/FileStreams.cpp` 27–42, 84–97 |
| WebKit: the reported quota, doubled with usage, capped | `NetworkProcess/storage/OriginQuotaManager.cpp` 34, 175–185; `NetworkStorageManager.cpp` 750–785 |

**Not traced:** each engine's `removeEntry` on a file another tab holds; WebKit's `truncate` at the OS; WebKit's
standard volume capacity; how often a phone's free disk binds before its quota.
