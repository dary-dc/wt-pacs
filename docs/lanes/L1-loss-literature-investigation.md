# L1 loss run — literature & web investigation guide

> ## ⚠ The v2 grid is VOID. This lane may not corroborate it.
>
> [`../measurements/r2/L1_V2_ADVERSARIAL_REVIEW.md`](../measurements/r2/L1_V2_ADVERSARIAL_REVIEW.md)
> voided `l1_s_vs_q_loss_v2.tsv`: the noise floor exceeds the decision threshold, the harness
> manufactures head-of-line exposure on the shared arm specifically, and the RTT labels are wrong.
> [`L1-v3-work-order.md`](L1-v3-work-order.md) is the replacement campaign.
>
> **So this lane's job is not "explain the 35.5 %".** A literature review cannot rescue a void
> measurement, and an agent that arrives at "the papers say per-frame should win, so the result is
> probably right" has done the one thing this doc exists to prevent. The job is:
>
> 1. **Mechanism** — what does published work say the effect *is*, and what does it require?
> 2. **Falsification** — what pattern must a real effect produce? Does v2's pattern match? (It does
>    not, and that is evidence *for* the void, not against it)
> 3. **Design input for v3** — regime facts the work order still has to settle: the loss *model*,
>    the depth, whether the loss cells are congestion-limited at all
> 4. **Competing explanations** — for each rig defect the review found, does the literature name it as
>    a known confound?

**Empirical anchor (void, for pattern only):** `docs/measurements/r2/l1_s_vs_q_loss_v2.tsv`.
**Decision rule (v3, not v2):** `L1-v3-work-order.md` §S12 — null control CI contains 0, *lower bound*
of the 0.5 % CI exceeds 15 %, and the effect responds to the dose.

**Do not treat this doc as the experiment result.** It is a research plan and a hypothesis map.

---

## 1. What we measured (minimal context)

| Arm | Meaning |
|-----|---------|
| **S** | One shared WebTransport uni stream for all frames |
| **P** | One uni stream per frame, no priority (dropped in v2, restored in v3) |
| **Q** | One uni stream per frame **+ FIFO `set_priority` by ask order** |

Under RTT and loss shaped by `netem`, a trace-driven client keeps **window depth D** frames in
flight. Decision metric: **miss-only p95 wait** (positive waits only).

### v2 numbers — quote only with the CI beside them

| RTT | Loss | D | gain (median) | bootstrap 95 % CI | perm p |
|-----|------|---|---------------|-------------------|--------|
| 60 | 0 % | 4 | +3.9 % | — | 1.00 |
| **60** | **0.5 %** | **4** | **+35.5 %** | **[+3.3 %, +55.3 %]** | 0.016–0.037 |
| 60 | 2 % | 4 | −1.4 % | — | 0.89 |
| **150** | **0 %** | **7** | **+26.0 %** | — | 0.17 |
| **150** | **0.5 %** | **7** | **+29.2 %** | **[−6.3 %, +51.6 %]** | 0.101–0.13 |
| 150 | 2 % | 7 | +3.6 % | — | 0.43 |

Two facts about this table govern everything below. **A zero-effect control produced +26 %.** And
**the advantage vanishes at the loss rate where the mechanism should be strongest.** Any agent whose
literature reading "explains" the 0.5 % column without also explaining those two has explained noise.

One shape *is* worth carrying into the reading, because it is a mechanism fingerprint rather than a
level: at 60 ms / 0.5 % the gain is **+35.5 % on p95 but only +9.9 % on the mean** (150 ms: +29.2 %
vs +17.4 %). Delivery-gating relief removes occasional stalls; it does not shift the typical wait.
Whether that survives the rig fixes is a v3 question.

---

## 2. Research questions (prioritized)

### RQ1 — Mechanism
What, in published terms, is the effect Q is supposed to have, and what does it **require** to exist?
Specifically: does it need (a) several streams in flight at once, (b) a non-round-robin scheduler,
(c) a loss rate high enough to matter but low enough not to dominate?

### RQ2 — The pattern, not the number
Does any published mechanism predict **a gap at 0 % loss** and **no gap at 2 %**? If none does, say so
plainly: that is independent support for the adversarial review's verdict.

### RQ3 — Regime: is the loss cell even measuring HOL blocking?
At 10 Mbit with the **real** path RTT (~240 / ~300 ms per the review, not the 60 / 150 labels), what
throughput does a loss-based congestion controller sustain at 0.5 % and 2 %? If the connection is
congestion-limited, the arms are queued behind the same `cwnd` and the experiment is measuring
congestion control, not stream architecture. **Estimate it, then tell v3 to record achieved
throughput per run so it can be checked rather than argued.**

### RQ4 — Loss model
`cloud_netem.sh` applies i.i.d. Bernoulli `netem loss p%`. Real loss is bursty. Does the literature
tie the *sign* of this effect to the loss model? If it does, v3 needs a `loss gemodel` cell and the
decision rule must name the loss process, not only the rate.

### RQ5 — Competing explanations for the rig defects
For each defect in the adversarial review — redundant re-asks riding the shared stream, arms in
blocks rather than interleaved, depth below formula, one-way loss — is it a **known** confound in the
measurement literature, and how do published setups control it?

### RQ6 — External validity
Do HTTP/3 web-page results transfer to 32 KB binary frames, two arms, a 10 Mbit shaped path, and a
client that prefetches a window?

---

## 3. Concepts to look up (glossary for search)

| Term | Why it matters here |
|------|---------------------|
| **Head-of-line (HoL) blocking** | Single ordered byte stream: a lost packet withholds *already-arrived* bytes of later frames on **S** |
| **QUIC stream independence** | RFC 9000: no ordering guarantee *between* streams — the property Q buys |
| **Round-robin vs sequential multiplexing** | The P-vs-Q distinction. RFC 9218 calls it *incremental* vs *non-incremental* — use that vocabulary |
| **Connection-level congestion control** | One `cwnd` for all streams (RFC 9002). The likely reason 2 % is a null |
| **Congestion-limited regime / Mathis model** | `BW ≈ MSS / (RTT·√p)` — if this is far below the link cap, the cell measures CC, not architecture |
| **Stream vs connection flow control** | RFC 9000 has both. One shared stream is bounded by **one** stream window; N streams get N windows — an arm asymmetry at **zero loss** |
| **Loss burstiness / Gilbert–Elliott** | `netem loss gemodel`. i.i.d. loss is the regime most favourable to per-stream arms |
| **PTO / tail loss** | Timer-based recovery is packet-level, not stream-level — per-frame framing does not speed recovery |
| **QPACK blocking** | HTTP/3-specific; N/A to our binary framing — confirm and move on |

---

## 4. Sources: what counts, and what is readable from here

**Tiers.** **T1** IETF RFC or WG draft · **T2** peer-reviewed measurement work with a stated method ·
**T3** implementation source at a pinned version · **T4** practitioner writing. **T4 is for framing
and never for a number**, with one exception noted below.

**Access, stated honestly in every citation.** Record for each source: *read in full*, *abstract
only*, or *search-index summary*. A search snippet is not a read paper, and this environment blocks
most publisher hosts (`rfc-editor.org`, `arxiv.org`, `dl.acm.org`, ScienceDirect, `docs.rs`, most
university PDF hosts). Reachable: **`raw.githubusercontent.com`** and the package registries. So:

- **The IETF drafts are readable** via the WG repos, e.g.
  `raw.githubusercontent.com/quicwg/base-drafts/draft-ietf-quic-transport-34/draft-ietf-quic-transport.md`
  (and `-recovery-34`), `raw.githubusercontent.com/moq-wg/moq-transport/main/draft-ietf-moq-transport.md`
- **Marx's HOL-blocking post is readable** at
  `raw.githubusercontent.com/rmarx/holblocking-blogpost/master/README.md` — T4 by format, but it is
  the author of the T2 work and the text is auditable, so quote it directly rather than a summary
- **The strongest evidence is local.** The stack that produced the rows is in the cargo registry:

```bash
cargo fetch
Q=~/.cargo/registry/src/*/quinn-proto-0.11.17
grep -n "send_fairness\|CubicConfig\|packet_threshold\|STREAM_RWND\|send_window" $Q/src/config/transport.rs
sed -n '370,450p' $Q/src/connection/streams/mod.rs        # PendingStreamsQueue / strict priority
grep -n "fn detect_lost_packets" -A 30 $Q/src/connection/mod.rs
grep -n -B8 "pub fn set_priority" ~/.cargo/registry/src/*/quinn-0.11.11/src/send_stream.rs
```

**Seed references** (verify and extend; the last two are SEO-grade — use them for search terms only):

| Source | URL | Tier | Relevance |
|--------|-----|------|-----------|
| Marx — QUIC HoL blocking post | https://github.com/rmarx/holblocking-blogpost | T4⁺ | Skeptical: HOL removal needs concurrent streams and non-rare loss; loss is bursty |
| Sander, Kunze, Wehrle — TMA 2022, prioritization & HTTP/3 HOL | https://dl.ifip.org/db/conf/tma/tma2022/tma2022-paper28.pdf | T2 | Round-robin worst; effect shrinks at higher loss |
| Marx et al. — Resource multiplexing H2 vs H3 (WEBIST 2020) | https://h3.edm.uhasselt.be/files/ResourceMultiplexing_H2andH3_Marx2020.pdf | T2 | Scheduler × loss-model interaction |
| Fernández et al. — Exploiting stream scheduling in QUIC (Ad Hoc Networks 2024) | https://doi.org/10.1016/j.adhoc.2024.103601 | T2 | Application-set priorities, delay metric, effect size |
| RFC 9000 / 9002 / 9218 | rfc-editor (blocked; use the WG repos) | T1 | Stream independence · loss & CC · incremental vs non-incremental |
| network-priority.com pages | — | T4⁻ | Search terms only. Do not cite |

---

## 5. Search queries (copy-paste)

### HoL & streams
- `QUIC stream isolation packet loss head-of-line blocking shared connection`
- `HTTP/2 TCP HoL blocking vs HTTP/3 QUIC independent streams measurement`

### Priority / scheduling
- `HTTP/3 extensible prioritization incremental non-incremental lossy network`
- `QUIC stream priority scheduler retransmission round-robin sequential`

### The 2 % null
- `QUIC advantage disappears high packet loss congestion window collapse`
- `Mathis model throughput RTT sqrt loss congestion-limited regime`

### Loss model (RQ4 — do not skip)
- `Gilbert-Elliott bursty loss versus uniform random loss QUIC evaluation`
- `netem loss gemodel realistic burst length measurement study`

### Flow control (RQ3/H7)
- `QUIC stream flow control window single stream throughput limit`
- `per-stream receive window versus connection window many streams`

### Regime
- `minimum concurrent streams for QUIC HOL benefit`
- `packet loss rate distribution broadband cellular measurement`

---

## 6. Hypotheses ↔ evidence map

Mark each **supports / contradicts / neutral / not addressed**, and say which access level the
verdict rests on.

| ID | Hypothesis | Predicts at 0 % | Predicts at 0.5 % | Predicts at 2 % | Test with data | Test via literature |
|----|------------|-----------------|-------------------|-----------------|----------------|---------------------|
| H1 | **Transport HoL on S** | **no gap** | Q better in the **tail** | gap ≥ 0.5 % gap | mean-vs-p95 split; wait histograms | Stall per loss event × streams affected |
| H2 | **Connection CC dominates at high loss** | no gap | small gap | S≈Q | waits ≫ RTT; achieved throughput ≪ link | RFC 9002; Mathis; CC-collapse thresholds |
| H3 | **Priority helps the wanted frame** | possible gap | Q better | same | S-vs-P-vs-Q (needs P — v3 S10) | Prioritization-under-loss papers |
| H4 | **Prefetch masks architecture** | — | hit-rate differs by arm | low hits both | `cache_hit_rate`, `cache_misses` | Theory usually assumes no client window |
| H5 | **Underpowered / noise** | any gap | any gap | any gap | bootstrap CI, power | Power analysis |
| H6 | **Wrong regime (D too small)** | — | partial benefit | none | D vs formula at *real* RTT | Minimum-concurrency claims |
| **H7** | **Flow-control asymmetry** — one shared stream is bounded by one stream receive window; N streams get N windows (quinn: `stream_receive_window` 1.25 MB, `send_window` 10 MB) | **gap, growing with queued bytes** | gap | gap | Does the lossless gap scale with redundancy (3.8× at D=4 → 6.7× at D=7 vs +3.9 % → +26 %)? | RFC 9000 flow control; quinn source |
| **H8** | **i.i.d. loss favours per-frame; bursty loss does not** | no gap | Q better **under i.i.d. only** | — | `loss gemodel` cell at the same mean rate | Scheduler × loss-model literature; burst-length measurements |

**Competing rig explanations to weigh against H1–H8** — from the adversarial review, not the papers:

| ID | Explanation | Where it bites |
|----|-------------|----------------|
| C1 | Redundant re-asks (3.8–6.7×) ride the shared stream and block real frames; on per-frame arms they sit on throwaway streams | Inflates every S-vs-Q gap, at **every** loss rate including 0 % |
| C2 | Real path ≈ 240 / 300 ms with ~210 ms of unmodelled WAN; arms run in blocks, not interleaved | The 0 % gap; the RTT axis is a 1.26× contrast, not 2.5× |
| C3 | Depth 4 / 7 against a formula that wants ~10 / 13 at the real RTT | H6; and fewer streams in flight is exactly the condition Marx says kills the benefit |

---

## 7. Agent workflow

1. **Read** the adversarial review and the v3 work order **before** the TSV. The data is void; you are
   reading it for *shape*, not for a result
2. **Run the falsification test first** (§9). If the literature predicts a pattern the data does not
   show, that is your headline, and the rest of the reading is context
3. **Pick hypotheses** from §6 — including H7/H8 and the C-column, not only H1
4. **Read sources**, recording tier *and* access level. Prefer what you can read in full: the WG
   drafts, Marx's post, and the pinned crate sources
5. **Write claim cards** into the sibling doc (`docs/l1-loss-literature-review.md`) — do not overwrite
   this guide
6. **Reconcile:** where the literature's regime differs from ours (metric, loss model, object size,
   scheduler, concurrency), the difference goes in the card. A number without its regime is not
   evidence
7. **Hand v3 concrete design input**, not adjectives: cells, gates, columns to record

### Claim card template

```markdown
### [Author, year] — [title]
- **URL / access:** (read in full | abstract only | search-index summary)
- **Tier:** T1 / T2 / T3 / T4
- **Claim (1 sentence):**
- **Regime:** loss rate & model · RTT · bandwidth · object sizes · concurrency · metric
- **Maps to:** H1–H8 / C1–C3
- **Predicts our 0.5 % result:** yes / no / unclear
- **Predicts our 2 % null:** yes / no / unclear
- **Predicts a 0 % gap:** yes / no  ← if no, it argues the rig, not the architecture
- **Caveat for wt-pacs:**
```

---

## 8. Local validation checklist

Against the committed TSV. **The per-run JSON is gone** — `.local/` is gitignored (review §6) — so
every check that needs `wait_ms` is **unrunnable until v3 commits raw data (work order S8)**. Mark
them blocked; do not silently skip them.

| Check | Pass criterion | Status |
|-------|----------------|--------|
| Row count | 120 rows, 0 VOID/FAIL | runnable |
| `peak_outstanding ≥ D` | all rows | runnable |
| Monotonicity of miss_p95 in loss | per arm | runnable |
| Integrity gates | misses ≥ 20, hit ≤ 90 % on loss cells | runnable |
| Bootstrap CI, per cell | reported with every gain | runnable |
| Null-control CI contains 0 | **v2 fails this** | runnable |
| Recompute miss_p95 from raw | matches TSV | **blocked — raw data gone** |
| Wait histogram shape | Q shifted left at 0.5 %, overlap at 2 % | **blocked — raw data gone** |
| netem state per run | matches the cell | **blocked — not recorded** |

---

## 9. The falsification test — run this before reading anything

If the mechanism is transport head-of-line blocking, then **all** of the following must hold. Write
the verdict per line, from the data, before opening a paper:

| # | Prediction | v2 |
|---|-----------|-----|
| 1 | No arm gap at 0 % loss | **fails** — +26 % at RTT 150 / D=7 |
| 2 | Gain grows with loss over the measured range, or the reason it does not is *named and shown* (e.g. congestion-limited) | **fails, unexplained** — +35.5 % → −1.4 % |
| 3 | The gain is tail-shaped, not a level shift | **holds** — p95 +35.5 % vs mean +9.9 % |
| 4 | The gain scales with concurrency (more streams in flight ⇒ more benefit) | **untested** — D never varied within a cell |

**Two of four fail.** So the literature's role is diagnostic: which of C1/C2/H7 explains a **lossless**
arm difference, and does any published mechanism produce one? If none does, that is the finding, and
"the papers support per-frame" must not be written down as though it supported *this* measurement.

---

## 10. Deliverables

Into `docs/l1-loss-literature-review.md`:

1. **Verdict table** — per RQ: corroborated / contradicted / not addressed, with the access level the
   verdict rests on
2. **Annotated bibliography** — ≥ 5 claim cards, §7 template
3. **Hypothesis verdict table** — H1–H8 and C1–C3: supported / refuted / open
4. **Regime map** — which published result applies at which loss rate, loss model, concurrency and
   metric, and where ours sits
5. **One-page "so what"** — when Q matters, when it does not, what we still do not know
6. **Design input for v3** — cells, gates and recorded columns, phrased so the work order can absorb
   them verbatim
7. **What the literature could not tell us** — the open list

**The prohibition, stated once:** no sentence in the deliverable may use the literature to raise
confidence in a void measurement. The literature constrains what v3 should measure; it cannot
retro-validate v2.

---

## 11. Stop conditions · out of scope

- **A source says the effect depends on the loss model.** Then a `loss gemodel` cell is a v3
  precondition, not a nice-to-have. Say so in the verdict and hand the work order the exact `tc` line
- **The estimate in RQ3 says the loss cells are congestion-limited.** Then the grid cannot isolate the
  mechanism at any loss rate and v3 needs a lower-RTT or higher-rate operating point — a bigger change
  than the work order currently carries. Raise it rather than burying it in prose
- **Nothing relevant exists** for a question: one line, and stop. A padded review is worse than a short
  one

**Out of scope:** rig time · code changes · merging `feat/set-priority-per-frame` · re-running cells ·
editing the v3 work order (propose; do not rewrite it) · taking the stream-mode decision.

---

## 12. Related repo paths

| Path | Content |
|------|---------|
| `docs/measurements/r2/L1_V2_ADVERSARIAL_REVIEW.md` | **Why v2 is void — read first** |
| `docs/lanes/L1-v3-work-order.md` | The replacement campaign and its gates |
| `docs/lanes/L1-loss-run.md` | v2 methodology (superseded) |
| `docs/measurements/r2/l1_s_vs_q_loss_v2.tsv` | v2 rows (void) |
| `docs/l1-loss-literature-review.md` | **This lane's output** |
| `lab/window-harness/src/{client,metrics}.rs` | Window, metric definitions |
| `lab/scripts/cloud_netem.sh` | The loss model (`netem loss p%`, i.i.d.) |

---

*Created 2026-09-02 after the v2 grid completed · rewritten the same day against the adversarial
review and the v3 work order.*
