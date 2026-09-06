# What actually makes a read miss · 2026-09-06

**This document changes a premise the read-path recommendation was resting on.**

`READ-PATH-DECISION.md` (archived: `git show a330783:docs/disk-access/READ-PATH-DECISION.md`) says the miss rate decides which read path
wins, and assumes our deployment sits in the miss-dominated square because *"tens-of-GB
studies on cloud storage, so most reads miss"*. That assumption was never measured — every
miss rate in the campaign came from a synthetic stride against an 84 MB fixture.

It is now measured, and **the assumption is wrong as stated**. Study size does not determine
the miss rate. What determines it is **access sequentiality**, and sequentiality is a
property of the **disk layout**, not of the study.

| Same client asks, same bytes, same 4 GB study, cache too small to hold the cycle | `pool` CPU per read | miss |
| --- | ---: | ---: |
| Layout that leaves reads strided (frame-major, rung prefix) | **105 563 ns** | **99.6%** |
| Layout that groups what is read together (rung-major) | **6 014 ns** | **0.5%** |

**17.6× from the layout alone**, where the read-path choice is worth 2–4×.

⚠️ **But only on one side of a cliff.** Give the same strided layout a cache that holds its
access cycle and it costs **3 976 ns at 0.0% miss** — the layout is then worth **1.50×**, not
17.6×, and hardly matters. The transition between those two worlds is a *step*, not a slope,
and §4.1 locates it. So the honest form is: **the layout decides whether you fall off a cliff;
it is worth almost nothing until you do, and roughly 17× once you have.**

The read-path recommendation itself **does not change**: the hybrid wins or ties in every
cell measured here, and wins by *more* as conditions get harder. What changes is how much it
is worth, and that now depends on a design decision rather than on the deployment.

Raw: [`v15_trace_replay.tsv`](v15_trace_replay.tsv) ·
[`v15_trace_shapes.tsv`](v15_trace_shapes.tsv) ·
[`v17_readahead_ab.tsv`](v17_readahead_ab.tsv) ·
[`v18_shuffle_control.tsv`](v18_shuffle_control.tsv) ·
[`v19_mempressure.tsv`](v19_mempressure.tsv) ·
[`v20_cliff_sweep.tsv`](v20_cliff_sweep.tsv)

---

## 1. The transform: from client asks to disk reads

The chain nobody had written down:

```
client ask schedule  ->  [ layout + rung policy + client cache ]  ->  disk read sequence
```

`lab/traces/*.json` already held the repo's real ask schedules — the scroll with a reversal at
60%, the pure sweep, the scrub. What they never said is *where on disk* those asks land, which
depends on the layout. So `lab/scripts/gen_access_trace.py` takes the layout as a **parameter**
and emits the read sequence for each candidate; `read_campaign --trace` replays it through the
same arms and controls as the synthetic cells.

Two properties of our deployment are modelled explicitly because they change the answer:

* **The client caches every increment** (OPFS/IndexedDB), so a frame is sent once per user. A
  revisit in the schedule produces **no disk read at all** unless it needs a rung the client
  does not have. Dedup is by `(frame, rung)`, not by frame — which is why the 500-step
  `live_cell_scroll` produces 300 reads, not 500.
* **Contiguous spans coalesce into one read.** A frame-major layout serving rungs 0–2 issues
  *one* read; a rung-major layout cannot merge them and issues *three*. Skipping this would
  credit both layouts with the same syscall count and hide the difference that matters.

This is the piece of work that does not depend on the layout design: it prices any layout
proposal without re-running the client experiments.

## 2. Geometry of each candidate — no arms involved

From [`v15_trace_shapes.tsv`](v15_trace_shapes.tsv), `live_cell_scroll` (300 unique frames,
40% revisits), 250 KB mean frames:

| Layout | Device wants | Reads | Median len | Adjacent | Backward | Median gap |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| frame-major | rung 0 only (6%) | 300 | 15 KB | 0% | 0% | 235 KB |
| frame-major | rungs 0–2 (25%) | 300 | 62.5 KB | 0% | 0% | 187 KB |
| **frame-major** | **whole frame** | **300** | **250 KB** | **100%** | 0% | **0** |
| **rung-major** | **rung 0 only** | **300** | **15 KB** | **100%** | 0% | **0** |
| rung-major | rungs 0–2 | **900** | 15 KB | 0% | 33% | 7.4 MB |
| rung-major | whole frame | **1500** | 32.5 KB | 0% | 20% | 14.8 MB |

Two things fall out before any arm is measured:

* **Rung-major is not universally better.** It is perfect when a client reads *one* rung
  across many frames, and actively worse when a client wants a *prefix of several* rungs: the
  three rungs of one frame sit megabytes apart, so one read becomes three and the sequence
  jumps backwards a third of the time. Whether grouping helps depends on whether clients ask
  for one rung or several.
* **Whole-frame delivery is already sequential** in a frame-major layout. The US-stack case
  needs no layout work at all.

## 3. Two host artifacts, both caught by controls

Neither was visible in any output. Both are recorded because they affect the earlier campaign
too, not just this study.

### 3.1 An 8 MiB read-ahead window, not 128 KiB

The first replay said rung-major reached **0.7% miss on a file verified 0.000% resident**.
That is a suspicious number, so it got a control: **the same 300 reads over the same 4.5 MB
region, in random order**. Read-ahead can only help a sequence it can infer, so a shuffled
order had to lose the benefit.

It did not. Same 0.7%.

The cause is that this host ships `read_ahead_kb = 8192` — an **8 MiB** window, 64× Linux's
128 KiB default. One window covers the entire 4.5 MB working region, so the access *order*
stops mattering. With the window set to the default, the control behaves as it should
([`v18_shuffle_control.tsv`](v18_shuffle_control.tsv)):

| Read-ahead | Sequential order | Shuffled order |
| --- | ---: | ---: |
| 8 MiB (this host) | 1.0% miss | **0.5% miss** — order is irrelevant |
| 128 KiB (Linux default) | 4.7% miss | **67.8% miss** — order is everything |

`gen_access_trace.py` had the same 128 KiB constant hard-coded in its `within_readahead_pct`
metric, wrong by the same factor; it now reads the value from sysfs and records it in every
trace header. **Any host running this work must record `read_ahead_kb` beside the results** —
`lab/scripts/run_read_campaign_cloud.sh` now does.

### 3.2 The window changes every result

[`v17_readahead_ab.tsv`](v17_readahead_ab.tsv) — same cells, window as the only variable,
12 repeats, cold:

| Case | In flight | miss @128 KiB | miss @8 MiB | `pool` CPU ratio | `hybrid` @128 KiB | `hybrid` @8 MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frame-major, whole frame | 1 | **62.4%** | 3.0% | 2.9× | **−41%** | +17% |
| frame-major, whole frame | 8 | **100%** | 20.2% | 3.7× | **−55%** | −23% |
| frame-major, rung prefix | 1 | 99.5% | 69.3% | 1.3× | −44% | −43% |
| frame-major, rung prefix | 8 | 99.7% | 90.3% | 1.0× | −67% | −61% |
| rung-major, one rung | 1 | 4.7% | 1.0% | 1.6× | −19% | −13% |
| rung-major, one rung | 8 | 29.0% | 7.5% | 1.9× | **−71%** | −58% |
| rung-major, rung prefix | 1 | 10.7% | 0.7% | 3.6× | −33% | −14% |
| rung-major, rung prefix | 8 | 42.5% | 3.9% | 3.7× | −66% | −34% |

**At the Linux default window the hybrid wins all eight cases; at 8 MiB it wins five.** The
lab host's unusual tuning was making the hybrid look *worse* than it is, not better. It was
also flattering the original campaign's `sweep` cells, whose low miss rates partly reflect the
8 MiB window rather than the access shape.

## 4. Cache pressure: the regime we actually deploy into

Every earlier cell force-evicted the study and read it once, so a miss was always a *first*
touch of a study that would have fitted in RAM. That is not our case.

[`v19_mempressure.tsv`](v19_mempressure.tsv): a **4 GB** study (16 007 frames, mean 250 KB,
size CV 0.6 — realistic geometry, synthetic bytes, `lab/scripts/gen_geometry_fixture.py`), a
**238 MB working set**, and a cgroup memory cap sweeping the ratio. The warm phase reads the
whole working set; the cap throws most of it away; the timed phase measures what a session
actually finds resident. Cap enforcement is verified (`memory.failcnt` in the millions at
96 MB, zero at 2 GB) — the first attempt reported a 2.6 MB peak and 0% miss because pages left
over from an earlier run stayed charged to the root cgroup, so the study is now evicted before
each capped run.

| Layout | Cache cap | Working set / cache | In flight | miss | `pool` CPU | `hybrid` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| rung-major (sequential) | 2 GB | 0.1× | 1 | 0.0% | 2 657 | −2% *(3/5)* |
| rung-major | 256 MB | 0.9× | 1 | 0.0% | 2 525 | +1% *(1/5)* |
| rung-major | 96 MB | **2.5×** | 1 | **0.5%** | **6 014** | −9% *(4/5)* |
| rung-major | 96 MB | 2.5× | 8 | 4.9% | 14 207 | **−49%** *(5/5)* |
| frame-major (strided) | 2 GB | 0.1× | 1 | 0.0% | 3 976 | +1% *(2/5)* |
| frame-major | 256 MB | **0.9×** | 1 | **99.0%** | **105 416** | **−55%** *(5/5)* |
| frame-major | 96 MB | 2.5× | 1 | 99.6% | 105 563 | **−55%** *(5/5)* |
| frame-major | 96 MB | 2.5× | 8 | 99.2% | 83 228 | **−73%** *(5/5)* |

**The strided layout falls off a cliff; the sequential one does not.** `pool`'s cost goes
3 976 → 105 416 ns, a factor of **26**, while the sequential layout is still at 0.5% miss at
2.5× oversubscription. §4.1 locates the cliff and names its cause — the first two explanations
tried were both wrong.

### 4.1 The cliff is a step function, and it is not read-ahead amplification

The 256 MB row above is the interesting one: the working set is 238 MB, so it *should* fit,
and yet the miss rate is 99.0%. Two explanations were tested and both failed.

**Not read-ahead amplification.** The obvious guess is that a strided read drags in far more
than it needs, so the cache fills with unwanted data. Re-running the whole cap sweep at a
128 KiB window instead of 8 MiB — a 64× smaller amplifier — changes nothing:

| Read-ahead | cap 2 GB | cap 256 MB | cap 96 MB |
| --- | ---: | ---: | ---: |
| 8 MiB | 0.0% | **99.0%** | 99.6% |
| 128 KiB | 0.0% | **99.2%** | 99.7% |

**Not "the working set exceeds the cache" either**, at least not as stated: a finer sweep
([`v20_cliff_sweep.tsv`](v20_cliff_sweep.tsv), 4 repeats each) shows the transition is a
*step*, and it sits at the cell's **actual cache demand** — 322 MB, the measured
`memory.max_usage_in_bytes`, which includes read-ahead pages and the process's own memory —
not at the 238 MB of bytes the trace asks for:

| Cache cap | cap / actual demand (322 MB) | `pool` miss | `pool` CPU |
| ---: | ---: | ---: | ---: |
| 1024 MB | 3.18× | 0.0% | 4 108 |
| 512 MB | 1.59× | 0.0% | 3 455 |
| 448 MB | 1.39× | 0.0% | 4 222 |
| 384 MB | 1.19× | 0.0% | 3 966 |
| **320 MB** | **0.99×** | **0.0%** | **3 792** |
| **256 MB** | **0.80×** | **99.0%** | **105 416** |
| 96 MB | 0.30× | 99.6% | 105 563 |

Nothing between 3.18× and 0.99×; everything at 0.80×. That is the **LRU cyclic-scan
pathology**: an access pattern that cycles through a working set slightly larger than the
cache evicts precisely the pages it is about to need, so the hit rate collapses to ~zero
rather than degrading in proportion.

**What protects the sequential layout is read-ahead, and read-ahead needs sequential access.**
Prefetch supplies pages just *ahead* of the scan, so it never depends on retention and never
meets the pathology. The strided pattern is not detected as sequential at either window, gets
no prefetch, and is therefore left relying on retention — the one thing a cyclic scan cannot
have.

The cap sweep ran in descending order (1024 → 320 MB) and every cell in it read 0.0%, so the
step is not host drift accumulating over the run.

**Practical form:** *if a session's cycle fits in the cache it has, layout is nearly
irrelevant; if it does not, layout is the difference between 4 µs and 105 µs per read.* The
number that matters is therefore cache **per concurrent session**, which shrinks as users are
added — so scaling up user count is what pushes a deployment over this edge, not study size on
its own.

That immunity is partly the 8 MiB window. At the default ([`v19_mempressure.tsv`](v19_mempressure.tsv),
`ra128` rows):

| Read-ahead | In flight | miss at 2.5× oversubscribed | `pool` CPU | `hybrid` |
| --- | ---: | ---: | ---: | ---: |
| 8 MiB | 1 | 0.5% | 6 014 | −9% |
| 8 MiB | 8 | 4.9% | 14 207 | −49% |
| 128 KiB | 1 | 5.1% | 10 360 | −29% *(5/5)* |
| 128 KiB | 8 | **42.8%** | 27 994 | **−76%** *(5/5)* |

So sequential access is not immune, it is *robust*: 43% miss where the strided layout is at
99%, and 28 µs where the strided layout is at 83 µs. **Pipelining is what breaks it** —
eight concurrent readers of one sequence scramble the order read-ahead is trying to follow,
and a 128 KiB window cannot absorb that.

## 5. What this means

| Question | Answer, now measured |
| --- | --- |
| Does study size determine the miss rate? | **No.** A 4 GB study at 2.5× oversubscription reads at 0.5% miss under one layout and 99.6% under another |
| What does determine it? | **Whether the session's access cycle fits the cache it has, and whether read-ahead can cover it if not.** Strided access steps from 0% to 99% at ~1.0× of actual cache demand; sequential access is protected by prefetch and degrades as a slope |
| Is our deployment miss-dominated? | **Only if the layout leaves reads strided.** That is a design decision, not a given |
| Does the read-path recommendation change? | **No.** Over the **44** paired cell-groups in these five artifacts the hybrid is **better in 25, a tie in 19, and worse in none** under the repo's own rule (\|median\| ≥ 28.5% *and* sign agreement ≥ 0.8n); best margin **−76.1%**. At the Linux default read-ahead it wins every trace case |
| Which lever is bigger? | **Conditional.** Past the cliff the layout is worth **17.6×** against the read path's 2–4×. Before it, the layout is worth **1.50×** and the read path is the only lever left |
| Does grouping always help? | **No.** Rung-major is perfect for one-rung-per-frame access and *worse* than frame-major when a device wants a prefix of several rungs (3× the reads, 7 MB apart, 33% backward) |

For the read path this is reassurance rather than news: the recommendation survives every new
condition and strengthens under the ones closest to production. For the layout design it is a
starting brief — with a quantified cliff to stay on the right side of, and a transform
(`gen_access_trace.py`) that prices any proposal without new measurement.

## 6. Review

These results were attacked before publication, on the same terms as the campaign in
`READ-PATH-DECISION.md` (archived: `git show a330783:docs/disk-access/READ-PATH-DECISION.md`) §Review: a written list of claims, the raw
data, the harness source, and a brief to break them. Three claims did not survive intact.

| Claim as first written | What the attack showed | Corrected to |
| --- | --- | --- |
| "17× from the layout alone" | True only past the cliff. Below it the same two layouts are 3 976 ns vs 2 657 ns | **1.50× below the cliff, 17.6× above it.** The layout decides whether you fall off, and is nearly irrelevant until you do |
| "The strided layout cliffs between 0.1× and 0.9× oversubscription of the working set" | Two mechanisms were proposed and **both were wrong**. Read-ahead amplification: refuted — a 64× smaller window gives 99.2% against 99.0%. Working-set size: refuted — the step sits at *actual cache demand* (322 MB measured), not at the 238 MB of bytes requested | **A step function at ~1.0× of actual cache demand** (0.0% at 0.99×, 99.0% at 0.80×), caused by the LRU cyclic-scan pathology and prevented by prefetch (§4.1) |
| "Wins or ties in all 28 cells, up to −77%" | Miscounted from the doc's own tables rather than the data | **44 cell-groups: 25 better, 19 tie, 0 worse. Best −76.1%** |

What survived, and what was specifically checked:

* **Trace integrity.** All 15 900 reads of both geometry traces land inside the file, with
  **zero** overlapping pairs and **zero** duplicates, so no read can be served free by another
  ([`v19_trace_geom_*.tsv`](v19_trace_geom_rm_r1.tsv)).
* **Arm symmetry under variable-length reads.** `reader_pool` and `reader_ring` both allocate
  `depth × max(plan length)`; the ring additionally pays buffer registration inside the timed
  region, which biases *against* the arm that wins.
* **Miss accounting.** Every regime and cliff figure is `pool`'s miss counter. `uring` and
  `pooled_pread` report 100% by construction and no claim is drawn from them.
* **Drift is not the cliff.** The fine sweep ran in descending cap order (1024 → 320 MB) and
  every cell in it read 0.0%, so later-in-time is not worse.
* **Cap enforcement.** `memory.failcnt` is in the millions at 96 MB and zero at 2 GB. The
  first attempt at this cell reported a 2.6 MB peak and 0% miss because pages left from an
  earlier run stayed charged to the root cgroup; the study is now evicted before each capped
  run and the peak matches the cap exactly.

Two findings that change nothing here but are traps for the next run:

* **`--trace` with `--readers > 1` makes every reader replay the *whole* trace from a
  different starting offset**, so readers 2..N re-read bytes reader 1 already warmed and
  collect free cache hits. Every trace cell in these artifacts uses `--readers 1`, so no claim
  is affected — but a multi-session trace cell needs `--partition` or a per-reader trace.
* **The trace's geometry and the fixture's are independent draws.** `gen_access_trace.py`
  generates its own lognormal frame sizes; they do not align with the SBND index of
  `gen_geometry_fixture.py`. That is harmless — read cost depends on offsets and lengths, not
  on which frame a byte belongs to, and the harness refuses any plan that would read past EOF
  — but the operative geometry is the **trace's**, not the fixture's.

## 7. Limitations

* **One host still.** The read-ahead A/B shows how much a single kernel knob moves everything;
  the `spawn_blocking` hop tax (median 34 µs) is an equally load-bearing constant that has not
  been measured anywhere else. `lab/scripts/run_read_campaign_cloud.sh` and
  `lab/scripts/compare_hosts.py` exist to close that and have not yet been run — see
  `SCOREBOARD.md` (archived: `git show a330783:docs/disk-access/SCOREBOARD.md`) §R1.
* **Rung fractions are assumed.** `[0.06, 0.12, 0.25, 0.50, 1.00]` is the shape of a
  geometric resolution ladder, not a measurement of real HTJ2K codestreams. The *shape* is
  what the geometry depends on; exact values would shift read lengths, not the ranking.
* **The `within_readahead_pct` column is host-relative** and was wrong by 64× until §3.1.
  `adjacent_pct` and the gap distribution are host-independent and are the ones to compare.
* **Pressure is applied with a cgroup cap, not a real competing workload.** Reclaim under a
  cap and reclaim under genuine multi-tenant pressure are not identical.
* **One reader per cell in §4.** Several users on the same study share the page cache, which
  should help; several users on *different* studies multiply the working set, which should
  hurt. Neither is measured here.
* **`live_cell_scroll` is one ask pattern.** A scrub or a jump-heavy reader produces different
  geometry; the transform can price them, and they have not been run.
