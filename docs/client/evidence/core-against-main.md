# The core, assembled and timed against main

**Question:** Does the assembled core keep main's throughput and latency?

*Moved 2026-11-14 from `docs/adr/frame-path.md` at `e5b20cba` (§The core, assembled), word for word but for queue-row
names. A bare §N or §Name is a section of that ADR: [its map](../../adr/frame-path.md) names the file each now lives
in. Choices 1–8 are [the cache's](cache-in-opfs.md#the-choices-and-what-decides-each). The design these findings shape
is [`../design.md`](../design.md).*

## The core, assembled (2026-10-30)

**Decided by the owner, 2026-10-30:** *"We won't build visualizers for now. We build the new architecture (core)
while investigating, testing and improving the diff options. And ideally land in a single PR, that even if big it
will be easier to localize. Native client can have similar module architecture, threads might be different. In any
case, we build the architecture now, but modules like the view worker's for a complex viewer will be too much and
isn't even designed, so we stick with the simple cine for now."*

So the core is the Target above, built once on one branch (`claude/core`), with only the simple cine on top: no
viewport layout, hanging protocols or tools, and no ingest change. **Every design option still under investigation
is a setting inside the core whose default is today's behaviour**, until its pre-registered rule decides it.

**Modules, and the thread each runs on.**

| module | does | browser, `?view=page` (default) | browser, `?view=worker` (the Target) | native, `--paint-thread` `ui` (default) / `view` / `core` |
| --- | --- | --- | --- | --- |
| downloader | session, a record per owed frame, survival, the wire; sends the want's misses as asks or runs | its worker | its worker | the UI's runtime / its own thread / the core thread |
| controller + want | the current frame, what is wanted in what order, the cine clock | the page | the view worker | UI thread / view thread / core thread |
| frame store (+ OPFS cache) | memory → cache → downloader; acks a frame once held; evicts farthest-first, only once written | the page, no cache (main's) | the view worker; the cache under a lab `writer` | UI thread / view thread / core thread; a file per frame |
| decoders | decode, XXH3 against the ingest's digest, hand on the samples | nested workers of the downloader | the same | `N` decoder threads |
| paint | WebGL2 / wgpu, the VOI table, display state | the paint worker | a module of the view worker | UI thread / view thread / core thread |

The page holds intents and events only under `worker`; under `page` it is today's viewer. Native has the same modules;
only the threads differ ([`../native/README.md`](../../native/README.md) §Built, #247).

**Settings.** Each is printed with the arm it ran in; a default changes only when its rule says so.

| setting | default (today's) | other values | decided by | status 2026-11-02 |
| --- | --- | --- | --- | --- |
| `?view=` | `page` | `worker` | §7's rule (B′), #229 | **run (#263): "A stays — `?view=page` remains the core's default"**; B′'s quiet first frame later by ≥ 16.7 ms in five decided cells, no decided cell with its asks sooner (§7). Against main (#261): "`?view=worker`: not judged; both runs point the other way" (§*The core against main, timed*). **Its start, timed (#276):** "B′ is behind A" on latency in five cells, tied on throughput in all six multi-frame cells; the delay is all before the first byte — the view worker's boot ahead of the downloader's `start`, and on the mammogram one round trip more. **With the fix** (`pageDials`, `viewWorkerFirst`, `shortRuns`, lab settings, defaults off): "B′ with the fix does not tie A" — "behind A: Chromium tomosynthesis 1× first", +21 ms; at 4× "behind A: Firefox mammogram 4× first", +188 ms (§7, *The view worker's start, timed*). **Corrected 2026-10-31 (#275):** §7's Firefox draw wait was our one-pixel read — "the wait was the read" in both decided Firefox cells; settled by a fence, "B′ keeps cine on time where A misses", on both engines (§7, *The pixel read under a busy page*). §7's verdict stands. *Corrected 2026-11-14, from three later runs:* the start with its levers split: B′ with the fix ties A in every decided cell, all at 1×, none at 4× decided ([the start](view-worker-start.md), `claude/core-start2`); §7 again with both fixes, Chromium: "A stays", on the asks ([§7](page-out-of-pixel-path.md), `claude/core-s7-fixed`); asks scored on the mean: "B′ wins the busy page" on both engines, the default unmoved ([the busy page](view-worker-under-a-busy-page.md), `claude/core-busy2`) |
| `opts.span`, held frames a run may cross | `0` | `g` | §Experiment 1, #243 (review #248) | **not run (#266): "Verdict: not run; `span` stays 0"** — the review finds the rule unmeetable on the model (S 1.90–1.96× A against ≤ 0.6×); removing `span` and `holdEveryOther` is the owner's (§Experiment 1: not run) |
| `opts.waitAhead`, the want ascending and no ask within `k` of the running fill | off | `k` | §Experiment 2, #246 | **run (#265): "Verdict: k\* = 8, adopt k = 8, by the rule as fixed"; the default left to the owner** (§Experiment 2, *The default*): 12 of 12 rounds on every decided CT cell, both engines; DBT undecided at k = 8 |
| `opts.pixels`, a decoded frame's memory | `shared` (`SharedArrayBuffer`) | `transfer` | §Experiment 3, #245; M5, #226/#241 | answered by M5: `transfer` misses the memory bar on both engines (Firefox: "misses the memory and fill bars") |
| frame memory: slots, disk-only; credits `K` | none, no credits | ring of slots, disk-only, `K` | M5, #226/#241; Firefox re-run, #264; the amended fill bar, `claude/core-m5b` | **run on both engines under the amended fill bar (`claude/core-m5b`): "`ring`, on both engines"**: the only arm that qualifies on either, fill to disk 0.96 × `today` on Chromium and 0.85 on Firefox 155, every other bar unchanged. Under #264's bar the same rows say none on Firefox (1.23). Credits not shown needed. The default stays `none`: building the ring in is proposed for the owner, not built (*What building it into the core would change*) |
| `?writer=`, who writes the OPFS cache | `none`: no cache, as main | `store`, `decoders`, `view` | OPFS arms, #227/#242; #244 | **run on Chromium 153 and Firefox 159 (`claude/opfs-arms-run`): "no arm passes on either engine, so the result goes to the owner as measured"** (§Arm D, Results). Chromium's D fails only rule 3, its clock at S1 4×; Firefox's D fails rules 2 and 3. Amended and run again on Chromium 2026-11-04 with C-shared and A-left (`claude/opfs-c-shared`): no arm passes, to the owner as measured ([the cache I/O](cache-io-thread.md)) |
| frame clock | the page's timer | worker rAF, timer to a schedule, `MessageChannel`, `Atomics.wait` | #225 | harness built (#249) and smoked: the guard saturates every cell but 512² at 30/s, quiet, 1×; the run not started. *Corrected 2026-11-14:* run in Chromium 2026-11-03 (`claude/core-clock`): no verdict, every 512² cell saturates under the fence settle, 30/s quiet 1× included ([the frame clock](frame-clock-in-a-worker.md)) |
| receive loop, the downloader in the view worker | its own worker | merged | #237 | rig in `lab/recv-loop` at `cf38708b` (`claude/recv-loop`) only; needs a GPU host |
| native `--paint-thread`; `--credits`, `--budget` | `ui` | `view`, `core`; `K` 4, 64 MiB | #247 | built and reviewed (#253); the run's own pieces not built |

Each run writes its verdict in its own section.

**Waiting on the owner** (2026-11-02; the evidence is each row's section):

1. *`waitAhead`'s default:* Experiment 2's rule adopts k = 8; flipping the code's default is the owner's merge.
2. *M5's ring:* with the fill bar amended before data to the last frame on disk, the rule chooses `ring` on both engines
   (`claude/core-m5b`). Building it in is structural: the steps are proposed under *What building it into the core
   would change*, behind `opts.pixels=ring` with `shared` the default. That needs the owner's review, and then a run of
   the core's own fill before any default flips. Firefox here was 155.0, not 159.0.
3. *The default view:* `page`, as §7 and #261 agree. The start's fix does not tie A, so no later `worker`-against-`page`
   run is queued. *Corrected 2026-11-14:* with its levers split the fix ties A at 1× (`claude/core-start2`), and §7 was
   run again with both fixes on Chromium: A stays, on the asks (`claude/core-s7-fixed`).
4. *`span` and `holdEveryOther`:* the review advises removing both, code no rule will turn on by the model; the other
   path is its one-cell check of the model's sign first (`us_liver`, `r20000`, 46 ms, Chromium, 3 rounds).
5. *The cache's writer:* no arm passes on either engine. Whether rule 3's 0.10 × decode was the right bar is a new
   pre-registration, not a re-reading. The Results do not say whether Firefox's BiDi start hang (§*Firefox's fills that
   never start*) touched its Firefox rows, which came from the BiDi driver; not checked.
6. *Carried:* #250's relayed scope; the cine fix (#251), to redo on the core's controller; M1–M4 re-run under
   `?view=worker&writer=store` or recorded unbacked; the GPU runs this container cannot claim (#206, #214, #237, every
   presented-on-time claim); native's #211 (does a tie inside the A/A close step 1) and #209 (a cache write error
   aborts the fill).

**What runs next:** the frame-clock run (#225's protocol, on a branch from `claude/core`), at a usage window's start;
on this container only the 512² 30/s quiet 1× cells can be claimed, and the protocol is amended before data if it
cannot decide as written.

*The cache's default.* The owner decided an OPFS client cache on 2026-10-10 (§1), but main has none, so `none` keeps
main's behaviour; turning it on is the owner's call, not this branch's. The cache is the frame store's alone: #212's
wiring into the page's old viewer is not carried, so `lab/opfs-cache`'s M1–M4 cells, which drive `?view=page`, have no
cache to measure on this branch until they name `?view=worker&writer=store`; their rows stand as run on #212.

**Folded in,** with `git merge --no-ff`, bases first: the unified branch (for the native line); #228, #231, #232,
#235, #239, #237; #229, #238, #243 (+#248), #246, #245, #244; #225; #212's client-cache line, then #226 → #241 and
#227 → #242 with the M5 and OPFS-arms runs; #247 with #189 → #198 → #201 → #206/#209 → #216 → #218 → #236 → #240; and the follow-ups of their
sessions as they are pushed. `claude/cine-no-skip` (the simple cine's skip fix) is not folded in: it is
built on #210 and the page's viewer before #229, so it carries the viewer product's #210 with it. Each conflict and its resolution is recorded in the PR. **Superseded** once this lands
(the owner closes them): every PR above. **Out:** the viewer product (#193, #210, #214, #215), the ask-during-fill
lever (#135), ingest.

### Independent review of the assembled core (2026-10-30)

A read of the merged result, not of its parts (`claude/core-review`, PR #262; the review itself is on #250). Each
defect has a test that fails on the assembled code, a fix, and the mutants the test kills.

* **The frame store, under a budget.** A frame that arrived and was then evicted still counted as asked, so a want
  with the same misses was never sent and a step to that frame waited for good. The store now drops a frame from what
  it has asked once the frame arrives. At equal distance it let go the frame inserted first; it now lets go the
  earlier frame, which the want ranks last (#253's fix to the native store). The view worker still passes no budget
  (§Experiment 3), so neither defect could be reached on this branch. The budget is how the store is meant to run.
* **Settings the page view took and ignored.** `writer`, `waitAhead` and `holdEveryOther` act only in the view
  worker, and `pixels: "transfer"` there copies each paint. Under `?view=page` all four are now refused by name, so
  a run cannot label an arm it never ran. The writer's own two refusals moved beside them into
  `lab/viewer/levers.js`, where they got their first test.
* **The view worker's lab cine.** A `pause` sent while `play` still loaded the clock was lost, and two plays left the
  first cine running with nothing to stop it. Each play and pause now steps a cue.
* **The native downloader.** A frame read from the cache that failed its check was put first in the want, even when
  the view had replaced that want since. It was then asked ahead of the frame on screen. The frame now goes first only
  under the want it was read for.

* **The viewer check in Firefox.** Firefox 155 quotes a Latin-1 character in `console.log` as `\xNN`, which
  `JSON.parse` refuses. Every Firefox run therefore died on the status line's middle dot, though the page had passed.
  With the reader fixed, the gate's grey series passes in Firefox under both views, with a cine and on demand
  (headed, `xvfb-run`). This is outside the gate, whose Firefox arm needs the DICOM bundles.

Checked and found as both sides meant: each merge resolution recorded on #250; the defaults under `?view=page`
against main's viewer (cine period, steps, window drag, ledger shape); `span` 0 reproduces main's run; the downloader
link's ordering; the cache's paint-first write, its re-ask of a failed read and its lock.

### A second independent review of the core (2026-11-02)

A read of the product code `claude/core-fold-2026-11-02` (#289) carries over `main` (`client/view`, `client/transport`,
`client/decode`, `client/paint`, `client/viewer`, `server/src`, `common/fod`), on `claude/core-review2`.

* **Fixed: a frame decoded twice.** A want's head that the ended run had in flight crosses twice, on the run and on
  its ask. Whichever copy landed second re-queued the frame's record and sent it to a decoder again, so the frame on
  screen was decoded twice, reached the consumer twice and was counted twice in `stats().exact`. Only a record still
  on the wire takes bytes now (`downloader.js`, `arrived`). The test (`aHeadThatCrossesTwiceIsDecodedOnce`) failed on
  the fold, the frame dispatched twice; it catches the old check (`!rec`) and a check that drops only a queued record.
  An ask during a fill on `main` can cross twice the same way (`askFor`, by reading), and the fix covers it. How often
  either happens is not measured.
* **Proposed: the product's paint no longer waits for its draw.** `main`'s paint read one pixel after every draw.
  The core's product paints unsettled (`settle` unset), so `drawn`, `firstShownMs` and `shown` stamp the draw's issue,
  and the controller's one paint in flight no longer bounds what the GPU has queued. This default differs from
  `main`'s and is not in the settings table above. Every §7 and settle arm ran settled (`fence` or `read`), so the
  product's own setting is unmeasured. For the owner: a `settle` row in the table, whose default is either `main`'s
  `read` (which waits on a busy page in Firefox, §7, *The pixel read under a busy page*) or the unsettled paint
  recorded as decided. Before either, the unsettled paint as a sixth arm of that section's cine cell. No code changed.
* **Proposed, names:** `client/view/store.js` is the frame store and `client/viewer/store.js` the store worker, two
  concepts under one file name. The server's `media::frame_store::FrameStore`, the series bundle's reader, shares the
  client frame store's name, and the glossary defines only the client's. Renames are structural, so not done.
* **Proposed: the native ALPN in the product server.** `wt-pacs/1` is always on ([`../WIRE.md`](../../WIRE.md) §The raw
  QUIC mapping) while the native client is an experiment. Whether a deployment offers it is the owner's call.
* Noted, not fixed: the memory window's budget is bytes in its design (§Proposed, choice 2) and frames in
  `FrameStore`. Under a budget, the controller's `received` counts a frame again each time it is let go and comes
  back, so `have` can pass `total`. No caller passes a budget. `ViewWorker.close()` on a view worker already ended
  leaves its rejection unhandled. Only the viewer check closes.
* Simplified: the close deadline is defined once, in the consumer. In the glossary, the fence settle polls on a 1 ms
  timer, as `settle.js` does, not once a task.

Checked by reading and found as meant: the server's endpoint, built by hand for two ALPNs, sets what wtransport 0.7.2's
`ServerConfigBuilder::build` does (its crypto, the transport configuration, migration on; dual-stack, then IPv4 any).
The FoD length check moved to `common/fod` unchanged. A per-frame stream's `finish` and `stopped` are what
wtransport's `finish().await` did. The view worker's lifecycle under a fatal error, a downloader that does not load,
and a session lost past its re-dials, under `?view=worker`: each said, and a later step's want re-dials. The default
`?view=page` path is `main`'s viewer step for step (asks, cancel, cine, drag), but for the paint above.

### The core against main, timed (2026-10-30)

Until now the core equals `main` by counts only (the gate's *perf: counts, not clocks*). The owner expects **throughput
no worse and latency the same or better.** Written before any data; the rows and the reading follow below it.

**Arms.** `scripts/perf_nightly.mjs`: BASE a worktree of `origin/main` (`0cf5424`), HEAD a worktree of
`origin/claude/core` (`2e6fa5b`), and BASE again as the A/A arm; `lab/order.mjs`'s order over cells, and over the three
arms inside each cell; every visit its own server, relay and Chromium. Both trees carry the decoders built on
`claude/decoders-committed` (each checked against its `manifest.sha256`) and fetch the nightly's pinned OpenJPH and XXH3.
The gate's grey codestream × 48, every frame hashed against its truth.

* **Campaign 1, the core at its defaults:** the nightly's own page (`lab/av1/delivery/total-time/page.js`, the
  downloader driven directly, timed from the fill's issue).
* **Campaign 2, the core under `?view=worker`:** `--view worker` puts every arm on the product's viewer, timed from
  navigation (the only origin the two trees' viewers share), and the head's under `?view=worker`. Not §7's protocol:
  one engine, one synthetic series, a quiet page.

**Cells.** `r50000` clean, and `r50000 l1` (1 % iid loss each way, the harness's lossy link); 1× and
4× (`lab/scripts/cpu_throttle.mjs`); 12 rounds and 12 confirming.

**One measure a claim.**

| claim | measure | quoted as |
| --- | --- | --- |
| throughput | **fill**: issue (campaign 2: navigation) → the 48th exact frame on the page | head ÷ base, the fill's time |
| latency | **first**: the first exact frame (campaign 2: on screen) | head ÷ base |
| latency | **asked**: frame 0 shown, then frames 1–4 asked one at a time, each ask → its exact frame on the page; a visit's median | head ÷ base |

A fill's visit gives fill and first; the asked cell is a visit of its own, campaign 1 only (`--asks 4`: the page
`--fill 1 --asks-after 4`). *Amended before any campaign's data, from a one-round smoke:* main's viewer has no step
hook for the harness (its `lab/viewer/levers.js` predates them; it showed frame 0 and stepped no further, 1 of 4), so
campaign 2 judges fill and first only, and an asked frame → screen under `?view=worker` is not timed against main.

**Predictions, from §2.** Fill ×0.98–1.02 in every cell: neither the downloader's changes nor the view worker sits on
the decoders' path. On a quiet page, the first frame and an asked frame within a display period (16.7 ms) of main's:
the page's hops the view worker removes cost under 1 ms. At 4× a quiet page is still quiet; nothing predicts a
difference there either.

**Rule, fixed before data.** `lab/scripts/aa_rule.py` on each cell with `--confirm`: a cell is *worse* or *better*
only when both campaigns flag it. **"No worse" holds when no cell is flagged worse**; it then claims only to each
cell's detectable loss (the rule's *catches*), and a cell *not conclusive* (that loss over 5 %) is said so, not counted
as a tie. *Better* is reported, and claimed only where the rule flags it. **VOID:** a visit whose relay's self-timing
is late is dropped with its round's other two arms (the strict reading); a cell with fewer than 9 of 12 rounds kept in
either campaign is not judged. **Saturation guard:** on this 4-core container (browser on cores 0–2, relay on 3) the
fill at `r50000` 1× follows the link up to 200 Mbit/s (the nightly timing, [`../../README.md`](../../../README.md) *What the nightly times*), so 1× is
link-bound; 4× is CPU-bound by design. A cell whose A/A median departs from 1 by more than 2 % says the rig drifted
and is not judged. Nothing is claimed for another host, series, engine or a busy page.

**Run 1 (2026-10-30, the harness unpinned as the nightly runs it).** Rows and each campaign's verdict:
[`lab/av1/delivery/total-time/rows-core-against-main/`](https://github.com/dary-dc/wt-pacs/tree/811ea93f0f2913fb37c20051ec68f14041ef3579/lab/av1/delivery/total-time/rows-core-against-main)
`page/` and `worker/`, at `claude/core-perf@811ea93f`, not in this tree; series-server `f36f907e…` (main) and `be058172…` (core). Every kept visit exact (48 of 48, or
5 of 5 asked); no visit failed. Campaign 1 stopped once at round 8 on a dev-server that did not start (a port taken)
and resumed from its kept rows; `perf_nightly.mjs` now retries such a visit.

| campaign · cell | head ÷ base | A/A | rounds kept | `aa_rule` | by the rule |
| --- | --- | --- | --- | --- | --- |
| 1 · clean 1× fill | ×1.004 | ×0.996 | 9 + 10 | tie, catches 1.3 % | **no worse** |
| 1 · clean 4× fill | ×0.998 | ×0.994 | 10 + 9 | tie, catches 2.7 % | **no worse** |
| 1 · clean 1× first | ×1.029 | ×1.029 | 9 + 10 | tie | not judged: A/A off 1 by 2.9 % |
| 1 · clean 4× first | ×1.013 | ×0.921 | 10 + 9 | not conclusive | not judged: A/A off 1 by 7.9 % |
| 1 · clean 4× asked | ×0.989 | ×1.014 | 9 + 8 | not conclusive | not judged: 8 of 12 |
| 1 · the other seven | ×0.905–1.019 | ×0.974–1.037 | 5–10 + 6–9 | none flagged | not judged: under 9 of 12 |
| 2 · clean 1× first | ×1.126 | ×1.011 | 9 + 7 | **worse** | not judged: 7 of 12 |
| 2 · clean 4× fill | ×1.074 | ×0.979 | 8 + 7 | **worse** | not judged: 7 of 12, A/A off 2.1 % |
| 2 · the other six | ×1.011–1.104 | ×0.956–1.027 | 3–9 + 5–7 | not conclusive | not judged: under 9 of 12 |

*Reading.* **Campaign 1 (the core at its defaults): throughput no worse** at `r50000` clean, 1× and 4×, to a loss of
1.3 % and 2.7 %; no cell flagged worse. Latency is not established by the rule in any cell. The medians of kept
rounds stay within a display period: the first frame 139 → 140 ms at 1× and 184 → 190 ms at 4× (A/A 141, 174), an
asked frame 85.5 → 86 ms. **Campaign 2 (`?view=worker`): nothing judged.** 54 of 288 visits were VOID, and no cell kept 9 of 12 in
both halves. The unjudged direction is **against the prediction**, though. From navigation, the first exact frame on
screen took 509.5 → 549.5 ms at 1× clean (A/A 504.5) and 794 → 956 ms at 4×, more than a display period. The fill
at 4× took 876 → 993 ms. The page's view-worker start before its first frame is the likely cost (not measured
apart). VOID ran 14 % (campaign 1) and 19 % (campaign 2) of visits, worst under `l1`.

**Run 2, pre-registered before its data: the harness pinned.** The nightly runs `node` and the dev-server on any
core, the relay's included; row TOTAL4 runs the harness under `taskset -c 0-2`. Run 2 repeats run 1's two campaigns
unchanged but for `taskset -c 0-2 node scripts/perf_nightly.mjs …`, with rows in `page-pinned/` and `worker-pinned/`.
The rule, VOID threshold and guards are the same. Run 2 is read on its own, never pooled with run 1. If its VOID rate
is no lower, the harness was not the cause, and that is said.

**Run 2 (2026-10-30, the harness pinned).** Rows in `page-pinned/` and `worker-pinned/`, the same two binaries. VOID
rose instead: 121 of 576 visits (21 %) and 73 of 288 (25 %), so the harness was not the cause. The relay's p99 ran
late by up to 40 ms on a core 90 % idle, with steal time on it (the VM's own scheduling, sampled once, 1 %).

| campaign · cell | head ÷ base | A/A | rounds kept | `aa_rule` | by the rule |
| --- | --- | --- | --- | --- | --- |
| 1 · clean 1× fill | ×1.000 | ×0.998 | 5 + 9 | tie, catches 4.0 % | not judged: 5 of 12 |
| 1 · clean 4× fill | ×0.999 | ×0.996 | 8 + 9 | tie, catches 3.2 % | not judged: 8 of 12 |
| 1 · the other ten | ×0.859–1.077 | ×0.810–1.138 | 3–9 + 3–9 | none flagged | not judged |
| 2 · clean 1× fill | ×1.044 | ×0.968 | 6 + 9 | **worse** | not judged: 6 of 12, A/A off 3.2 % |
| 2 · clean 4× fill | ×1.146 | ×0.966 | 6 + 10 | **worse** | not judged: 6 of 12, A/A off 3.4 % |
| 2 · clean 1× and 4× first | ×1.055, ×1.076 | ×0.922, ×0.952 | 6 + 9, 6 + 10 | not conclusive | not judged |
| 2 · `l1` | — | — | 1–2 + 3–6 | undecided | not judged |

**What the two runs establish.**

* **The core at its defaults: throughput no worse,** by the rule, at `r50000` clean, 1× and 4× (run 1; run 2 the same
  ties, short of the round threshold). **Latency the same is not established by the rule.** The VOID threshold or the
  A/A guard stopped every latency cell. The medians agree with the prediction in both runs: first frame 139 → 140 and
  145 → 145.5 ms at 1×, asked frame 85.5 → 86 ms in both. No cell of either run was flagged worse.
* **`?view=worker`: not judged; both runs point the other way.** From navigation, the first exact frame on screen took
  509.5 → 549.5 and 551 → 592 ms at 1× clean, over a display period later in each run. The fill took ×1.04–1.15 as long,
  and `aa_rule` flagged it worse, confirmed, three times across the two runs, each below the round threshold. §2's
  prediction (within a display period, fill ×0.98–1.02) is not borne out on this rig. The likely cost is the view
  worker's start before its first frame; that start is not timed on its own here, and timing it is the next
  measurement. The owner's expectation of latency the same or better under `worker` is **not met by these rows**.
* **Where the host saturates:** not by load. The rule is capped by the VM's scheduling noise on the relay's core, and
  `l1` cells, the longest visits, lose the most rounds. Nothing is claimed for `l1`, another host, series or engine,
  or a busy page.
