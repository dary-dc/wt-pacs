# Cloud lanes — 2026-09-14

Seven **open questions** that need no access to the workstation they were scoped on. Each is a lane
off this branch: one branch, one question, one report. The prompts below are meant to be handed to
an agent as they stand.

**This document is questions, not delivery.** This repository is a laboratory for an application
that consumes what it proves. Turning a proven result into a change in that application is a
separate plan with a separate audience, and it lives in the private tree — not here, and not on any
lane. Nothing below ships anything.

**Two kinds of lane, and the difference decides priority.** Some answer questions about things the
consuming application will inherit — anything above the transport is transport-independent and
transfers. Others answer questions about *this* repository's own transport and server, which that
application does not use. Both are worth doing; only the first is on anyone's critical path.

| lane | what it answers about | inherited by the consumer? |
| --- | --- | --- |
| **L1** decoder heaps and threads | decoding, which sits above the transport | **yes** — and it gates a sizing decision in the other plan |
| **L3** a lossy, rate-limited link | the target regime; its levers are this transport's | findings yes, levers no |
| **L4** a closed session unnoticed | this client's session handling | the *requirement* yes, the fix no |
| **L6** keep-alive and idle survival | this server's idle behaviour | the *numbers* yes, the implementation no |
| **L2** the BYOB frame-0 cost | this transport's read path | no |
| **L5** the telemetry tail at SIGTERM | this server | no |
| **L7** a regime where the read path misses | this server | no |

L1 first. L4 and L6 next, for what their answers imply rather than their code. The rest when there
is capacity — they are this repository's own correctness and performance work, which is real work
and is not urgent.

This branch carries what the lanes share: the release profile, the read-path fill window, the
headless-Chromium runner (`lab/scripts/chrome_harness.cjs`), a worker-safe client clock, the BYOB
read path behind its features, and `lab/decode-bench/` with its fixture generator.

## Rules every lane inherits

**This repository is public, and you cannot check it yourself.** A term scanner and a commit-msg
hook guard it, but both live under `.local/`, which is git-ignored, and hooks are never cloned — so
a fresh checkout has neither. Scanning happens on the workstation before anything merges, which
means a leak in your branch is caught late and costs a rewrite of history.

So treat it as a rule you keep rather than a check you run: **never name the other implementation
or any part of its stack, and never describe its internals**, in code, comments, docs, fixture
names, file names, branch names, commit messages or the PR body. Write "the reference
implementation" where a comparison is unavoidable — and in most lanes it is avoidable entirely, so
prefer saying nothing. If a measurement only makes sense as a comparison, report the number and
leave the comparison out; it will be made on the workstation.

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

# Added 2026-09-14, after L1 reported

L1 closed the threading question, corrected the 50 MB to a link-time constant, and left a **working
emscripten → OpenJPH → WASM build** parameterised by `INITIAL_MB` that already emits shared-heap and
non-shared variants (`lab/decode-bench/wasm/`). These three follow from that.

## L8 — a right-sized, bit-exact decoder build

**Container.** Finishing what L1 started; the toolchain, source, fixtures and ground truth all exist.
**If L1's agent is still alive, continue it rather than starting fresh** — otherwise you repeat an
emscripten install and an OpenJPH build for nothing.

```
L1 proved the shipped decoder's 50 MB heap is a link-time declaration (initial = 800
pages), not growth, and that the same decoder rebuilt needs 3.6 MB to serve a 50 KB frame
and 24.6 MB to serve an 8 MB one. That makes the heap a build flag rather than a
constraint on how many decoders we can run. Turn that into something shippable.

Deliverable: a decoder WASM that can replace the prebuilt npm one.
  1. API parity. The current consumer calls HTJ2KDecoder with getEncodedBuffer,
     readHeader, decode, getDecodedBuffer and getFrameInfo. decode_probe.cpp is "the
     smallest thing that decodes" and does not match. Close that gap.
  2. Bit-exact against the npm build on every fixture size, verified against the .sha256
     ground truth the generator writes. Not "looks right" — byte-identical.
  3. SIMD on. The npm build reports SIMD level 1; a build without it would be a silent
     regression.
  4. Right-sized initial heap. Report heap and decode time against INITIAL_MB so the
     choice is a curve, not a guess, and say what you would ship for a 512x512 profile
     and for a 2048x2048 one.
  5. A shared-heap variant, built from the same source, equally bit-exact.

Then say plainly what it costs to adopt: we would stop consuming a prebuilt package and
start owning a build. Name what that adds — toolchain, CI, reproducibility, binary size —
so the trade is visible. If you conclude the prebuilt one should stay, say that; a
measured "not worth it" is a result.
```

## L9 — the transport conformance suite

**Container.** No rig, no browser, no timing. **Highest value of the three: it gates every later
client milestone.** See `docs/client-shape-plan.md` §0.

```
This repository defines a transport surface and has two independent implementations of
it: client/transport-ts/session.ts and client/transport-wasm/src/session.rs. Two
implementations behind one surface is what makes it a seam. A third implementation is
expected, and everything built above the seam depends on all of them behaving the same.

Three clauses the surface requires but does not state. Each has already cost real time.
Write a conformance suite that runs against BOTH implementations and fails loudly:

  1. Worker-safe. No implementation may reach for `window`. The WASM client did, through
     perf_now_ms, and every timestamp it produced inside a worker read 0 — not an error,
     zeros. It is fixed; the test is what stops the next implementation repeating it.
     A silent-zeros failure must fail the suite, so assert on values, not on absence of
     exceptions.
  2. Cancellable. A running fill can be stopped without ending the session. endStream()
     is in the surface and the server honours it mid-fill under test
     (server/src/transport/server.rs). Prove the client half.
  3. Transferable results. A FrameResult's buffer must cross a worker boundary as a move,
     not a copy. Assert the source is detached afterwards.

Mutate each test: break the implementation on purpose, watch that test fail, say so.

Where the suite lives and how it runs is yours to propose — it must be runnable from
scripts/gate.sh without a browser if that is achievable, and you should say so if it is
not. Adding a gate step is structural: propose before implementing (CLAUDE.md).
```

## L10 — what telemetry costs

**Container for the shape, VM for any millisecond.** Settles an unmeasured assumption.

```
client/record/ is this repository's telemetry: ~1830 lines of TypeScript behind an
external seam, installed by patching a session rather than built into the client. It is
believed to be cheaper than the alternative it may replace. Nobody has measured that, and
the belief is being used to justify a replacement.

Measure what it costs when installed: per frame and per run, against the same client with
the seam not installed. Interleave the arms. Report median with range and rounds-better.

Then answer the question that actually matters: does the cost scale with frames, with
bytes, or with neither? A telemetry layer that is free at 87 frames and expensive at 2000
is a different decision from one that is flat.

If the overhead is below what this rig can resolve, say so and give the resolution floor.
"Too small to measure here" is a result; "probably cheap" is not.
```

---

## Not delegable

These need the workstation, or material that cannot leave it: the end-to-end comparison runs and
their re-baselining, the mixed cache-and-fill cell, anything answered from the reference
implementation's source, and the client productisation work, whose destination is a different
repository. They stay where they are.
