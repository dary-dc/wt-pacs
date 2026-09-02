# L1 loss run — literature & web investigation guide

**Purpose:** Ground the L1 v2 empirical results (S shared stream vs Q per-frame+priority under netem loss) in published theory and practitioner analysis — not only in our TSV. Usable by any agent doing follow-up web research.

**Empirical anchor:** `docs/measurements/r2/l1_s_vs_q_loss_v2.tsv` (120 rows, v2 miss-only methodology). Decision rule: Q must beat S by **>15% on median `miss_p95_wait_ms` at 0.5% loss**.

**Do not treat this doc as the experiment result.** It is a **research plan + hypothesis map**.

---

## 1. What we measured (minimal context)

| Arm | Meaning |
|-----|---------|
| **S** | One shared WebTransport uni stream for all frames |
| **Q** | One uni stream per frame + priority scheduling |

Under controlled RTT (60 / 150 ms) and loss (0 / 0.5 / 2 %), a trace-driven client keeps **window depth D** frames in flight (prefetch). Metric for decision: **miss-only p95 wait** (positive waits only).

### Empirical summary (medians, n=10 per loss cell)

| RTT | Loss | S miss_p95 | Q miss_p95 | Q vs S |
|-----|------|------------|------------|--------|
| 60 ms | 0.5% | 257 ms | 166 ms | ~−36% |
| 150 ms | 0.5% | 685 ms | 485 ms | ~−29% |
| 60 ms | 2% | 1375 ms | 1394 ms | ~0% |
| 150 ms | 2% | 3138 ms | 3027 ms | ~+4% |

**Open question:** Why does stream architecture seem to matter at 0.5% but not at 2%?

---

## 2. Research questions (prioritized)

### RQ1 — Mechanism (0.5% loss)
When loss is light, **why** should per-stream isolation + priority reduce miss tail latency vs one shared byte stream?

- Transport HoL blocking on a single TCP/QUIC connection?
- Application-level blocking (one outstanding frame blocks others on shared stream)?
- Priority scheduling delivering the *wanted* frame first on Q?
- Different prefetch / hit dynamics (hit rate differs between arms)?

### RQ2 — Null at 2% loss
When loss is heavy, **why** do S and Q converge?

Candidate explanations (not mutually exclusive):

1. **Connection-level congestion control** — one `cwnd` for the connection; loss shrinks rate for all streams (QUIC per-stream isolation ≠ per-stream bandwidth).
2. **Loss dominates recovery** — every miss waits ~RTT for retransmission; architecture matters less than “how often you miss.”
3. **Saturation / high baseline** — waits are so large (1–3 s) that a 10–15% architectural gap is within run noise.
4. **Measurement ceiling** — high variance (CV ~0.14–0.23 at 2%) with n=10 cannot resolve small differences.
5. **Experimental regime mismatch** — theory assumes *many* concurrent in-flight streams; we have D=4/7 frames, not a full web page waterfall.

### RQ3 — Is prefetch/caching part of the story or noise?
- Is window prefetch **realistic** for this product (yes — it is the client model)?
- Does comparing miss-only p95 **discard** the main benefit of Q (fewer misses via better scheduling)?
- Should decision also consider hit rate, mean wait, or user-visible all-sample p95?

### RQ4 — External validity
Do HTTP/3 / QUIC / WebTransport results transfer to:

- Binary frame payloads (~32 KB), not HTML/CSS/JS?
- Exactly **two** arms (shared vs per-frame), not browser prioritization trees?
- Server-side netem on a 10 Mbit cap?

---

## 3. Concepts to lookup (glossary for search)

| Term | Why it matters here |
|------|---------------------|
| **Head-of-line (HoL) blocking** | Single ordered byte stream: loss on one frame may delay delivery of later frames on **S**. |
| **QUIC stream isolation** | Loss on stream A should not block delivery on stream B (transport layer). |
| **HTTP/2 vs HTTP/3 HoL** | Canonical web narrative; map carefully to our WebTransport framing. |
| **Connection-level congestion control** | Shared `cwnd` — all streams slow together after loss ([RFC 9002](https://www.rfc-editor.org/rfc/rfc9002)). |
| **Resource prioritization (HTTP/2 / HTTP/3 EPS)** | Whether priority helps the *current* wanted resource under parallel loads. |
| **QPACK blocking** | HTTP/3-specific app-layer blocking (likely N/A to our binary frames — confirm). |
| **Loss recovery RTT** | Fast retransmit / timer-based loss detection ≈ 1 RTT stall per loss event. |
| **Multiplexing gain vs overhead** | More streams ⇒ more headers/state; may hurt at low loss too. |

---

## 4. Seed references (starting points — verify and extend)

Agents should **read primary sources**, not only blog summaries.

| Source | URL | Relevance |
|--------|-----|-----------|
| Robin Marx — QUIC HoL blocking blog series | https://github.com/rmarx/holblocking-blogpost | Skeptical take: HoL removal may **not** help typical web much; needs multiplexing + loss. |
| TMA 2022 — Resource prioritization & HTTP/3 HoL | https://dl.ifip.org/db/conf/tma/tma2022/tma2022-paper28.pdf | Prioritization + multi-stream in-flight needed for QUIC benefit. |
| RFC 9000 (QUIC transport) | https://www.rfc-editor.org/rfc/rfc9000 | Stream independence, connection-level FC/CC. |
| RFC 9002 (QUIC loss recovery & CC) | https://www.rfc-editor.org/rfc/rfc9002 | Shared congestion control — key for RQ2. |
| “TCP vs QUIC loss recovery” (practitioner) | https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/mitigating-head-of-line-blocking/tcp-vs-quic-loss-recovery-under-packet-loss/ | Same RTT to detect loss; different *blast radius* across streams. |
| “Does HTTP/3 eliminate HoL blocking?” | https://www.network-priority.com/http2-http3-multiplexing-connection-optimization/mitigating-head-of-line-blocking/does-http3-eliminate-head-of-line-blocking/ | CC collapse at high loss; app-layer blocking remains. |

---

## 5. Search queries (copy-paste for agents)

### HoL & streams
- `QUIC stream isolation packet loss head-of-line blocking shared connection`
- `HTTP/2 TCP HoL blocking vs HTTP/3 QUIC independent streams measurement`
- `WebTransport streams multiplexing loss recovery`

### Priority
- `HTTP/3 extensible prioritization scheme lossy network`
- `QUIC stream priority scheduler retransmission`
- `resource prioritization tail latency web`

### High loss / null result
- `QUIC advantage disappears high packet loss congestion window`
- `connection-level congestion control QUIC all streams throttle`
- `when does HTTP/3 outperform HTTP/2 loss rate threshold`

### Window / prefetch (map to our D=4/7)
- `prefetch window concurrent streams optimal count`
- `parallel downloads vs head of line blocking diminishing returns`

### WebTransport-specific
- `WebTransport datagram uni stream performance`
- `WebTransport vs HTTP/3 streaming latency`

---

## 6. Hypotheses ↔ evidence map

Use this table when reading papers. Mark each: **supports / contradicts / neutral / not addressed**.

| ID | Hypothesis | Predicts at 0.5% | Predicts at 2% | How to test with our data | How to test via literature |
|----|------------|------------------|----------------|---------------------------|----------------------------|
| H1 | **Transport HoL on S** | Q better miss tail | Gap shrinks if all streams loss-limited equally | Compare miss wait distribution shape S vs Q | Papers quantifying stall *per loss event* × streams affected |
| H2 | **Connection CC dominates** | Small gap if cwnd healthy | S≈Q when cwnd collapsed | Monotonic miss_p95 vs loss; check if 2% waits ≫ RTT | RFC 9002, CC collapse thresholds (~15–20% cited in blogs — verify) |
| H3 | **Priority helps wanted frame (Q)** | Q better even at same miss count | Same if everything retransmit-bound | Raw waits: is Q's *current-frame* wait lower at same step? | Priority scheduling under loss papers |
| H4 | **Prefetch masks architecture** | Hit rate differs S vs Q | Hit rate low both (~5%) | Compare `cache_hit_rate`, `cache_misses` | Theory often assumes no client-side prefetch window |
| H5 | **Noise / n too small** | — | S≈Q within CI | Bootstrap CI, sign tests | Statistical power analysis |
| H6 | **Wrong regime (D too small)** | Partial Q benefit | No benefit | Literature on minimum parallel streams for gain | Marx blog: need luck + multiplexing |

---

## 7. Agent workflow (step-by-step)

1. **Read** `docs/lanes/L1-loss-run.md` (methodology) and skim TSV.
2. **Run validation** (local, no new experiments): bootstrap CI, raw JSON histograms — see §8 below.
3. **Pick 2–3 hypotheses** from §6 that match the 0.5% win / 2% null pattern.
4. **Web investigation:** for each hypothesis, find **≥1 primary** (RFC, paper) + **≥1 measurement study**.
5. **Extract claim cards** (template below) into a new section or sibling doc — do not overwrite this guide.
6. **Reconcile:** Does literature predict our crossover near 0.5–2%? If not, note **regime mismatch**.
7. **Recommend** (separate section): *follow-up experiments* vs *interpretation only* — do not change past TSV without new campaign.

### Claim card template

```markdown
### [Author, year] — [title]
- **URL:**
- **Claim (1 sentence):**
- **Loss / RTT regime:**
- **# concurrent streams:**
- **Maps to H1–H6:**
- **Predicts our 0.5% result:** yes / no / unclear
- **Predicts our 2% null:** yes / no / unclear
- **Caveat for wt-pacs:** (WebTransport, 32KB frames, D=4/7, netem, etc.)
```

---

## 8. Local validation checklist (no rig required)

Run against committed TSV + `.local/r2/l1v2/raw/*.json`.

| Check | Pass criterion | Failure implies |
|-------|----------------|-----------------|
| Row count | 120 data rows, 0 VOID/FAIL | Incomplete campaign |
| Raw JSON | Every TSV row has matching JSON | Metric not auditable |
| Recompute miss_p95 | Matches TSV from `wait_ms` | Harness bug |
| Integrity gates @ 0.5% | misses ≥20, hit ≤90% | Prefetch-dominated cell |
| Integrity gates @ 2% | misses ≥20, hit ≤90% | Same |
| Monotonicity | miss_p95: 0 < 0.5% < 2% per arm | netem / setup bug |
| peak_outstanding ≥ D | all rows | Window not saturated |
| stream_mode in raw | S=shared, Q=per-frame | Wrong binary deployed |
| Bootstrap CI @ 0.5% | 60ms: CI excludes 0; 150ms: may include 0 | Power / variance issue |
| Bootstrap CI @ 2% | CI includes 0 | Cannot claim S≠Q |
| Pooled wait histogram | Q shifted left vs S at 0.5%; overlap at 2% | Shape vs median artifact |

---

## 9. Expected literature-backed narrative (draft — verify)

**Working hypothesis (to confirm/refute via investigation):**

> At **0.5% loss**, occasional loss events create **partial HoL or scheduling delay** on the shared stream; **Q** isolates or prioritizes the wanted frame, shortening miss tails. At **2% loss**, **connection-level congestion control and repeated recovery** raise all miss waits into a **multi-second, high-variance regime** where stream isolation no longer differentiates arms measurably with n=10.

This is **consistent with** QUIC/CC literature (shared `cwnd`, loss recovery ≈ RTT) and **consistent with** our validation (gates pass, monotonicity holds, 2% CIs wide).

This is **not proven** without: (a) stronger statistics, (b) transport traces (qlog), (c) explicit HoL classification.

---

## 10. Deliverables for investigation agents

When closing a research pass, produce:

1. **Annotated bibliography** (≥5 sources) using claim cards.
2. **Hypothesis verdict table** (H1–H6: supported / refuted / open).
3. **Regime map:** which published results apply at 0.5% vs 2% vs our D=4/7.
4. **One-page “so what”** for product: when Q matters, when it does not, what we still don’t know.
5. **Optional:** suggested *future* measurements (qlog, paired runs, extra loss points) — list only; do not execute unless asked.

---

## 11. Related repo paths

| Path | Content |
|------|---------|
| `docs/lanes/L1-loss-run.md` | v2 methodology |
| `docs/measurements/r2/l1_s_vs_q_loss_v2.tsv` | Results |
| `docs/measurements/r2/l1_s_vs_q_loss.tsv` | **Superseded** v1 |
| `.local/r2/l1v2/raw/*.json` | Per-run `wait_ms` arrays |
| `lab/window-harness/src/metrics.rs` | Metric definitions |

---

*Last updated: 2026-09-02 — created after L1 v2 grid completion.*
