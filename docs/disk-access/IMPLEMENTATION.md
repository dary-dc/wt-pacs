# Implementing the read path — design

**Decision:** [`adr.md`](adr.md) · **Evidence:** `READ-PATH-DECISION.md` (archived: `git show a330783:docs/disk-access/READ-PATH-DECISION.md`) ·
`S5-CONTROL-ARM.md` (archived: `git show a330783:docs/disk-access/S5-CONTROL-ARM.md`)

What ships today is `pool`: `preadv2(RWF_NOWAIT)` inline, `spawn_blocking` for the shortfall.
This is the change to **`hybrid_lazyring`** — the same path, plus an io_uring built on the
session's *first miss* and used for the shortfall from then on.

## Why no performance toggle

The obvious shape is a config flag choosing "optimised for hits" against "optimised
generally". **The measurement says not to build one.** `hybrid_lazyring` already makes that
choice per session, at runtime, from what the session actually does — and no arm is
*established* better than it in any regime (`v27_lazyring.tsv` (archived: `git show a330783:docs/disk-access/v27_lazyring.tsv`), two runs,
rule as always: |median| ≥ 28.5% **and** sign ≥ 0.8n **and** same sign in both runs):

| Regime | Cheapest arm | `hybrid_lazyring` against it |
| --- | --- | --- |
| hit | `pool_ringloop` 2 069 ns | 2 144 ns — **tie** |
| mix | `hybrid` 5 068 ns | 5 298 ns — **tie** |
| miss | `uring` 14 051 ns | 24 188 ns — **tie** (−26.9 / −20.1%, does not clear 28.5%) |

And the arm a "miss-optimised" setting would select is *established worse* where it is wrong:
`uring` costs **+141.7 / +131.0% on hits, RESOLVED**. A static flag cannot know a session's
miss rate in advance; the lazy ring does not have to guess, because it only builds one once a
read has actually missed.

**What is worth a flag is a kill switch, not a tuning knob.** `WTPACS_READ_PATH=pool` forces
the pre-change path. It is an operational escape from a ring misbehaving in production, and it
costs nothing to keep because `pool` is the code that ships today.

`WTPACS_READ_PATH=uring` is a third value and is **not a production mode**: it skips the
inline probe entirely and reads every frame through the ring, which is the `uring` arm at
+131 to +142% CPU on hits. It exists so a tile-based layout can be experimented with against
a genuinely miss-optimised path. An unrecognised value warns and falls back to `auto` —
a kill switch that silently does nothing because of a typo is worse than no kill switch.

## The trap: never route a hit through the ring

On a filesystem without `RWF_NOWAIT` — overlayfs, tmpfs, i.e. **any container that serves
studies from its own layer** ([`DEPLOYMENT.md`](DEPLOYMENT.md)) — `read_at_nowait` returns `0`
for *every* read, hit or miss, because the flag is refused rather than because the bytes are
cold. A lazy ring keyed naively on "the inline read came up short" would therefore build a
ring on the first ask and then serve **every warm read through it**. That is the `uring` arm,
measured at **+131 to +142% on hits**: the change would make the container case
*significantly worse* than what ships today.

So the ring is gated on `FrameStore::nowait_supported()`, not on the shortfall alone:

| `RWF_NOWAIT` | io_uring | Path |
| --- | --- | --- |
| honoured | available | **`hybrid_lazyring`** — inline hit, ring on the miss |
| honoured | unavailable | **`pool`** — inline hit, `spawn_blocking` on the miss (today's path) |
| refused | either | **`pooled_pread`** — one pooled read per frame, the ADR's escape hatch. **Never the ring** |

The third row is not a degradation to accept quietly: it is ~2.5× worse per frame, and
`check-fastpath` exists so a deployment finds out before it ships.

## The change

Per-session state today is one `Vec<u8>` window owned by `ProductPipeline` and threaded down
to `stream_codestream`. It becomes a small struct so the ring can live beside it with the same
lifetime:

```rust
pub struct ReadCtx {
    probe: bool,      // false only under the `uring` lever
    ring: Ring,       // Off | Pending | Ready | Refused
    window: Vec<u8>,
}
```

**The mode is resolved once, in `ReadCtx::new`, so the read loop has no mode to branch on.**
The three `WTPACS_READ_PATH` values become two independent facts — whether to try the page
cache first, and whether a miss may use a ring — and every combination then runs the same
code. That is why there is no `uring` special case in the loop: with `probe: false` the
page-cache read is skipped, the read always comes up short, and the escalation reads the
whole frame through the ring, which *is* the `uring` arm.

`Ring` has four states rather than being an `Option`, because a kernel that refuses io_uring
(an old one, a seccomp filter, `kernel.io_uring_disabled`) must not be retried on every
subsequent miss — and must not fail the ask either. It records `Refused` and the pooled path
serves.

`ReadCtx::read` returns the bytes that are ready rather than a count of them. A caller
cannot then advance by the wrong number, which is the bug the escalation invites and which
an earlier version of this code had.

`stream_codestream`'s loop is unchanged except for the shortfall branch:

1. `read_at_nowait` into the window — unchanged, and still the whole path on a hit.
2. On a shortfall, **if `nowait_supported()`**: build the ring if absent, submit the remainder,
   await the completion through the registered eventfd. Otherwise `spawn_blocking`, as today.
3. `write_all` the window — unchanged.

Constructing mid-loop is safe for the same reason it is safe in the lab arm: nothing can be
in flight when the ring does not yet exist, because every earlier ask was a hit.

## What does not change

* **The wire.** Byte-for-byte identical; the existing envelope test still guards it.
* **`READ_WINDOW` = 64 KiB**, and the `write_all` per window. Handing quinn owned buffers
  (`write_chunk`) was measured at −3.2% at one session and rejected as under the drift bar
  (`SEND-BUDGET.md` (archived: `git show a330783:docs/disk-access/SEND-BUDGET.md`) §5). It
  has since been measured across session counts and is **+14.6% / +19.1% at 16 / 32
  concurrent sessions, RESOLVED** — quinn holds each window until it is acked, so the buffer
  pool cannot recycle and every window becomes a fresh 64 KiB allocation. The rejection is
  now stronger at scale than at one reader, which is the opposite of what was expected
  ([`adr.md`](adr.md) §Levers).
* **The reclaim guarantee.** Bytes reaching quinn stay process-private — the ring reads into
  the session's own buffer, never a page-cache mapping.
* **`server/` links io-uring for the first time.** Today it is a dependency of the lab crate
  only. Gate it behind a feature so a build without it still compiles to the `pool` path.

## Two things that came out different, and why

**Buffers are not registered.** The measured arm registered both the file and its buffers and
used `ReadFixed`; the product registers the *file* and reads into the session's own window
with `Read`. Registering buffers pins pages, and at thousands of concurrent sessions that is
thousands of unreclaimable frame-sized allocations against `RLIMIT_MEMLOCK`.

**Now measured, and it costs nothing.** `product` against `hybrid_lazyring` on misses at
16 KiB is **+0.7%, 5 of 10 same sign** — a tie with sign agreement at chance
([`v30_product.tsv`](v30_product.tsv)). The reasoning that the difference lives in the
submission path rather than the device path holds.

**Cancellation needed handling the campaign never had to think about.** The kernel writes
into the caller's buffer between submit and completion, so dropping the future in between
hands the kernel freed memory. Session tasks are `tokio::spawn`ed and are dropped at their
await point on runtime shutdown, so this is reachable. `UringReader::drain_in_flight` waits
for the outstanding read, called both from its own `Drop` and from `ReadCtx::drop` — the
latter because a struct's `Drop::drop` runs before any field is dropped, which makes the
guarantee independent of field declaration order instead of one careless reorder away from
memory corruption.

## Test plan

Unit, alongside the existing `frame_store` tests:

| Test | Asserts |
| --- | --- |
| `lazy_ring_is_not_built_when_every_read_hits` | no ring after a warm frame — the arm's whole point |
| `lazy_ring_is_never_built_without_nowait` | with `nowait = false`, no ring is built and the pooled path serves — the container trap |
| `nowait_and_ring_compose_into_the_whole_frame` | prefix from the inline read + remainder from the ring equals the frame, mirroring the existing `spawn_blocking` composition test |
| `a_frame_that_misses_costs_one_round_trip_not_one_per_window` | the escalation reads the rest of the *frame* — the ADR's claim as an assertion rather than a comment |
| `the_uring_lever_serves_whole_frames_through_the_ring` | the lab lever really is the `uring` arm, so a layout experiment measures that and not a broken path |
| `dropping_a_reader_mid_read_waits_for_the_kernel` | `Drop` reaps the outstanding read. The wait is counted, because a read served from the page cache lands before a missing wait could otherwise be observed |
| `streamed_bytes_match_the_envelope_they_replaced` | unchanged, still passes |

**Misses are forced through two test-only `FrameStore` levers** (`force_pool_reads`,
`force_short_reads`) and not by evicting the page cache. Eviction is not a lever a test can
rely on: `fadvise(DONTNEED)` will not evict a mapped page, and on the host these were written
on it does not evict even before the mapping exists — which silently left an earlier version
of the escalation test on the warm path, where it passed against a deliberately broken
implementation.

Then re-run the campaign with the product path as an arm, which is what `read_campaign`
already does through `FrameStore`, and confirm the shipped path lands where
`hybrid_lazyring` did.

## Validated: the shipped path is the arm

`read_campaign --arms product` drives `server`'s own `ReadCtx` the way `stream_codestream`
drives it, so this is the product measured against the candidates rather than against a model
of itself ([`v30_product.tsv`](v30_product.tsv),
`lab/scripts/run_product_validation.sh`). Paired per-cell, the campaign's own rule:

| `product` vs | hit | miss (16 KiB) | miss (250 KB) |
| --- | ---: | ---: | ---: |
| `hybrid_lazyring` — the chosen arm | −0.5%, tie | **+0.7%, tie** | +16.6%, tie |
| `pool` — what shipped before | −0.6%, tie | **−45.4%, RESOLVED** | −6.3%, tie |

The shipped path is indistinguishable from the arm that won, and established cheaper than the
path it replaced where a miss is a whole 16 KiB read. It also reproduces the structural
claim: at 8 readers on misses `pool` peaks at **18** OS threads and every ring arm, the
product included, stays flat at **5**.

The 250 KB miss column is the one to watch. −6.3% against `pool` is what the ADR predicts —
the ring saves a roughly fixed per-round-trip cost, which is most of a 16 KiB read and under
8% of a 250 KB one — so the product's real frame size is where this change is worth least.

**The +16.6% against `hybrid_lazyring` there was rerun at 15 repeats and is not a
difference — the cell cannot measure one** ([`v31_gap250k.tsv`](v31_gap250k.tsv)). It fell to
**+6.7% with 16 of 30 signs**, agreement at chance. The reason is the cell, not the arms: a
250 KB cold read on this device varies **2× to 12.5× between repeats of the same arm**
(CV 0.23–1.16), and the control — `hybrid` against `hybrid_lazyring`, which differ only in
*when* the ring is built — is itself at 12.5× spread. Nothing smaller than about 2× is
resolvable here. Resolving it needs many more asks per cell to average the device tail, or a
quieter device; it is not a question more repeats will answer.

## Measuring the arm at thousands of sessions

The decision so far rests on cells at 1–8 readers and depth 1. The deployment target is
thousands of concurrent sessions, most asks missing. This is what has to be measured, in
order, and what each step would decide.

### First, the distinction that decides most of it

**Thousands of users is `readers`, not `depth`.** The published `uring` advantage lives at
depth > 1 — several reads in flight *inside one session* — because the inline probes then run
serially on the executor before the ring can batch. A thousand sessions each doing one read
per ask is a thousand instances of depth 1, where there is nothing to serialise: measured at
depth 1 `uring` **ties on misses and is 3× worse on hits**
([`v32_depth.tsv`](v32_depth.tsv)).

The depth axis only opens if the session loop serves several asks from one session
concurrently, which `adr-reject-server-ordering.md` currently forbids. So Phase 3 below is
conditional on that design changing.

### Phase 0 — make the miss rate observable (prerequisite)

Every threshold below is a miss rate, and the server cannot currently report its own. Until a
session can say how often it escalated, none of the phases can be evaluated against
production. This is the only item that blocks the rest.

### Phase 1 — per-session ring cost (done)

Both ring arms build one io_uring plus one eventfd per session that misses
(`lab/disk-access-bench/src/bin/ring_scale.rs`):

| | measured |
| --- | --- |
| File descriptors | **2 per session** that misses |
| Resident memory | **8.7 KiB per ring** |
| Construction, steady state | **15.6 µs** — pays back on the first miss against a ~29 µs pool hop |
| Construction, mass creation (1 000–4 000 at once) | 82–100 µs, p99 0.5–1.2 ms |
| Ceiling | 4 000 rings created without failure |

**The operational consequence is the descriptors.** At 1 000 missing sessions that is 2 000
fds on top of the sockets; a host left at the common `ulimit -n` of 1024 caps out near 500
sessions, and the failure is a refused ring, not a refused connection. Raise `LimitNOFILE`
before this matters — and note the mass-creation row: a restart with a thundering herd pays
~5× the steady-state construction cost, on the executor.

### Phase 2 — the readers sweep, which decides the arm

`read_campaign --arms pool,hybrid_lazyring,uring --depths 1 --readers 1,8,32,64,128,256`,
cold, stride past the read-ahead window. Six repeats, arms rotated per repeat.

Read three columns, not one: `cpu_ns_per_ask`, `threads`, and `asks_per_s`. The question is
not only which arm is cheapest but **which curve bends first** — `pool` grows threads (18 at
8 readers already), the ring arms grow descriptors.

* **Decides:** whether `hybrid_lazyring` holds its −56 to −75% against `pool` as readers
  climb, and whether `uring` ever crosses it at depth 1.
* **Caveat that must be stated in the result:** on a 4 vCPU host, a few hundred reader tasks
  measure the host, not the arm. Report where the host saturates and stop claiming anything
  past it.

### Phase 3 — depth × readers, only if the session loop changes

If a tile viewport is served with several asks in flight, rerun Phase 2 at depths 1 and 4
crossed with readers 1, 32, 128. Then apply the breakeven from
[`EVIDENCE.md`](EVIDENCE.md): `uring` pays above a **53–64% miss rate** at depth 4–16 and
never at depth 1.

* **Decides:** whether `WTPACS_READ_PATH=uring` should become a supported production mode
  rather than a lab lever.

### Phase 4 — the arithmetic that turns it into a decision

With Phase 0 giving a real miss rate `m` and Phase 2/3 giving hit penalty `P` and miss saving
`S` in ns per ask, `uring` wins when `m·S > (1−m)·P`. Nothing else about the choice needs
arguing once those three numbers exist.

## Before rollout: the one thing still unmeasured

**The chosen arm was never measured above one concurrent session**, and the deployment target
is thousands. `v30_product.tsv` extends it to **8 readers** — where the product still ties
`hybrid_lazyring` and `pool` still grows threads — but 8 is not thousands. The reader-scale
evidence tops out at 128 readers and does not include this arm:

| readers | `pool` threads | `hybrid` | `uring` |
| ---: | ---: | ---: | ---: |
| 1 | 11–12 | 5 | 5 |
| 16 | 77–82 | 5 | 5 |
| 64 | 160–265 | 5 | 5 |
| 128 | 227–381 | 5 | 5 |

Two readings. **Thread growth separates ring-from-`pool`, not the two ring arms** — so scale
is an argument for shipping a ring at all, not for choosing between them. And `pool` at 381
threads for 128 readers is the number that should decide the schedule: at thousands of
concurrent sessions, the arm that shipped before this change is the one that does not hold up.

Closing it is cheap, and it belongs before rollout rather than before implementation:

```bash
./target/release/read_campaign --arms pool,hybrid,hybrid_lazyring,uring \
  --readers 1,16,64,128 --depth 1 --out /tmp/v29_lazyring_readers.tsv
lab/scripts/pair_arms.py --pairs hybrid_lazyring:hybrid,uring:hybrid_lazyring \
  --by readers /tmp/v29_lazyring_readers.tsv
```

Expect ties throughout — `hybrid_lazyring` is `hybrid` with a lazier constructor, and
`hybrid` is already measured to 128. A surprise there is the only thing that would change
the arm.

## Sequencing

1. `ReadCtx` + the gated lazy ring + tests. Behaviour identical on every host where
   `RWF_NOWAIT` is refused, and identical warm everywhere.
2. Run `check-fastpath` on the deployment host — it decides which of the three rows above you
   are on, and therefore whether this change is worth anything at all.
3. **Land it without waiting on the layout decision.**

### The layout changes what this is worth, not which path wins

Worth stating plainly, because the opposite is easy to assume. The disk layout decides
**how often reads miss** ([`../disk-layout/ACCESS-PATTERNS.md`](../disk-layout/ACCESS-PATTERNS.md)):
a strided layout steps to 99% miss under pressure, a grouped one holds at 0.5%. What it does
**not** decide is which read path to build, because `hybrid_lazyring` is tied for cheapest in
*every* regime — there is no layout under which some other arm becomes the right answer:

| If the layout leaves reads… | Cheapest arm | `hybrid_lazyring` | What this change is worth |
| --- | --- | --- | --- |
| **hitting** (grouped, fits cache) | `pool_ringloop` | tie | **~nothing** — no ring is ever built, so it behaves like today's path |
| **mixed** | `hybrid` | tie | ~2.7× against `pool` |
| **missing** (strided, under pressure) | `uring` | tie | **~2.5×** against `pool` |

So the layout decision moves the payoff between "nothing" and "2.5×". It never makes a
different arm correct. That is the argument for landing this **before** the layout is
settled rather than after: on a hit-dominated workload the ring is never constructed and the
change is inert by design, and on a miss-dominated one it is already in place.

Earlier drafts of this section said to "adopt only if the layout leaves reads missing". That
was wrong — it confused *how much the change is worth* with *whether it is the right change*.
