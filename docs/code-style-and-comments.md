# Code style — what the code says, and what this repo says instead

**Audience:** the code in this repository is read by junior and senior engineers *and* by a
product owner checking whether a claim is supported. That is an unusual range, and it sets
the target: **a reader should be able to follow what the code does without knowing why the
project arrived at it, and find the why in one place when they want it.**

Today the repository does the opposite in places — the why is inlined, at length, in the
files. This document says where each belongs and how to tell them apart.

---

## The measurement that prompted this

Comment lines against code lines, non-blank:

| file | comment | code | ratio |
| --- | ---: | ---: | ---: |
| `lab/scripts/stall_client_campaign.sh` | 51 | 69 | **0.74×** |
| `server/src/record/path.rs` | 105 | 153 | **0.69×** |
| `lab/scripts/r6_cell_inputs.sh` | 44 | 72 | **0.61×** |
| `lab/window-harness/src/stall.rs` | 106 | 187 | **0.57×** |
| `server/src/transport/tuning.rs` | 36 | 132 | 0.27× |
| `server/src/transport/server.rs` | 99 | 492 | **0.20×** |
| `lab/window-harness/src/client.rs` | 139 | 816 | **0.17×** |

The last two are the pre-existing product code and they set the house norm at **~0.2×**. The
top four were written during this branch's recent work and run **three times** that. The
Python analysers look better only because the counter above misses module docstrings, which
is where their prose actually lives.

**This is not an argument that the top four are badly commented.** Much of what is in them is
genuinely load-bearing. It is an argument that the *rationale* in them — how the project came
to need the thing — belongs in
[`why-these-changes.md`](why-these-changes.md), and that once it moves, the files land near
the house norm without losing anything a reader needs at the call site.

---

## The rule

**Code says what and how. [`why-these-changes.md`](why-these-changes.md) says why.**

A comment earns its place only if a competent reader would otherwise **do the wrong thing**.
Three tests, all of which must pass:

1. **Would removing it cause a plausible wrong edit?** The note in `stall.rs` that dropping a
   `RecvStream` sends `STOP_SENDING` and lets the server discard its buffer passes: without
   it, tidying the parked-streams `Vec` away looks like an improvement and silently destroys
   the measurement.
2. **Is it about *this code*, not about the project's history?** "Two writes interleave under
   `O_APPEND`" is about the code. "An adversarial review found this on 2026-09-07 and measured
   29 % survival at 32 connections" is history — true, valuable, and belongs in the register.
3. **Is it still true?** A comment nothing checks decays. Where a comment states a
   precondition, prefer a check: `r6_cell_inputs.sh` exists because
   `# Requires FIXTURE=frames_500x250k` was not enforcement.

### Applied to what is there now

| keep | move to the register |
| --- | --- |
| `STOP_SENDING` on drop; why streams are parked | how the stalled client came to be written |
| `writeln!` issues two writes; a short write is counted, not looped | the 29 %-survival measurement and who found it |
| `RssAnon` excludes file-backed pages, so the mmap does not inflate it | the 80× error that reporting RSS/N would have produced |
| `--congestive` inverts stop condition 4, and why the literal rule is wrong here | the three analyser defects that made a missing repeat invisible |
| the fixture/trace a cell is *defined* by | the campaign that ran against the wrong fixture |

---

## Naming — already the strongest thing here

The domain vocabulary is consistent and it is why a non-engineer can follow a test name:
`ask`, `frame`, `stranded`, `cell`, `arm`, `void`, `admissible`, `censored`. Keep it.

Two rules that follow from having good names:

- **Do not restate a name in a comment.** `// the number of frames stranded` above
  `stranded_frames` is noise.
- **When a name needs a comment, the name is wrong.** `nz_p95` needed one everywhere it
  appeared, which is a signal — `miss_only_p95` would not have.

---

## Shape

- **One altitude per function.** `send_one_frame` currently mixes policy (which send path),
  bookkeeping (timing, ack tasks) and I/O (writing). Clippy flags it at 8 arguments; the
  merge with `main` re-expresses it as `Pipeline::send`. Three signals pointing at one place.
- **Structure over flags where the structure is real.** Three send paths *are* three
  implementations of one operation.
- **Guards return early and say what to do.** The refusal messages in `r6_cell_inputs.sh`
  name the fix (`Re-run with FIXTURE=…`). A refusal that only says "invalid" makes the
  operator read the source.
- **Nothing dead.** `parse_length_prefixed` is unused.

---

## What "essentialist" means for a measurement repo specifically

There is a real tension here, and it should be named rather than resolved by slogan. This
repository's credibility rests on recording things that a normal codebase would delete:
void rows, falsified predictions, the reason a threshold is what it is. **Essentialism must
not become deletion of inconvenient evidence** — that is the failure this project has
already committed once.

The resolution is *placement*, not volume. The evidence stays; it moves to where it is read
as evidence rather than skimmed as preamble:

- **Numbers and their provenance** → `docs/measurements/`
- **Why a decision went the way it did** → `why-these-changes.md`
- **What would overturn it** → `transport-conclusions.md` §5
- **What a reader must not break** → the code, briefly

---

## Exit criteria — applied 2026-09-08

No longer a proposal. Where each landed:

1. **Clippy: 21 → 3.** The three left are in `client/flight-registry`,
   `client/transport-wasm` and `server/src/transport/wire.rs` — files this branch never
   touched, and `main` has already rewritten the third. Fixing them would manufacture a
   merge conflict to silence a style lint.
2. **Done, and past the norm.** The four files land at 0.14–0.25× against a house norm of
   ~0.2×; `client.rs` reaches 0.07×. Rationale moved to
   [`why-these-changes.md`](why-these-changes.md) and to the measurement documents, not cut.
3. **`send_one_frame` lost three arguments** to a `Serving` struct — the shape `main`'s
   `Pipeline` carries, so the port inherits it. The full one-altitude split still waits for
   the merge, for the reason below.
4. **Every in-body comment is now one or two lines.** 157 multi-line blocks → 39, and all 39
   are file headers: what it does, where the reasoning lives, how to run it. That is the one
   place a one-line rule does not fit, and it is named rather than quietly excepted.

`parse_length_prefixed` is gone.

**The rest is still merge work.** `main`'s `pipeline.rs` imposes the shape the "one altitude"
rule asks for, so restructuring `send_one_frame` further before the port means doing it
twice. See [`merge-with-main-analysis.md`](merge-with-main-analysis.md).
