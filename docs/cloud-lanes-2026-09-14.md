# Cloud lanes — 2026-09-14

Seven investigations that need no access to the workstation they were scoped on. Each is a lane
off this branch: one branch, one question, one report. The prompts below are meant to be handed
to an agent as they stand.

This branch carries what the lanes share: the release profile, the read-path fill window, the
headless-Chromium runner (`lab/scripts/chrome_harness.cjs`), a worker-safe client clock, the BYOB
read path behind its features, and `lab/decode-bench/` with its fixture generator.

## Rules every lane inherits

**This repository is public and scanned.** `.local/hooks/scan.py` rejects a set of terms by the
SHA-256 of every 4–10 character substring of every token, so concatenations are caught too. It
covers branch names, commit messages, PR descriptions and agent prompts, not only source. Run
`python3 .local/hooks/scan.py <file>` on everything you change. Where a comparison is unavoidable,
write "the reference implementation" — never name it, never describe its internals.

**Measurement.** Each of these has already produced a wrong answer on this project:

* **Interleave the arms.** Sequential before/after measured +8.1 % on code that was a tie. Rotate
  arm order every round.
* **Mutate every new test** — break the code on purpose and watch the test fail. Say so in the report.
* **Quote latency or throughput, not both** — one is the other divided by depth.
* **Say where the host saturates and claim nothing past it.**
* Report **median with range and rounds-better out of n**, never a bare median. A clean sweep with
  non-overlapping ranges is a result; 4/6 or 5/8 is not, and should be reported as unresolved
  rather than dressed up.

**A container is not a timing rig.** Memory, heap high-water and correctness are safe in an agent
container. Anything quoted in milliseconds runs on the cloud VM (`docs/cloud-rig-access.md`,
`lab/scripts/*_cloud.sh`) or is marked as container-measured and not used for a decision. Each lane
below says which it is.

**Scope.** `CLAUDE.md` governs: essentialist code, comments only where a reader needs one at that
line, `scripts/comment_budget.sh` enforced by `scripts/gate.sh`. A structural change is proposed
before it is implemented. Run `scripts/gate.sh` before pushing. Commit only what the lane asks for.

---

## L1 — decoder heaps and threads

**Container.** Memory is the claim. Needs `lab/decode-bench/` (on this branch) and fixtures built
by its generator. Nothing else.

```
Measure what decoding costs in memory, not milliseconds.

Each decoder instance is a separate WASM module with its own linear memory, and WASM
memory only ever grows — emscripten's allocator never returns pages — so an instance
holds its high-water mark for as long as it lives. The target device is a phone, where
that is the binding resource. Nobody has quantified it beyond a single reading at one
frame size, and the obvious alternative has never been built.

Phase 1, no emscripten needed:
  1. `lab/decode-bench/fetch_decoder.sh` pulls the decoder from npm. It has never been
     run — validate it first and fix it if it is wrong.
  2. `lab/scripts/gen_htj2k_fixtures.sh` builds OpenJPH from source for its encoder and
     generates synthetic frames at four sizes (c512 g512 g1024 g2048). Also never run.
     Validate, then generate.
  3. `lab/decode-bench/decode_bench.mjs` runs 1..4 decoder instances over a fixture set
     and reports total heap, per-instance heap, and serial ms/frame. Also never run.
  4. Report heap against instance count and against frame size. That is the deliverable.

Phase 2, the actual question:
  Build OpenJPH (same release as the decoder) to WASM twice with emscripten — once plain,
  once with -pthread and shared memory. Compare N single-threaded instances against one
  multithreaded instance at N threads, at equal decode width. Heap first, time second.
  Say plainly if the threaded build is not worth the toolchain cost.

Also in scope, same bench and fixtures: the cost of copying a decoded frame out of the
WASM heap, against frame size from 50 KB to 8 MB. Only one size has ever been measured,
and at that size the copy and the cost of making the heap shared cancelled exactly. Find
out whether that holds as frames grow, since it is the whole argument for or against
shared-memory decode.

Do not quote the numbers in docs/decode/README.md as this project's own — they were taken
elsewhere on a different fixture and are marked as pending reproduction. Replace them
with yours, or say they did not reproduce.
```

## L2 — the first frame on the BYOB read path

**VM.** A timing claim. Needs `chrome_harness.cjs` and a WASM build per arm.

```
Diagnose a reproducible ~12 ms cost on the first frame of a session, on the BYOB read
path in client/transport-wasm (features byob / byob-min / byob-count, off by default).

What is known. The path removes both compressed-frame copies and is a tie on everything
else: the fill ties on a 49 KB/frame and a 250 KB/frame study, and on demand serve p50
ties. But the worst frame of an on-demand run is frame 0 in every run measured, and it
costs about 12 ms more than the default path — reproduced in two independent campaigns,
worse in 8 of 8 rounds in the second, with ranges that do not overlap. It is the only
thing keeping this path from being adopted, and adopting it would delete about 140 lines
of frame-reassembly machinery against 93 added.

Two hypotheses, neither tested: acquiring a BYOB reader on a fresh stream costs something
the default reader does not, and the first per-frame ArrayBuffer allocation hits a cold
allocator. Instrument them separately — the byob-count feature is the model for adding a
cheap counter behind a feature — and settle which, or find the third thing.

If the cause turns out to be one-time setup that can happen before the first ask, say so
and prototype it: that would clear the path for adoption. If it is per-frame allocation
that only shows on frame 0 because the allocator is cold, say that too — it would be
worse on a phone, not better, and that closes the path.

Run on the VM, not in your container. Interleave the arms. n >= 8.
```

## L3 — a lossy, rate-limited link

**VM only.** `sch_netem` loads on the VM and not in a container — that is why the VM exists.

```
Everything this project has measured is on loopback, which is receiver-bound and is not
the target. The target is a phone on a wireless, lossy link, where the link and its loss
set the pace rather than the receiver. Nothing about the transport can be priced for that
target until it is measured on a shaped link.

Use docs/cloud-rig-access.md and lab/scripts/cloud_netem.sh. A starting shape, to be
validated rather than trusted: 20 ms +/- 5 ms delay, 1 % loss, 50 Mbit, applied to
server -> client traffic only. lab/scripts/e0_netem_validation.sh exists to check the
shaping is real before anything is measured through it — run it first.

What to answer, in order:
  1. Does the fill still behave as it does on loopback, or does the ranking of the send
     levers change? A 768 KB send window removed all datagram loss on loopback and did
     not move the fill by a millisecond, so it was not taken. On a lossy link that
     trade may go the other way. Re-price it.
  2. Where does the host saturate on the VM, and what can therefore not be claimed?
  3. Per-frame latency under loss, not just the fill.

Report at several loss rates, not one. Say which findings are specific to the shape you
chose.
```

## L4 — a closed session should be noticed at once

**Container** for the fix, **VM** to confirm timing. No prerequisites.

```
In client/transport-wasm, a request against a session the server has already closed waits
the full FRAME_TIMEOUT_MS (15 s) before failing. The client never notices the close.

This has been a benchmark annoyance, worked around by raising an idle timeout. It stops
being an annoyance in the product: the session is to be opened when the user picks a
series, which may be minutes before the first frame is asked for, so a session that died
in between is the normal path and not a corner case.

Make the client notice — the WebTransport session exposes closure, and the waiters should
be woken with an error rather than left to time out. Add a test that fails without the
fix. Report how long detection takes, and confirm the 15 s timeout still applies to the
case it is actually for (a frame that never arrives on a live session).

Structural: propose the shape before implementing it (CLAUDE.md).
```

## L5 — the telemetry tail is lost at SIGTERM

**Container.** A correctness fix. No prerequisites.

```
server/src/record/sink.rs drops its buffered tail when a session is still open at SIGTERM,
so the last rows of a run are missing from the server's own telemetry. Comparison runs no
longer record server telemetry, so this now bites only the native benchmark drivers and
the path sampler — but it silently produces short reports, which is worse than failing.

Fix it so a shutdown flushes what is buffered, with a test that fails without the fix.
Keep the shutdown bounded: a flush that can hang is not an improvement.

Structural: propose the shape first (CLAUDE.md).
```

## L6 — holding a session open while the user reads

**Container** for the mechanism, **VM** to confirm. No prerequisites.

```
The product will open its transport session when the user picks a series and use it when
they open the viewer, which may be minutes later. Nothing currently keeps such a session
alive: quinn's keep_alive_interval is off by default and the server's idle timeout is
short, so the session dies in the gap and the client does not notice (L4).

Treat the keep-alive interval and the server idle timeout as one budget and pick both.
Measure what an idle held session costs — packets, server memory, server CPU per idle
session — and at what number of concurrent idle sessions that stops being free, since a
viewer may hold one per open study.

Report the cost per idle session and the recommended pair, with the reasoning. This is a
product default, so it wants an ADR, not just a number.
```

## L7 — a regime where the read path matters

**VM.** Needs storage control and a study past RAM.

```
The workstation this was scoped on never makes the reader miss: a fully evicted 61 MB
study reads with zero fill misses, so the read path's design has never been measured
under the condition it exists for. A larger study alone may not do it.

Find a regime where it does, on the VM: a smaller read_ahead_kb, a study past RAM,
slower or throttled storage, several sessions at once. Then measure the read path against
that regime — lab/disk-access-bench and lab/scripts/read_path_ab.sh are the drivers, and
docs/disk-access/ owns the conclusions.

Note this branch carries the fill-window fix (a fill advises the kernel past the named
frame), so you are measuring current behaviour, not the behaviour docs/disk-access/
describes from before it. Say which rows that changes.

Server side, browser-free, native drivers. Page-cache eviction is not a test lever — force
the miss through the store's own test levers.
```

---

## Not delegable

These need the workstation, or material that cannot leave it: the end-to-end comparison runs and
their re-baselining, the mixed cache-and-fill cell, anything answered from the reference
implementation's source, and the client productisation work, whose destination is a different
repository. They stay where they are.
