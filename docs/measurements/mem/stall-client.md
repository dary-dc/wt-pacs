# The pathological client: asks for a lot, then stops reading

**The case [`README.md`](README.md) said it could not produce.** That document measured
server memory under two workloads and closed by naming the gap:

> *What would actually reach the ceiling is a client that asks for a lot and then stops
> reading entirely — stalled, backgrounded, or hostile. This harness always reads, so it
> cannot produce that case, and this measurement therefore does not rule it out.*

[`transport-conclusions.md`](../../transport-conclusions.md) carries **"bound the
flow-control windows … as a bound on the pathological case"** on exactly that unmeasured
premise. This is the measurement.

Instrument: `window-harness --mode stall` (`lab/window-harness/src/stall.rs`).
Gate: `lab/scripts/e0_stall_validate.sh` — **passed in both stream modes** before any row
below was collected.
Raw data: [`stall_client.tsv`](stall_client.tsv) — **48 rows, 0 VOID**.

```bash
bash lab/scripts/e0_stall_validate.sh                 # must pass first
SM=per-frame SPORT=14653 bash lab/scripts/e0_stall_validate.sh
REPEATS=3 NS="1 4 8 16" ASKS=400 bash lab/scripts/stall_client_campaign.sh
python3 lab/scripts/stall_analyse.py .local/measurements/mem/stall_client.tsv
```

Each client asks for 400 frames — 25 MB, chosen to exceed quinn's 10 MB default
`send_window` by 2.5× — reads until the first byte arrives, then stops reading while
holding the connection and every receive stream open.

---

> **Read §5 before quoting any number here.** Everything in §1–§4 was measured on the
> **chunked** send path, this branch's default. It does **not** generalise: on `copy` and
> `split` the same stalled client costs 6.5–18.6× more, and per-frame reaches 68 % of the
> ceiling. The send path turns out to matter more than the flow-control windows do.

---

## The answer: it does not reach the ceiling, and the queue forms at the other end

**Per-connection cost is the slope against N, not the ratio** — same rule as
[`README.md`](README.md), for the same reason: the intercept is fixed cost.

| arm | stream mode | **server** per stalled connection | **client** per stalled connection | server r² |
| --- | --- | --- | --- | --- |
| default (quinn) | shared | **180 kB** | **2.20 MB** | 0.979 |
| bounded | shared | **166 kB** | 2.11 MB | 0.992 |
| default (quinn) | per-frame | **370 kB** | **7.60 MB** | 0.985 |
| bounded | per-frame | **228 kB** | 7.57 MB | 0.996 |

`bounded` is `--receive-window 2000000 --send-window 200000`, identical to the arm in
[`README.md`](README.md) so the two sweeps compare directly.

### 1 · A stalled client costs the server about what a slow one does

| workload | server per connection | binary |
| --- | --- | --- |
| ordinary reading (`mem_light.tsv`) | 110 kB | `lab-arms/exact-server-seg10` |
| slow reader, 2 Mbps drain (`mem_stress.tsv`) | 162 kB | `lab-arms/exact-server-seg10` |
| **stops reading entirely, shared** | **180 kB** | `target/release/exact-server` |
| stops reading entirely, per-frame | 370 kB | `target/release/exact-server` |

> **The top two rows and the bottom two ran different server binaries**, and this table
> originally read as one experiment. Found by adversarial review, 2026-09-07.
>
> **Measured rather than argued away:** re-running the stall workload on both binaries at
> N = 1 and N = 16 gives **215 kB/connection on the release build against 207 kB on
> `seg10`** — 3.7 %, inside this campaign's own run-to-run spread (the same configuration
> read 180 kB in the campaign and 198 kB in the send-path probe). The comparison stands; the
> binary column stays so nobody rediscovers the question.

**+11 % over the slow reader in shared mode.** The worry the ceilings exist for was
`send_window` at 10 MB per connection. The measured exposure is **180 kB — 55× below it**,
and the client would have to be *fifty times* more pathological before the ceiling became
the thing that bound anything.

### 2 · The bytes queue on the client, not the server

This is the finding, and it is why a sweep watching only the server would have been
uninterpretable:

| stream mode | server holds | client holds | ratio |
| --- | --- | --- | --- |
| shared | 180 kB | 2.20 MB | **12×** |
| per-frame | 370 kB | 7.60 MB | **21×** |

The arithmetic closes. A shared-stream client holds one stream's receive window — quinn's
default 1.25 MB — plus its own buffers, and 2.20 MB is what that looks like. A per-frame
client is served on one stream per frame, and the server opened **99** of them before it
could open no more, consistent with quinn's default `max_concurrent_uni_streams` of 100:
99 × 64 kB = 6.34 MB against 7.60 MB measured.

**The mechanism is that the server frees bytes as they are acknowledged.** A stalled
client's own stack still ACKs at the transport layer, so the data leaves the server and
lands in the client's receive buffers, where it stays because the application never reads
it. What the server retains is not queued payload — it is connection and per-stream
bookkeeping, which is why it tracks the *reading* client's figure so closely, and why
bounding the payload windows barely moves it.

### 3 · Bounding the windows does something, and it is small

| stream mode | default | bounded | ratio | saved per connection |
| --- | --- | --- | --- | --- |
| shared | 180 kB | 166 kB | 1.09× | 14 kB |
| per-frame | 370 kB | 228 kB | **1.62×** | 141 kB |

Ordered in the same direction as the reading workloads, and larger in per-frame — but at
5 000 stalled viewers the shared-mode saving is **0.07 GB against 0.9 GB**. The knob is
real and it is not a lever.

### 4 · Per-frame doubles the server's exposure and triples the client's

An argument for one shared stream that does not depend on the loss mechanism at all:

| | shared | per-frame | penalty |
| --- | --- | --- | --- |
| server per stalled connection | 180 kB | 370 kB | **2.05×** |
| client per stalled connection | 2.20 MB | 7.60 MB | **3.46×** |

> **The 2.05× is not attributable to flow-control windows alone.** Adversarial review noted
> that per-frame mode also retains one completed task per frame in a `JoinSet` drained only at
> session end, so up to ~100 finished task cells sit inside that slope too. Small beside
> 370 kB, and it predates this branch — but the paragraph below credits the windows for all of
> it, and should not.

A per-frame server hands a non-reading client a fresh flow-control window for every frame
it asks for, until the stream-concurrency limit stops it. A shared-stream server hands it
one, once. [`transport-conclusions.md`](../../transport-conclusions.md) §2 recommends the
shared stream on head-of-line blocking under loss; this is an independent reason, visible
at zero loss.

---

## 5 · The send path decides this, more than the windows do

Sections 1–4 were measured on `--send-path chunked`, which *moves* a `Bytes` slice of the
study mapping into quinn's send buffer without copying (`server.rs:553`). That raised an
obvious objection: the campaign reports `RssAnon`, which excludes file-backed pages, so
bytes queued for a stalled client on that path are mmap-backed and **invisible to the metric
watching for them**. A flat server line would then mean "the instrument cannot see this".

The prediction, written before the run: if the flat line were an artefact, `copy` — which
queues a private heap copy per frame, unambiguously anonymous — would show the cost that
`chunked` hides.

Data: [`stall_send_path.tsv`](stall_send_path.tsv) — 48 rows, 0 VOID — via
`lab/scripts/stall_send_path_probe.sh`, analysed by `lab/scripts/stall_send_path_analyse.py`. **The prediction was right, and the artefact is not
one — total RSS agrees with RssAnon in every arm**, so `chunked` genuinely does not pay it.

| send path | stream mode | server per stalled connection | server total RSS per connection |
| --- | --- | --- | --- |
| **chunked** | shared | **198 kB** | 197 kB |
| **chunked** | per-frame | **375 kB** | 380 kB |
| copy | shared | 1 299 kB | 1 311 kB |
| split | shared | 1 292 kB | 1 300 kB |
| **copy** | **per-frame** | **6 990 kB (6.8 MB)** | 6 998 kB |
| split | per-frame | 6 807 kB | 6 816 kB |

(The chunked + shared figure here is **198 kB** against §1's **180 kB**. Both are the same
configuration measured in two separate runs — the campaign at n = 3 and this probe at
n = 2 — so the ~10 % spread is run-to-run variation in a fitted slope, not a disagreement.
Quote §1's for the windows question and this table's for the send-path comparison, where
all six arms were measured together.)

**`RssAnon` is not blind here, and that had to be checked separately from the send-path
question.** Within every arm the two slopes agree to within 1.2 % — chunked per-frame is
the widest, 374.9 against 379.5 kB — so nothing is hiding in
file-backed pages — including on `chunked`, where it could have. The copy-vs-chunked gap is
therefore a real difference in what the server *retains*, not a difference in what the
metric can *see*. (Comparing `copy` against `chunked` cannot answer the blindness question;
only comparing anon against RSS inside one arm can.)

`copy` and `split` are indistinguishable (1 292 vs 1 299 kB; 6 807 vs 6 990 kB), which is
what the mechanism predicts: both leave quinn holding a private copy of the codestream, and
only `chunked` does not. Fits are r² 0.974–0.997 across all six arms.

**So the original worry was well founded — for the send path the project used to ship.**
`copy` + per-frame reaches **6.8 MB per stalled connection, 68 % of the 10 MB
`send_window`**, and that is the case bounding the windows exists to cap. At 5 000 stalled
viewers it is ~34 GB. On `chunked` + shared it is ~1.0 GB, and the ceiling is 50× away.

**The chunked send path is therefore a memory-containment property, not only a CPU one.**
It was adopted for −6…−14 % CPU/byte
([`../../transport-conclusions.md`](../../transport-conclusions.md) §3). It also makes the
pathological client **6.5× cheaper in shared mode and 18.6× cheaper in per-frame**, because the
queue holds refcounted slices of one shared mapping instead of one private copy per
connection. That is a second, independent reason to keep the default — and a reason `main`,
which has the copy path only ([`../../HANDOFF.md`](../../HANDOFF.md) §1), is exposed to this
in a way this branch is not.

### What this means for the recommendation

| if you ship | bound the flow-control windows? |
| --- | --- |
| chunked + shared (this branch's defaults) | **hygiene only** — 1.09×, ceiling 55× away |
| chunked + per-frame | worth it — 1.62× |
| **copy or split + per-frame** | **yes, and for the original reason** — 6.8 MB/connection, 68 % of the ceiling |

---

## What this does not settle

- **T2, loopback, one host.** Same rig and fixture as [`README.md`](README.md), so the
  comparison in §1 is like-for-like, but no real path is involved.
- **The client here is stalled, not hostile.** It uses stack-default windows. A client that
  *widens* its own receive window first is a different threat model —
  `lab/scripts/stall_wide_window_probe.sh` sweeps it, and see §5 below.
- **16 concurrent stalled clients, not thousands.** The fits are linear (r² ≥ 0.979) across
  1–16 and the extrapolation is the same shape as [`README.md`](README.md)'s, but it is an
  extrapolation.
- **64 KB frames.** Per-connection buffering scales with what is in flight, so 250 KB
  frames should raise the client figure and leave the server's bookkeeping cost alone.
- **The send-path probe is n = 2, not n = 3**, and is a probe rather than a campaign. The
  effect it reports is 6–17×, far outside anything n = 2 could manufacture, but the
  *magnitudes* in §5 are less firm than those in §1–§4.
