# Window depth and server priority — the experiment that decides both

**Status:** design, not yet run · **Date:** 2026-08-26
**Follows:** [`adr-reject-server-cancel.md`](adr-reject-server-cancel.md) ·
[`stride-and-queue-experiment.md`](stride-and-queue-experiment.md)

---

## 0. What this decides

One fork, not two questions:

| | Shallow window | Deep window |
| - | -------------- | ----------- |
| Client keeps outstanding | `D` small (≈ `D_min`) | `D` large |
| Stale asks held by server when the reader moves | ≈ none | `D − 1` |
| Needs server-side ordering | **no** — stay FIFO | yes |
| Speculative fill / cache warmth | weak | strong |

Deep window and server ordering are a **package**. Shallow window needs neither half. Pick one.

---

## 1. The model

The client keeps `D` asks outstanding. The server sends one frame at a time, so in steady state it
holds **1 in flight + `D − 1` pending**. Deque depth is set by `D`, *not* by link rate — the client
refills as fast as the server drains.

When the reader moves, those `D − 1` pending asks are for where the reader **used to be**.

```
frame bytes S, link rate B  →  one frame costs  S/B seconds

FIFO   wait = (D−1)·S/B  +  remainder of the in-flight frame
GEN    wait =               remainder of the in-flight frame

saving ≈ (D−1) · S/B
```

Independent of reader speed and of RTT. Purely `D`, frame size, link rate.

### Predicted saving, 250 KB frames

| `D` | 10 Mbps | 25 Mbps | 50 Mbps |
| --- | ------- | ------- | ------- |
| 2   | 200 ms  | 80 ms   | 40 ms   |
| 4   | 600 ms  | 240 ms  | 120 ms  |
| 8   | 1400 ms | 560 ms  | 280 ms  |
| 16  | 3000 ms | 1200 ms | 600 ms  |

### `D` is derived from the link, not chosen

`D` is **not** a free product parameter. Two quantities are independent:

| | |
| - | - |
| **`W`** — window | how many frames around the cursor the client wants cached. Grows over **time** at the link's fill rate |
| **`D`** — outstanding asks | how many of those are pending at the server at once. Sets **pipelining depth only** |

`D` past the point that saturates the link buys **no throughput** and adds `(D − D_min)` frames of
stale work on every move. So the correct production value is the link-derived floor:

```
D_min = ceil(U · (1 + RTT/Tf))
```

Substituting into `saving = (D−1)·Tf`:

```
saving = U·RTT − (1−U)·Tf   ≈   RTT
```

> **At link-derived depth, server-side ordering is worth approximately one RTT — independent of frame
> size and link rate.** This converges with the independent derivation in
> [`stride-and-queue-experiment.md`](stride-and-queue-experiment.md) §2.

Consequence for §8: the falsifier becomes a statement about **deployment**, not about code. Ordering
clears 100 ms only when **RTT ≳ 100 ms**. It is a far-reader feature.

`D` still sweeps in the harness — to confirm `D_min` actually saturates, and to confirm the saving
curve is linear in `D` as §1 predicts. It does not sweep in the product.

---

## 2. Why the previous sweep measured zero

`adr-reject-server-cancel.md` found cancel beat FIFO at **0 of 100** sweep points. That was not a
falsification of the mechanism. **It was a measurement at `D ≈ 1`, where the model predicts exactly
zero.**

Retro-prediction against that fixture (51 KB mean frame, 10 Mbps → 41 ms per frame):

| `D` | predicted saving |
| --- | ---------------- |
| 1   | **0 ms** ← what was measured |
| 2   | 41 ms |
| 4   | 123 ms |
| 8   | 287 ms |

The old harness paced reads without an outstanding-ask window, so `D` was never a variable. **`D` is
the independent variable this time.** Cancel and newest-first act on identical bytes — both reach only
what sits in the deque — so the earlier null result transfers to priority unchanged, and is equally
uninformative about `D > 1`.

---

## 3. The mechanism that could still make it zero

The model assumes pending work sits **in the server deque**. It may not.

The sender opens one uni stream per frame and writes the envelope. If that write returns once
*buffered* rather than once drained, the sender loops and dequeues the next ask immediately. The
deque empties into the transport, `D − 1` pending becomes `D − 1` **committed**, and nothing is
reorderable — regardless of `D`.

That is the same mechanism the cancel ADR identified: **the bottleneck is transport commit, not deque
depth.** It applies to ordering exactly as it applied to cancel.

So the real question this experiment answers is:

> **Where does work queue — the server deque, or the transport?**

And that is controllable. Capping concurrently open streams keeps work in the deque where ordering can
reach it. It is a server knob, and therefore an arm.

---

## 4. Arms — 2×2, not A/B

| Arm | Ordering | In-flight stream cap | Purpose |
| --- | -------- | -------------------- | ------- |
| **A** | FIFO | uncapped (today) | baseline |
| **B** | generation | uncapped | isolates ordering alone — **expected ≈ A** if §3 holds |
| **C** | generation | capped at 1 | the candidate design |
| **D** | FIFO | capped at 1 | control — separates "capping" from "ordering" |

B ≈ A with C ≫ A is the signature that says commit depth, not deque depth, is the lever. A ≈ B ≈ C
says ordering is worthless here and the shallow window wins.

---

## 5. The ordering rule

Not last-ask-wins. Last-ask-wins inverts priority *within* one window: a client that emits
`center, near-fill, far-fill` would get far-fill served first.

Each window emission carries a **generation** counter. Server rule:

```
serve by (generation descending, then arrival order ascending)
```

Newest window first; the client's own priority preserved inside it. Supporting policy:

| | |
| - | - |
| **Dedup** | by frame index, keep the highest generation |
| **Cap** | bounded deque; on overflow drop the **lowest** generation |
| **Drops are silent** | the downlink carries exceptions, never completions. A dropped ask produces no message |
| **Consequence** | the client must re-ask. Acceptable only because readers make repeated depth passes — but it is a real consequence, not an implementation detail |

---

## 6. What to measure — two numbers, not one

Capping in-flight streams may idle the link between frames, especially at high bandwidth-delay
product. Responsiveness and throughput must both be reported or the result is unreadable.

| Metric | Definition |
| ------ | ---------- |
| **`recovered_ms`** | reader move → first byte of the frame now under the cursor |
| **`fill_rate`** | steady-state frames/s delivered while the reader is stationary |

**The trade this experiment prices: commit depth buys throughput and costs reorderability.**

---

## 7. Sweep axes

| Axis | Range | Why |
| ---- | ----- | --- |
| `D` | 1, 2, 4, 8, 16, 32 | the independent variable |
| Link rate | 1–300 Mbps (existing script) | coverage |
| Frame size | ~32 KB, ~51 KB (existing), ~250 KB | ADR §4 named small frames as the flip condition |
| RTT | 0, 20, 60, 150 ms via netem | required — see `stride-and-queue-experiment.md` §4 |
| Arm | A, B, C, D | §4 |

Trace: existing `fly_and_settle`. **`max_step = 1` is sufficient** — stale deque contents come from the
client outrunning the link, not from jumping. No jump trace is needed to make this fire.

---

## 8. Decision rule, fixed in advance

| Result | Conclusion |
| ------ | ---------- |
| Arm C beats arm A by **≥ 100 ms** `recovered_ms` **at `D = D_min`** (not at inflated `D`), **without** losing more than 10% `fill_rate` | Adopt generation ordering — expected only at RTT ≳ 100 ms |
| Arm C only wins at `D > D_min` | **Reject.** The win was bought by inflating `D`, which costs staleness and buys no throughput |
| Arm C beats A on `recovered_ms` but loses > 10% `fill_rate` | Report the curve. This becomes a product tuning decision, not an engineering one |
| A ≈ B ≈ C at all `D` | Shallow window wins. Server stays FIFO. Write the ADR and delete the ordering path |
| B ≫ A | The §3 commit model is wrong. Stop and re-derive before building anything |

---

## 9. Server and wire changes

**All of this lives in `lab/window-server`, not product `exact-server`.**

| Change | Where |
| ------ | ----- |
| `generation: u32` on ask (optional, default 0) | `common/fod` — product ignores it |
| Sender: pop by `(gen desc, arrival asc)` | `lab/window-server` |
| Sender: optional in-flight stream cap | `lab/window-server` (`--stream-cap`) |
| Bounded deque with drop-lowest-generation | `lab/window-server` |
| Harness client: emit a window of `D` outstanding asks, bump generation on move | `lab/queue-harness` (`--depth`) |

Arms A–D are `--order` / `--stream-cap` on the **lab** binary only. Product stays FIFO with no
experiment flags.

```bash
./lab/scripts/window_depth_sweep.sh
```

---

## 10. What simulation cannot answer

The layer-1 sim overpredicted `recovered_ms` by roughly **10×** at low rates, because it models a deque
and the real transport commits bytes earlier. §3 is exactly that effect, promoted to the central
question. **A sim cannot answer §3 — it is the thing the sim gets wrong.**

Use the sim only to sanity-check §1's arithmetic. Every arm comparison must come from layer 2.

Quotability rules unchanged: [`queue-and-hol-harness.md`](queue-and-hol-harness.md) §5.
