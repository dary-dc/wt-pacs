# L1 loss result — literature review

**2026-09-02** · guide: [`lanes/L1-loss-literature-investigation.md`](lanes/L1-loss-literature-investigation.md) ·
inputs: [`measurements/r2/L1_V2_ADVERSARIAL_REVIEW.md`](measurements/r2/L1_V2_ADVERSARIAL_REVIEW.md) ·
[`lanes/L1-v3-work-order.md`](lanes/L1-v3-work-order.md)

> **This review does not validate the v2 grid, and cannot.** `l1_s_vs_q_loss_v2.tsv` is void. What
> follows is (a) what published work says the mechanism is and requires, (b) whether v2's *pattern* is
> one any mechanism produces — it is not — and (c) design input for v3.

> **Access constraint.** This environment reaches `raw.githubusercontent.com` and the package
> registries. `rfc-editor.org`, `arxiv.org`, `dl.acm.org`, ScienceDirect, `docs.rs`, `dl.ifip.org` and
> the university PDF hosts are blocked by the egress proxy. So the IETF working-group drafts, Marx's
> HOL post and the **pinned crate sources that produced the rows** were read in full; every journal
> and conference paper below is at **search-index level** — title, authors, venue, year and an indexed
> summary, not the text. Each claim card states which. Index-level rows are leads, not citations.

## 1 · Verdicts

| RQ | Question | Verdict | Rests on |
| - | --- | --- | --- |
| **RQ1** | What is the mechanism, and what does it require? | **Answered** — per-stream *delivery* independence, requiring ≥ 2 streams in flight and a non-round-robin scheduler | T1 drafts + T3 source, **read in full** |
| **RQ2** | Does any mechanism predict v2's pattern (gap at 0 %, none at 2 %)? | **No — contradicted.** No published mechanism produces a **lossless** arm gap | T1 + T3 read; T2 index-level |
| **RQ3** | Are the loss cells even measuring HOL blocking? | **At risk** — a Reno-style ceiling puts 0.5 % / 2 % at **2–23 %** of the 10 Mbit link, i.e. plausibly congestion-limited | Arithmetic + RFC 9002; **must be measured, not argued** |
| **RQ4** | Does the loss *model* decide the sign? | **Yes — and ours is the favourable one.** i.i.d. `netem loss` is the regime per-stream arms win; real loss is bursty | Marx read in full; T2 index-level |
| **RQ5** | Are the rig defects known confounds? | **Partly** — concurrency (C3) is named explicitly in the literature; the flow-control asymmetry (H7) is not, and is ours to test | T1/T3 read |
| **RQ6** | Do web results transfer to 32 KB frames? | **Not addressed** — no imaging-over-QUIC work exists; MoQT is the closest transferable design | — |

**Headline.** The mechanism is real, well specified, and implemented in our stack exactly as the
theory describes — **and none of that supports v2's numbers.** Two of the four predictions a real
effect must make are violated by v2 (§3), and the strongest single fact from the reading is that
**our loss model is the one most favourable to the arm that won** (§5, RQ4). v3 needs a bursty-loss
cell and a throughput column before it can decide anything.

## 2 · The mechanism, from sources read in full

**Spec.** RFC 9000's WG text: *"QUIC does not provide any means of ensuring ordering between bytes on
different streams"*, and *"QUIC does not provide a mechanism for exchanging prioritization
information. Instead, it relies on receiving priority information from the application. A QUIC
implementation SHOULD provide ways in which an application can indicate the relative priority of
streams."* Per-stream delivery independence is a protocol guarantee; application-set priority is the
intended interface. Arm Q is the textbook construction, not a trick.

**Our stack, at the pinned versions.** `quinn-proto 0.11.17`:

- `PendingStreamsQueue` is a `BinaryHeap<PendingStream>`; `PendingStream` derives `Ord` with
  `priority` first, `recency` second — **strict priority, round-robin only within one level**
- `send_fairness` defaults to **`true`** (`config/transport.rs:373`): *"connections schedule data from
  outgoing streams having the same priority in a round-robin fashion … Higher priority streams always
  take precedence over lower priority streams"*
- default congestion controller is **CUBIC** (`CubicConfig::default()`), i.e. loss-based;
  `packet_threshold: 3`, `time_threshold: 9/8`, `persistent_congestion_threshold: 3` — RFC 9002's
  recommended constants
- our server never overrides this: `ServerConfig::builder()` in `server/src/transport/server.rs`, and
  `wtransport 0.7.2` seeds it with `quinn::TransportConfig::default()`

So the three arms map onto one documented scheduler:

| arm | streams | priorities | quinn behaviour |
| --- | --- | --- | --- |
| **S** | 1 | n/a | no scheduling choice exists |
| **P** | D | all 0 | **round-robin** — D frames advance together, all finish late |
| **Q** | D | distinct, descending by ask order | **strict priority** — S's transmit order without S's delivery coupling |

That is campaign v2's fair-sharing finding and the X3 retraction, now sourced rather than argued.

**What per-frame framing does *not* buy — and this is the claim we should be careful to make.** Loss
detection in quinn is packet-level: `detect_lost_packets(now, pn_space, due_to_ack)` walks
`space.sent_packets` for a packet-number space; there is no stream dimension in it, and
`on_congestion_event` acts on the connection path. Retransmitted stream data re-enters the queue at
the stream's own priority (`push_pending(id, stream.priority)`), so an older frame's retransmit still
outranks newer frames. **Per-frame streams do not detect loss sooner, retransmit sooner, or protect
the congestion window. They change only what a loss is allowed to block.**

**Independent corroboration by construction.** The IETF MoQ transport draft maps a subgroup of objects
onto one stream for exactly this property — *"The parallel nature of QUIC streams can provide
improvements in the face of loss"* — with objects from different subgroups required to ride different
streams, plus a defined priority scheme. Different WG, different media domain, same construction as Q.

**The requirement the literature is loudest about.** Marx (read in full): *"QUIC's HOL blocking removal
only works if there are multiple resource streams active at the same time"*, and *"if there is only a
single stream active at a given moment, any loss will impact that lonely stream and we will still be
HOL blocked, even in QUIC."* Concurrency is a precondition, and v2 ran at D = 4/7 against a formula
that wants ≈ 10/13 at the **real** path RTT (adversarial review §3.2). **C3 is a literature-named
defect, not a nitpick.**

## 3 · The falsification test (guide §9), answered

| # | What a real HOL effect must produce | v2 | Literature backing for the prediction |
| - | --- | --- | --- |
| 1 | **No arm gap at 0 % loss** | **fails** — +26 % at 150 ms / D=7 | No mechanism in §2 operates without loss; campaign v2's lossless cells tied |
| 2 | **Gain grows with loss**, or the reason it does not is named *and shown* | **fails, unexplained** — +35.5 % → −1.4 % | Legitimate exception exists (congestion-limited, §5) but was never demonstrated |
| 3 | **Gain is tail-shaped, not a level shift** | **holds** — p95 +35.5 % vs mean +9.9 % at 60 ms | Delivery gating removes occasional stalls |
| 4 | **Gain scales with concurrency** | **untested** — D never varied within a cell | Marx: concurrency is the precondition |

**Two of four fail.** The one that passes (3) is the only new evidence this review adds *for* the
mechanism, and it is not enough to carry a decision. **The literature's verdict on v2 is the same as
the adversarial review's, reached independently: this grid cannot decide the question.**

## 4 · A candidate for the lossless gap that the review did not name — H7

Nothing published explains an arm difference at 0 % loss. Our own stack does, and it is worth testing
because it is *not* head-of-line blocking and it would inflate every cell:

**Flow control is per stream.** quinn's defaults: `stream_receive_window` = **1.25 MB**
(`STREAM_RWND = 12500·1000/1000 · 100 ms`), `send_window` = **8 × STREAM_RWND = 10 MB**,
`receive_window` = `VarInt::MAX`. So the **S** arm can have at most **one stream window** of data
outstanding, while **Q/P** get a fresh window per frame, bounded only by the 8× connection send
window. When the sender's `write_all` hits that limit it blocks the session loop, which stops the
server reading further asks — a stall that exists **at zero loss**.

**And v2 loaded exactly the pressure needed to reach it.** The adversarial review's redundancy finding
(§3.1): the harness pushed **9.8 MB at D=4 and 17.1 MB at D=7** through the link for 80 unique frames
(2.6 MB of useful bytes). On S all of it queues in one stream window; on Q it spreads across streams.

The scaling matches: redundancy 3.8× → 6.7× against lossless gaps **+3.9 % → +26 %**. That is a
better fit to the lossless anomaly than anything in the papers, and it makes C1 (redundancy) and H7
(flow control) the same defect seen twice.

**Consequence for v3, and it is a happy one:** S1/S2 remove the re-asks, so bytes on the wire fall to
≈ 2.6 MB and the flow-control asymmetry mostly disappears with them. **Expect v3's honest effect to be
much smaller than v2's 35.5 %.** If it is not, H7 is still live and should be tested directly (below).

## 5 · Regime map — where published results apply, and where we sit

| Axis | Published work | v2 | Consequence |
| --- | --- | --- | --- |
| **Loss model** | Sequential suits **bursty** loss; parallel/prioritized-parallel wins under **random** loss (Marx et al., index-level). Marx (read): *"packet loss is often bursty and grouped… more like 10 consecutive packets being lost in a total of 500"* | `netem loss p%` — **i.i.d. Bernoulli** (`lab/scripts/cloud_netem.sh`) | **The result was measured in the regime most favourable to Q.** v3 needs a `gemodel` cell |
| **Loss rate** | Typical long-run PLR **0.5–3.5 %**, mean burst ≈ 6.9 packets; 4G reference 0.2–0.5 % (index-level) | 0 / 0.5 / 2 % | Rates are defensible; the *process* is not |
| **Concurrency** | Benefit requires several streams in flight (Marx, read) | D = 4 / 7, vs ≈ 10 / 13 at the real RTT | Under-exercises the mechanism (C3) |
| **Scheduler** | Round-robin is worst; sequential/non-incremental best for ordered demand (Sander et al., index) | S vs Q only; **P dropped** | Q's win is unattributable without P — v3 S10 restores it |
| **Congestion regime** | Effect shrinks once the connection is cwnd-limited (Sander et al., index; RFC 9002 read) | see below | May be the whole 2 % story |
| **Metric** | Page-load / visual metrics; delay for time-sensitive traffic (Fernández et al.) | miss-only p95 wait | Effect sizes are not comparable across these |
| **Payload** | HTML/CSS/JS waterfalls | 32 KB HTJ2K frames, ordered demand | Ordered demand is *closer* to the sequential ideal — a reason to expect a **smaller** per-frame win than web results suggest |

**RQ3, computed.** Reno-style ceiling `BW ≈ MSS/(RTT·√p)`, MSS = 1200 B (quinn's `INITIAL_MTU`):

| RTT | 0.5 % loss | 2 % loss |
| --- | --- | --- |
| 60 ms (label) | 2.26 Mbit/s — **23 % of link** | 1.13 Mbit/s — 11 % |
| 150 ms (label) | 0.91 Mbit/s — 9 % | 0.45 Mbit/s — 4.5 % |
| **240 ms (real)** | **0.57 Mbit/s — 5.7 %** | **0.28 Mbit/s — 2.8 %** |
| **300 ms (real)** | **0.45 Mbit/s — 4.5 %** | **0.23 Mbit/s — 2.3 %** |

**Read this as a bound, not a verdict.** CUBIC is more aggressive than the Reno model, loss was applied
one-way on server egress only, and v2's observed waits are *shorter* than the table implies — so the
model overstates the severity. But it is enough to say: **at these RTTs and loss rates the connection
is plausibly congestion-limited rather than HOL-limited, and v2 recorded nothing that can rule it
out.** That is a measurable question, and v3 should settle it with a column rather than an argument.

## 6 · Hypothesis verdicts

| ID | Hypothesis | Verdict | Basis |
| - | --- | --- | --- |
| H1 | Transport HOL on S | **Open, mechanism sound** | Spec+source read; only prediction 3 of 4 holds in v2 |
| H2 | Connection CC dominates at high loss | **Supported** | RFC 9002 + CUBIC default (read); §5 ceiling; Sander (index) |
| H3 | Priority helps the wanted frame | **Unattributable** | P was dropped; v3 S10 restores it |
| H4 | Prefetch masks architecture | **Open** | Hit rates differ by arm in some cells (150/0.5 %: S 0.174 vs Q 0.080) |
| H5 | Underpowered / noise | **Supported** | Adversarial review §2.3: power 0.27 / 0.16 |
| H6 | D too small | **Supported by literature** | Marx: concurrency is a precondition; real-RTT formula wants ≈ 10/13 |
| **H7** | **Flow-control asymmetry** | **New, untested, best fit to the lossless gap** | quinn windows (read) × redundancy 3.8→6.7× vs gaps +3.9→+26 % |
| **H8** | **i.i.d. loss favours per-frame; bursty may not** | **Supported** | Marx (read) on burstiness; scheduler×model claims (index) |
| C1 | Redundant re-asks inflate S | **Supported, and coupled to H7** | Adversarial §3.1 |
| C2 | WAN drift, arms in blocks | **Supported** | Adversarial §3.2–3.3; S's lossless block is bimodal (`143 144 ǀ 238 241 250`) — a path change, not an architecture |
| C3 | Depth below formula | **Supported, literature-named** | Marx concurrency requirement |

## 7 · Annotated bibliography (claim cards)

### IETF QUIC WG, 2021 — draft-ietf-quic-transport-34 (text published as RFC 9000)
- **URL / access:** `raw.githubusercontent.com/quicwg/base-drafts/draft-ietf-quic-transport-34/draft-ietf-quic-transport.md` — **read in full**
- **Tier:** T1
- **Claim:** No ordering is guaranteed between bytes on different streams; priority is the application's to supply.
- **Regime:** protocol-level, all regimes · **Maps to:** H1, H3
- **Predicts 0.5 % result:** mechanism yes, magnitude no · **Predicts 2 % null:** no · **Predicts a 0 % gap:** **no**
- **Caveat:** says nothing about *how much* the property is worth in any workload.

### IETF QUIC WG, 2021 — draft-ietf-quic-recovery-34 (text published as RFC 9002)
- **URL / access:** same repo, `-recovery-34` — **read in full**
- **Tier:** T1
- **Claim:** Loss detection is packet-based (kPacketThreshold 3, kTimeThreshold 9/8, PTO for tail loss); congestion response halves the window and is connection-wide.
- **Regime:** all · **Maps to:** H1 (what per-frame does *not* buy), H2
- **Predicts 2 % null:** **yes**, if the cell is cwnd-limited · **Predicts a 0 % gap:** no
- **Caveat:** the algorithm is normative; whether our cells are cwnd-limited is an empirical question (§5).

### quinn-proto 0.11.17 / quinn 0.11.11 / wtransport 0.7.2 — the stack that produced the rows
- **Access:** **read in full**, pinned, from the local cargo registry
- **Tier:** T3
- **Claim:** Strict priority over round-robin (`send_fairness: true` affects equal priorities only); CUBIC by default; per-stream receive window 1.25 MB against a 10 MB connection send window; loss detection packet-level; `set_priority` warns that *"using many different priority levels per connection may have a negative impact on performance"* — and Q uses one level **per frame**.
- **Maps to:** H1, H2, **H7**, and a cost of Q nobody has measured
- **Caveat:** none for behaviour; this *is* the system under test.

### IETF MoQ WG — draft-ietf-moq-transport
- **URL / access:** `raw.githubusercontent.com/moq-wg/moq-transport/main/draft-ietf-moq-transport.md` — **read in full**
- **Tier:** T1
- **Claim:** Objects are grouped into subgroups, one stream per subgroup, because *"the parallel nature of QUIC streams can provide improvements in the face of loss"*; a defined priority scheme sits on top.
- **Regime:** live media · **Maps to:** H1, H3
- **Caveat:** design rationale, not a measurement. Live media tolerates loss differently from stored-frame demand.

### Marx — *Head-of-Line Blocking in QUIC and HTTP/3: The Details* (post, undated revision)
- **URL / access:** `raw.githubusercontent.com/rmarx/holblocking-blogpost/master/README.md` — **read in full**
- **Tier:** T4 by format; author of the T2 work below, text auditable
- **Claims:** *"QUIC's HOL blocking removal only works if there are multiple resource streams active at the same time"*; *"if there is only a single stream active … we will still be HOL blocked, even in QUIC"*; *"packet loss is typically relatively rare … possibly too rare to see much of an impact"*; *"multiplexing resources packet-per-packet is quite bad for resource loading performance"*; **and on the loss model:** *"packet loss is often bursty and grouped… A packet loss rate of 2 % does not mean that you will always have 2 packets out of every 100 being lost… more like 10 consecutive packets being lost in a total of 500."*
- **Maps to:** H1, H6/C3, **H8**, and the P-arm result
- **Predicts a 0 % gap:** **no** · **Caveat:** web resource loading; qualitative.

### Sander, Kunze, Wehrle — *Analyzing the Influence of Resource Prioritization on HTTP/3 HOL Blocking and Performance*, TMA 2022
- **Access:** ⚠ **search-index summary only** (`dl.ifip.org` blocked)
- **Tier:** T2
- **Claims (indexed):** round-robin is the worst strategy; sequential strategies improve 93–130 %; **the effect of prioritization becomes less significant at higher loss rates**; in high *random* loss with low bandwidth, parallel scheduling can leverage reduced HOL blocking more often.
- **Regime:** 35 replayed websites, page-load metrics, shaped links · **Maps to:** H1, H2, H8
- **Predicts 2 % null:** **yes** (first claim) / **no** (second) — **the two indexed statements pull opposite ways and this is unresolved without the text**
- **Caveat:** baseline is round-robin, not a shared stream; metric is not ours.

### Fernández, Khan, Zverev, Diez, Juárez, Brunström, Agüero — *Exploiting stream scheduling in QUIC*, Ad Hoc Networks, 2024
- **Access:** ⚠ **search-index summary only** (ScienceDirect, DiVA both blocked)
- **Tier:** T2
- **Claim (indexed):** priority-based stream schedulers with an application-facing interface yield *"lower delays for time-sensitive applications by up to 36 % under unreliable conditions"*.
- **Regime:** ns-3 + Mahimahi with mmWave traces; control-vs-bulk traffic split · **Maps to:** effect-size plausibility
- **Caveat:** the closeness to v2's 35.5 % is **coincidence between two different setups**, and v2 is void anyway. Use it only to say our magnitude is not absurd.

### Marx, Herbots, Lamotte, Quax — *Resource Multiplexing and Prioritization in HTTP/2 over TCP versus HTTP/3 over QUIC* (WEBIST/LNBIP 2020); *Same Standards, Different Decisions* (EPIQ 2020)
- **Access:** ⚠ **search-index summary only**
- **Tier:** T2
- **Claims (indexed):** multiplexing behaviour differs sharply across QUIC implementations; **sequential scheduling suits bursty loss, parallel scheduling suits random loss; under moderate loss, prioritized parallel beats round-robin.**
- **Maps to:** **H8** (the review's headline), H3
- **Caveat:** the loss-model claim is the single most decision-relevant sentence in this review and it is index-level. **Get the text before v3's decision is written.**

### Packet-loss measurement literature (multiple, index-level)
- **Claims (indexed):** typical long-run PLR 0.5–3.5 % with mean burst length ≈ 6.9 packets; 4G reference values 0.2–0.5 %; Gilbert–Elliott is the standard bursty model and ships in netem as `loss gemodel`.
- **Maps to:** H8, RQ4 · **Caveat:** heterogeneous sources; use for regime plausibility only.

### Domain — DICOM Sup. 235 HTJ2K and vendor HTJ2K-to-browser material
- **Access:** ⚠ index-level · **Tier:** T1/T4
- **Claim:** HTJ2K supports truncated/progressive decoding; vendors stream HTJ2K frames to browsers over HTTP.
- **Verdict:** **no prior art found** on frame-level medical imaging over QUIC/WebTransport, and none comparing stream modes. **Record the null**; MoQT is the closest transferable transport design.

## 8 · Design input for v3 — absorbable verbatim

1. **Add a bursty-loss cell at the 0.5 % decision point** (both RTTs, all arms). The mean rate is held;
   only the process changes:

   ```
   # ~0.5 % mean loss, mean burst ≈ 7 packets (simple Gilbert: bad state loses everything)
   #   steady-state loss = p/(p+r) = 0.07/(0.07+14) = 0.497 %
   #   mean burst length  = 1/r     = 7.1 packets
   tc qdisc … netem loss gemodel 0.07% 14%
   ```

   And **name the loss process in the decision rule**, not just the rate: *"Q must beat S by > 15 % at
   0.5 % loss **under both i.i.d. and Gilbert–Elliott loss**"*, or state explicitly that the claim is
   scoped to i.i.d. loss and does not transfer.

2. **Record achieved throughput per run** (`bytes_on_wire`, `wall_ms` → Mbit/s) as a TSV column, and
   add a gate: if a loss cell sustains **< 25 % of the link rate**, it is congestion-limited and cannot
   arbitrate stream architecture — mark it diagnostic, not decisive (§5).

3. **Soften S12 clause 3, or condition it.** As written — `gain(2 %) ≥ gain(0.5 %)` — it would void a
   *real* effect, because published work and RFC 9002 both predict the differential shrinking once the
   connection is cwnd-limited. Suggested replacement: *"dose–response is required between two loss
   rates that are **both** shown non-congestion-limited by gate 2; where a cell is congestion-limited,
   it is diagnostic and exempt."* **Clause 1 (null control CI contains 0) needs no change — it is
   exactly right, and it is the clause the literature endorses most strongly: no mechanism produces a
   lossless arm gap.**

4. **Test H7 explicitly, cheaply.** After S1/S2 the redundancy is gone, so run one 0 %-loss cell at
   D = 7 and check the null control passes. If a lossless gap *survives*, set
   `TransportConfig::stream_receive_window` equal to the connection `send_window` on both arms (or
   instrument time blocked in `write_all` server-side) and re-run: a gap that moves with flow control
   is not head-of-line blocking.

5. **Vary D inside one cell** (e.g. D ∈ {4, 8, 13} at 0.5 %). Prediction 4 of §3 is the mechanism's
   most distinctive signature — the benefit must grow with concurrency — and no v2 cell can test it.

6. **Report mean and p95 side by side.** The tail-vs-mean split is the mechanism's fingerprint (§3),
   and it is currently a column nobody reads.

7. **Keep P.** Work-order S10 is right and the literature agrees: round-robin is a distinct, known-worse
   behaviour, so without P a Q win is not attributable to per-frame streams.

## 9 · What the literature could not tell us

- **Whether the win survives bursty loss** at the same mean rate — the decisive open question (§8.1)
- **Whether v2's lossless gap is H7** — no published mechanism produces a 0 %-loss arm difference; our
  own flow-control asymmetry is the leading candidate and is untested
- **Whether the two Sander statements actually conflict** — needs the full text
- **What N distinct priority levels cost in quinn** — the warning exists; no measurement found
- **Anything about medical-image frame streaming over QUIC** — a genuine null
- **Every ⚠ row in §7.** Index-level evidence is a lead. Before any of it becomes load-bearing for the
  stream-mode decision, get the full text — starting with Marx et al. 2020, whose loss-model claim is
  the one this review leans on hardest
