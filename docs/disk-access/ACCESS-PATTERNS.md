# What actually makes a read miss · 2026-09-06

**This document changes a premise the read-path recommendation was resting on.**

[`READ-PATH-DECISION.md`](READ-PATH-DECISION.md) says the miss rate decides which read path
wins, and assumes our deployment sits in the miss-dominated square because *"tens-of-GB
studies on cloud storage, so most reads miss"*. That assumption was never measured — every
miss rate in the campaign came from a synthetic stride against an 84 MB fixture.

It is now measured, and **the assumption is wrong as stated**. Study size does not determine
the miss rate. What determines it is **access sequentiality**, and sequentiality is a
property of the **disk layout**, not of the study.

| Same client asks, same bytes, same 4 GB study | `pool` CPU per read | miss |
| --- | ---: | ---: |
| Layout that leaves reads strided (frame-major, rung prefix) | **105 563 ns** | **99.6%** |
| Layout that groups what is read together (rung-major) | **6 014 ns** | **0.5%** |

**17× from the layout alone.** The read-path choice is worth 2–4× on top of that. The layout
is the bigger lever by an order of magnitude — and it is the piece that has not been designed
yet.

The read-path recommendation itself **does not change**: the hybrid wins or ties in every
cell measured here, and wins by *more* as conditions get harder. What changes is how much it
is worth, and that now depends on a design decision rather than on the deployment.

Raw: [`v15_trace_replay.tsv`](v15_trace_replay.tsv) ·
[`v15_trace_shapes.tsv`](v15_trace_shapes.tsv) ·
[`v17_readahead_ab.tsv`](v17_readahead_ab.tsv) ·
[`v18_shuffle_control.tsv`](v18_shuffle_control.tsv) ·
[`v19_mempressure.tsv`](v19_mempressure.tsv)

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

**The strided layout falls off a cliff the moment the working set stops fitting** — 0.0% to
99.0% between 0.1× and 0.9× oversubscription, and `pool`'s cost goes 3 976 → 105 416 ns, a
factor of **26**. The sequential layout degrades gracefully instead: still 0.5% at 2.5×
oversubscription.

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
| What does determine it? | **Sequentiality × (working set / cache).** Strided access above ~1× oversubscription is a cliff; sequential access is a slope |
| Is our deployment miss-dominated? | **Only if the layout leaves reads strided.** That is a design decision, not a given |
| Does the read-path recommendation change? | **No.** The hybrid wins or ties in all 28 cells here, and its margin *grows* with pressure — up to −77%. At the Linux default read-ahead it wins every single case |
| Which lever is bigger? | **The layout, by ~10×.** 17–26× CPU from grouping reads, 2–4× from the read path |
| Does grouping always help? | **No.** Rung-major is perfect for one-rung-per-frame access and *worse* than frame-major when a device wants a prefix of several rungs (3× the reads, 7 MB apart, 33% backward) |

For the read path this is reassurance rather than news: the recommendation survives every new
condition and strengthens under the ones closest to production. For the layout design it is a
starting brief — with a quantified cliff to stay on the right side of, and a transform
(`gen_access_trace.py`) that prices any proposal without new measurement.

## 6. Limitations

* **One host still.** The read-ahead A/B shows how much a single kernel knob moves everything;
  the `spawn_blocking` hop tax (median 34 µs) is an equally load-bearing constant that has not
  been measured anywhere else. `lab/scripts/run_read_campaign_cloud.sh` and
  `lab/scripts/compare_hosts.py` exist to close that and have not yet been run — see
  [`SCOREBOARD.md`](SCOREBOARD.md) §R1.
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
