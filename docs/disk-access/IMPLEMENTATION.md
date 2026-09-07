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
/// Per-session read state. One window buffer, and a ring that exists only after this
/// session has actually missed.
pub struct ReadCtx {
    mode: ReadMode,
    ring: Ring,       // Untried until the first shortfall; never Ready without RWF_NOWAIT
    window: Vec<u8>,
}
```

`Ring` is a three-state enum rather than an `Option`, because a kernel that refuses io_uring
(an old one, a seccomp filter, `kernel.io_uring_disabled`) must not be retried on every
subsequent miss — and must not fail the ask either. It records `Unavailable` and the pooled
path serves.

`stream_codestream`'s loop is unchanged except for the shortfall branch:

1. `read_at_nowait` into the window — unchanged, and still the whole path on a hit.
2. On a shortfall, **if `nowait_supported()`**: build the ring if absent, submit the remainder,
   await the completion through the registered eventfd. Otherwise `spawn_blocking`, as today.
3. `write_all` the window — unchanged.

Constructing mid-loop is safe for the same reason it is safe in the lab arm: nothing can be
in flight when the ring does not yet exist, because every earlier ask was a hit.

## What does not change

* **The wire.** Byte-for-byte identical; the existing envelope test still guards it.
* **`READ_WINDOW` = 64 KiB**, and the `write_all` per window. Handing quinn owned buffers was
  measured at −3.2% and rejected (`SEND-BUDGET.md` (archived: `git show a330783:docs/disk-access/SEND-BUDGET.md`) §5); nothing here revisits
  it.
* **The reclaim guarantee.** Bytes reaching quinn stay process-private — the ring reads into
  the session's own buffer, never a page-cache mapping.
* **`server/` links io-uring for the first time.** Today it is a dependency of the lab crate
  only. Gate it behind a feature so a build without it still compiles to the `pool` path.

## Two things that came out different, and why

**Buffers are not registered.** The measured arm registered both the file and its buffers and
used `ReadFixed`; the product registers the *file* and reads into the session's own window
with `Read`. Registering buffers pins pages, and at thousands of concurrent sessions that is
thousands of unreclaimable frame-sized allocations against `RLIMIT_MEMLOCK`. The difference
lives in the submission path (sub-microsecond) and not the device path (~105 µs for a 64 KiB
random read on the validation host), so it cannot move a miss-path result — but that is
reasoning, not a measurement. **Confirm it when the bench next runs the product path as an
arm.**

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
