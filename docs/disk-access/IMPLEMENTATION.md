# Implementing the read path — design

**Decision:** [`adr.md`](adr.md) · **Evidence:** [`READ-PATH-DECISION.md`](READ-PATH-DECISION.md) ·
[`S5-CONTROL-ARM.md`](S5-CONTROL-ARM.md)

What ships today is `pool`: `preadv2(RWF_NOWAIT)` inline, `spawn_blocking` for the shortfall.
This is the change to **`hybrid_lazyring`** — the same path, plus an io_uring built on the
session's *first miss* and used for the shortfall from then on.

## Why no performance toggle

The obvious shape is a config flag choosing "optimised for hits" against "optimised
generally". **The measurement says not to build one.** `hybrid_lazyring` already makes that
choice per session, at runtime, from what the session actually does — and no arm is
*established* better than it in any regime ([`v27_lazyring.tsv`](v27_lazyring.tsv), two runs,
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

Per-session state today is one `Vec<u8>` window created in `handle_incoming` and threaded
down to `stream_codestream`. It becomes a small struct so the ring can live beside it with the
same lifetime:

```rust
/// Per-session read state. One window buffer, and a ring that exists only after this
/// session has actually missed.
pub struct ReadCtx {
    window: Vec<u8>,
    ring: Option<UringReader>,   // None until the first shortfall; None forever without RWF_NOWAIT
}
```

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
  measured at −3.2% and rejected ([`SEND-BUDGET.md`](SEND-BUDGET.md) §5); nothing here revisits
  it.
* **The reclaim guarantee.** Bytes reaching quinn stay process-private — the ring reads into
  the session's own buffer, never a page-cache mapping.
* **`server/` links io-uring for the first time.** Today it is a dependency of the lab crate
  only. Gate it behind a feature so a build without it still compiles to the `pool` path.

## Test plan

Unit, alongside the existing `frame_store` tests:

| Test | Asserts |
| --- | --- |
| `lazy_ring_is_not_built_when_every_read_hits` | `ctx.ring.is_none()` after a warm frame — the arm's whole point |
| `lazy_ring_is_never_built_without_nowait` | with `nowait = false`, `ring` stays `None` and the pooled path serves — the container trap |
| `nowait_and_ring_compose_into_the_whole_frame` | prefix from the inline read + remainder from the ring equals the frame, mirroring the existing `spawn_blocking` composition test |
| `streamed_bytes_match_the_envelope_they_replaced` | unchanged, still passes |

Then re-run the campaign with the product path as an arm, which is what `read_campaign`
already does through `FrameStore`, and confirm the shipped path lands where
`hybrid_lazyring` did.

## Sequencing

1. `ReadCtx` + the gated lazy ring + tests. Behaviour identical on every host where
   `RWF_NOWAIT` is refused, and identical warm everywhere.
2. Run `check-fastpath` on the deployment host — it decides which of the three rows above you
   are on, and therefore whether this change is worth anything at all.
3. Adopt only if the layout leaves reads missing ([`ACCESS-PATTERNS.md`](ACCESS-PATTERNS.md)).
   On a warm-dominated workload the ring is never built and the change is inert by design —
   which is the argument for landing it early rather than late.
