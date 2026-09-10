# Why these changes exist

**The question this answers:** *someone opens the diff, sees a transport knob and a
rewritten default, and asks what problem any of it solved.*

One entry per **decision**, not per commit. This file, not the code, is where "why"
belongs. A comment earns its place only when a competent reader would otherwise do the
wrong thing.

The full register — including campaign-instrument entries (guards, analysers, sampler,
comment-placement) — is on tag `archive/transport-lab-2026-09`:

```bash
git show archive/transport-lab-2026-09:docs/transport/why-these-changes.md
```

Format: **what was true before → what forced the change → what else we could have done →
what would show it was wrong.**

---

## The measurements

### 1 · Two congestion controllers, because there are two kinds of loss

**Before.** The project flipped its controller recommendation three times. Each flip was a
campaign that had sat, by accident, in one loss regime and read the result as general.

**Forced by.** Building both regimes deliberately and running them side by side, each
verified by queue-drop counters rather than assumed. Congestive → Cubic; radio → BBR; the
margins are 44–63 % and they point in opposite directions.

**Alternative.** Pick one and move on. Rejected: whichever you pick is ~50 % wrong on half
your users, and nothing in the transport tells you which half.

**Falsified by.** Real client telemetry showing the regime mix is overwhelmingly one-sided,
which would make the second answer academic.

### 2 · One shared stream, against the textbook

**Before.** The classic argument says per-frame streams confine loss damage to one frame.
The project pre-registered that as hypothesis H4 and expected it to win.

**Forced by.** It lost, and not narrowly — 3.5× at 64 KB in simulation, 8.5× at 250 KB, and
**5.76× on real hardware at 250 KB**, separated 3/3. The mechanism was read out of quinn's
source *before* the campaign: `retransmit()` re-queues with `push_pending`, behind every
already-queued stream, regardless of fairness. Per-frame therefore defers recovery behind
other frames' backlogs. The classic argument is right about the receiver and silent about
the sender.

**Alternative.** A fixed-N pool between the two. Still untested, and R6 makes it less
promising: the deferral cost grows with N and the winning endpoint is N = 1.

**Falsified by.** Any cell where per-frame + FIFO separates in its own favour. None found on
either rig. (Individual repeats do favour per-frame — 8 of 12 on the real path at 64 KB —
but no cell separates, which is a different and weaker statement.)

### 3 · The rig had to be rebuilt before any of §2 counted

**Before.** Four campaigns compared stream shapes on a rig where the reader blocked on each
frame, so the transport could never fall behind and head-of-line blocking was structurally
impossible. Stranded bytes: **0.00 MB**.

**Forced by.** Review 4 noticing that the condition under test could not occur. The
open-loop reader strands 18.31 MB in the same cell. `window-harness --reader-mode open`
is that reader; `closed` is still the harness default, and no stream-shape result from it
is admissible.

**Alternative.** Trust the earlier numbers. Rejected: they measured a rig property.

**Falsified by.** A cell where the open-loop reader strands nothing — which is now a gate
that voids the row rather than a thing to notice afterwards.

### 4 · Flow-control windows are hygiene, not a lever

**Before.** "Bound the windows for memory at thousands of viewers" was carried on
arithmetic: quinn's `send_window` defaults to 10 MB, and 10 MB × 5 000 is 50 GB.

**Forced by.** Measuring the case it was reserved for. `window-harness --mode stall` asks
for 25 MB and stops reading; the server holds **180 kB** — 11 % more than one that merely
reads slowly, and 50× below the ceiling. The withheld bytes queue on the *client*, which
holds 2.20 MB, because a stalled peer's stack still ACKs and the server frees what is
acknowledged.

**Alternative.** Leave it unmeasured and bound the windows anyway. Cheap, but it would have
left the project believing a 50 GB risk it does not have — and would have hidden the
finding below.

**Falsified by.** A client that widens its own receive window on a high-BDP path, where the
in-flight window rather than the peer's credit bounds the server. Unmeasured; on this rig
such a client is killed by its own quinn first.

### 5 · The send path is a memory property, not only a CPU one

**Before.** `chunked` was adopted for −6…−14 % CPU per byte.

**Forced by.** The stalled-client campaign, which found the same client costs **198 kB on
chunked and 6 990 kB on copy + per-frame** — 68 % of the ceiling. The arithmetic worry in
§4 was well founded *for the send path the project used to ship*; the chunked default is
what removed it.

**Alternative.** Report the CPU number alone. That would leave `main` — which has the copy
path only — exposed in a way nobody had written down.

**Falsified by.** A measurement where `RssAnon` and total RSS disagree, which would mean the
chunked figure is a file-backed blind spot rather than a real saving. Checked: they agree
to within 1.2 % in every arm.

---

## The product

### 6 · A default may not outrun its evidence

`transport-conclusions.md` §2 records that the binary shipped `per-frame` while the answer
sheet recommended `shared`. Rather than asking someone to adjudicate it, a rule was fixed:
X3L decides. X3L ran and separated (5.76× at 250 KB on the real path, stranding gate
passing), so the default flipped to `shared`. `per-frame` stays a product flag.

The general form: **when a decision is contested, write the measurement that would settle
it and commit to the outcome in advance.**

### 7 · A measurement rig and a shipped server want different things

**Before.** Thirteen transport flags and three send paths reached a product build, because
every variable a campaign swept had been given a knob.

**Forced by.** Reading the diff as a product change rather than as a campaign. A campaign
needs a knob per swept variable; a server needs one only where a decision is genuinely
open. The flags that pass that test are on the product CLI: `--stream-mode`,
`--send-window` / `--send-window-bytes`, `--receive-window`, `--stream-receive-window-bytes`,
`--congestion`, `--bind`, `--prefault`, plus the windows / idle timeout already on `main`.

**2026-09-09.** The campaigns closed. Rejected arms were deleted from `server/`, not copied
into `lab/` and not left behind `--features lab`. Reproduction of `copy` / `split` /
`--ask-priority` is git history (and the archive tag), not a feature flag.

**Falsified by.** A campaign that cannot be reproduced from the tag. Restore:

```bash
git checkout archive/transport-lab-2026-09 -- docs/transport lab/transport
```

(Checking out `docs/transport` from the tag overwrites these lean face files.)

### 8 · First write is the head and the first window

**Before.** Each frame was `write_all(8-byte head)` then `write_all` of each `READ_WINDOW`.
The product runtime is multi-thread tokio. `write` wakes quinn's driver; on another worker
that can transmit before the body reaches the send buffer, so the first packet of a frame
can be eight bytes and no HTJ2K.

**Forced by.** That is the first-stream-byte path this hunt owns. P3 (two 4-byte writes →
one 8-byte write) already landed; it does not put payload in the first write.
`write_all_chunks` of owned windows was measured worse at 16–32 sessions and is not
reopened ([`disk-access/IMPLEMENTATION.md`](../disk-access/IMPLEMENTATION.md)).

**Alternative.** Leave the two writes. Rejected: the 8-byte packet is not throughput
theatre, it is a first packet the client cannot decode. Combining head + first window is
one extra copy of at most 64 KiB per frame, then the usual copy into quinn.

**Falsified by.** A localhost A/B where ask→complete does not move on a multi-window
frame, or a 16-session cell where the extra copy shows up in `send_us`. This host:
32 KB tie; 250 KB −4.0 % p50, 8/8. First payload byte, and any real path, **not
measured**. [`transport-conclusions.md`](transport-conclusions.md) §3a.

---

## Campaign instruments (on the tag)

Guards that refuse the wrong fixture, analysers that print `n` and do not average VOID
rows, the loss-regime sampler's one-write-per-row fix, and the comment-placement pass are
not product decisions. They live in the tag copy of this file as entries 6–13 and 16–17.
