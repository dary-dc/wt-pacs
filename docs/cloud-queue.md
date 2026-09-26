# Cloud queue

A place to hand work to a cloud agent between sessions, and for it to hand results back: the order
and the state of the work, and nothing else. What a finished row found lives in the doc that owns its
subject (the index is in `README.md` §Docs); every retired brief and note is in the history before
the commit that folded it.

## Protocol

**The queue lives on `claude/unified-2026-09-23`**, the one branch that carries every lab
improvement. **Work the `ready` rows top to bottom — the table is in priority order, not number
order.** Several agents may work the queue at once; the claim commit is the lock.

**New session?** Read `CLAUDE.md`, then `README.md` §Docs for which doc owns what, and
[`rig-limits.md`](rig-limits.md) §6 for the instrument traps that have already cost time.

**You are the cloud agent.** After you finish a lane and push:

1. `git fetch && git rebase origin/claude/unified-2026-09-23` — the queue changes while you work.
2. Read the table below. Take the **topmost row marked `ready`**.
3. Edit that row to `claimed` with the date, commit it alone, push it. That is the lock; if the
   push is rejected someone took it first, so rebase and take the next one.
4. Do the lane. Push your work.
5. Set the row to `done` with the commit — the hash **after** the rebase that pushed it — and
   **add anything you learned that changes another row**: a lane that is now pointless, a
   prerequisite that turned out missing. Push.
6. Go back to step 1. Stop when no row is `ready`, and say so in your final message rather than
   inventing work.

**Rows that wait.** `after N` becomes `ready` when row N is done; the agent that marks N done
flips it in the same commit.

**What a row may not change** (the owner, 2026-09-18). The work is judged on one comparison, on one
content: the same frames, the same lossless encoding, the same measurement, as the baseline. So
**the final image is bit-exact, always** — nothing lossy, no dropped channel, no alternative source
decode — and **the comparison's content and encode settings are fixed**. A lever may change *when*
bytes arrive or *what is shown first* (a smaller first image, a different order), as long as every
frame ends bit-exact. A row that would change the content, or that moves no figure the comparison
reports, is not queued; if a row drifts that way while you work it, stop and say so in `## Blocked`.

**The downloader lives beside today's path, and the merge is not an adoption**: nothing today's
path does has been removed ([`ARCHITECTURE.md`](ARCHITECTURE.md)). Adoption is the workstation's
call. A code row that finds the design wrong stops and says why in `## Blocked` rather than building
a different shape.

**Answering a question rather than running a lane.** Answer it in the doc that owns the subject,
push, and mark the row done with one line saying where.

**Asking for something.** If a lane is blocked on a decision only the workstation can make, add an
item to `## Blocked` saying what you need, push, and move to the next `ready` row. Do not wait.

**A commit message holds the change and nothing else** — no attribution, co-author or session
trailers. This is the owner's rule for every repository.

**This repository is public.** Never name the other implementation or any part of its stack, and
never describe its internals — in code, comments, docs, file names, branch names or commit messages.
The term scanner that checks it runs on the workstation, not in a container.

## Queue

| # | what | brief | state |
| --- | --- | --- | --- |
| 82 | **DC2** — the docs cleaned to the essential, in one commit | queue §Row 82 | **done** 2026-09-26, `0752e5d`: 103 documents folded into the ones that own their subjects (fold map in the commit body), `ARCHITECTURE.md` and `adr-stream-shape.md` new, every code pointer follows its section. **The term scanner was not run** — it lives on the workstation; run it over `0752e5d` before anything else lands. Judgement calls under `## Blocked`. `lab/window-harness/src/stall.rs` still cites a `mem/stall-client.md` that was never in this tree |
| 5 | **L2** — the BYOB frame-0 cost | queue §Row 5 | **part done on the workstation** 2026-09-15: reader acquisition eliminated; module warm-up untested |
| 43 | **N2** — the impaired link, made to behave like a radio | queue §Rows 43–50 | **half done on the workstation** 2026-09-19, merged 2026-09-20: `--jitter-mode reorder\|ordered` and `--blackout-mode drop\|hold`, each checked against arithmetic and mutated. **Still open: the idle penalty and trace replay** |
| 44 | **H1** — the production handshake: a real chain, compression, the static plane | queue §Rows 43–50 | **first half done on the workstation** 2026-09-19, merged 2026-09-20: an RSA-2048 chain costs exactly one round trip (4.03 → 5.05, 7/7 at three delays), an ECDSA P-256 chain none; brotli compression (feature `cert-compression`, off) brings RSA back to 4.08 and Chrome 148 offers brotli only; the leaf-only-PEM guard is built. **Still open: S40, the static plane** — **claimed** 2026-09-26 |
| 48 | **W4** — the controller verdicts, re-run on a link that does not reorder | queue §Rows 43–50 | **half answered on the workstation** 2026-09-19: on ordered jitter Cubic is 1.01× / 1.03× where it was 8.2× / 23.7×; `--packet-threshold` does *not* explain it (0.52× at ±2 ms, ~0.9× at ±10 ms) — what declares those losses owes a qlog cell. **Still open: the deep-buffer fill (S28 is half wrong — the queue does fill) and the trace arm** |
| 49 | **I1** — the idle ask when the first packet is late | queue §Rows 43–50 | after 43 |
| 50 | **W5** — a blink that holds instead of dropping; slow start restarted after a silence | queue §Rows 43–50 | **mostly answered on the workstation** 2026-09-19: held, a blink costs the outage and nothing else — no congestion event, no loss — and a second blink is no worse; the restart is built. **Still open: the restart against plain Cubic at 0.1–1 % loss with rounds enough to size it** — five rounds gave a four-fold spread |
| 56 | **W1b** — a default for the first ask | queue §Row 56 | **measured on the workstation** 2026-09-20, merged 2026-09-22 — **no default changed, the owner's call.** The push at session open is **463.3 → 137.9 ms (−70 %, 7/7)** at 250 KB / 80 ms and needs three lines on the page; a 32-packet initial window is **−16 to −33 % at queues ≥ 20 packets** and **+11.8 % (0/7) behind a 10-packet queue**; **the two do not stack**; the keep-alive pair keeps a 30 s idle session alive **56/56**. `transport/transport-conclusions.md` §3. **Still open: the push's browser cell, and which lever a rebind re-applies** |
| 59 | **A1b** — the handover, on a device: does a session survive Wi-Fi → cellular, and how long is the freeze | [`ARCHITECTURE.md`](ARCHITECTURE.md) §What this means for the stack choice | **waiting on a device — no container can take this row.** An Android phone with a SIM, the fill running, Wi-Fi switched off mid-fill: what the page sees (any event at all, and when), whether any frame arrives afterwards, and the wall time from the switch to the first error |
| 40 | **E1** — the ingest format | queue §Row 40 | **held** 2026-09-18 by the owner — see "What a row may not change"; do not take it |

**Finished**, one line a batch — what each found is in the doc named:

* **Rows 1–14** (lanes L1–L18, 2026-09-14 to 16): the gate, thread hops, retained memory, idle sessions, an ask overtaking a fill, a faster decoder, the BYOB path — `decode/README.md`, `ARCHITECTURE.md`, `transport/adr-idle-sessions.md`, `WIRE.md` §An ask during a fill.
* **Rows 15–26** (D1–D7, F1, 2026-09-16 to 18): the downloader built beside today's path, its capabilities, the conformance suite's downloader arm, a signed fixture — `ARCHITECTURE.md`, `CLIENTS.md` §The conformance suite, `FIXTURES.md`.
* **Rows 27–29** (L19–L21): a prefix draws a smaller image; a study nobody has read; the UDP-fallback proposal — `decode/README.md`, `disk-access/adr.md`, `ARCHITECTURE.md` §The TCP fallback.
* **Rows 30–41** (Q1–O1, 2026-09-18 to 19): the QUIC bump, the session-open levers, detection and resumption, the impaired link, the first ask, slow-start exit — `transport/transport-conclusions.md`, `ARCHITECTURE.md`, `rig-limits.md` §3.
* **Rows 42, 45–47, 51–55, 57–58** (2026-09-19 to 22): after a blink, WebKit's dial, streaming instantiation, the paint floor, careful resume (not recommended), the wrapper pass, a second decoder, the warm-up's shape, an undecodable frame, a frame's wire bytes — `transport/transport-conclusions.md` §3, `ARCHITECTURE.md`, `decode/README.md`.
* **Rows 60–64** (2026-09-23 to 24): a closed client's worker, the probe after the open, resumption, lever 2 for upstream — `ARCHITECTURE.md`, `transport/upstream-*.md`.
* **Rows 65–72** (2026-09-24): early messages, detection by the bytes, the controller on a lossy link, the decode tail, hops during a fill, the send-size cap's tail, lever 2 against other clients, the page's first frame — `ARCHITECTURE.md`, `transport/transport-conclusions.md` §1 and §5, `decode/README.md`.
* **Rows 73–76** (2026-09-25): the warm-up, the decode tail and resources under a throttled CPU, the hand-off to the page — `decode/README.md`, `ARCHITECTURE.md` §Resources and §The hand-off.
* **Row 77** (TC1): the TCP fallback, built, off by default — `WIRE.md` §The WebSocket mapping, `CLIENTS.md` §The race, `ARCHITECTURE.md` §What was built.
* **Rows 78–81** (2026-09-25): stream shape under loss in a browser (no); the range in the pack (a third off a colour fill at 4–6×); a bounded BBR (keeps BBR's fill, none of its queue); quinn's withheld ACK, reproduced and fixed as an opt-in patch — `adr-stream-shape.md` §HOL1, `decode/README.md` §The range in the pack, `transport/transport-conclusions.md` §1, `transport/upstream-quinn-ack.md`.

### Row 82

Queued 2026-09-25 by the workstation; the owner approved it ("proceed with the docs"). `TODO.md` is the task; this row is
its keep list. **One cleaning commit; history stays.** Take it last, when no other row is claimed (it touches every doc).

**82 · DC2 — the docs cleaned to the essential.** Keep, and make each the single owner of its subject:
`README.md` (+ a short index of what follows), `CLAUDE.md`, `TODO.md`, `WIRE.md`, `CLIENTS.md`, `FIXTURES.md`, the ADRs
(`adr-*.md`, `disk-access/adr.md`), **one architecture doc** made from `proposal-downloader.md` with
`proposal-session-open.md` and `proposal-session-survival.md` folded in, `transport/transport-conclusions.md` with
`transport/why-these-changes.md` folded in, `decode/README.md` trimmed to what holds, `rig-limits.md`, and `cloud-queue.md`
slimmed to its Protocol, the live rows and a one-line pointer per finished batch. Fold every still-true, still-needed
claim from the rest into the doc that owns its subject (a retracted claim stays corrected in place there), then delete.
Fix every link; the private-term scanner over the result; `scripts/gate.sh` green. The commit body carries the fold map.
If a file's survival is a judgement call, keep it and list it under `## Blocked` for the owner rather than guessing.

### Row 5

**5 · L2 — the first frame on the BYOB read path.** A timing claim; the workstation's, with a WASM build
per arm. A reproducible ~12 ms cost on the first frame of a session on the BYOB read path in
`client/transport-wasm` (features `byob` / `byob-min` / `byob-count`, off by default). The path removes
both compressed-frame copies and ties on everything else, but the worst frame of an on-demand run is
frame 0 in every run measured, ~12 ms more than the default path, worse in 8 of 8 rounds with ranges
that do not overlap. It is the only thing keeping the path from adoption (−140 lines of frame
reassembly against +93). Reader acquisition is eliminated (2026-09-15); **the cold allocator / module
warm-up is untested** — instrument it as `byob-count` does. One-time setup that can move before the
first ask clears the path; per-frame allocation that only shows cold closes it (worse on a phone).
Interleave the arms, n ≥ 8. `decode/README.md` §The BYOB read path.

### Rows 43–50

"What a row may not change" binds these rows. The S-numbers are findings of the second
identification sweep (`git show 823d52d:docs/cloud-queue.md`), none measured when
queued. A finding is a claim until your cell reproduces it; where it does not, say so in the owning doc.

**43 · N2.** `link_impair.py` is what every container verdict stands on, and four things it does
are not what a radio does. Done: jitter that does not reorder, and a blackout that holds and bursts.
Still to add, each read back against arithmetic and mutated: an **idle penalty** — the first packet
after *N* ms without traffic waits *X* ms, each direction (S34); and **replay of a delivery-opportunity
trace**, one millisecond timestamp per MTU-sized opportunity, with a Poisson option (S29).
`rig-limits.md` §3 says what the relay can and cannot stand in for.

**44 · H1.** Done: the certificate chains, compression, the leaf-only guard. Still open: the static
plane in `lab/page-open`'s HOST mode — a second hostname behind a delayed stub resolver, and an HTTP/3
arm with an HTTPS DNS record against today's (S40).

**48 · W4.** After 43. W2's controller cells on jitter that does not reorder are done. Still open: the
slow-start-exit cells with a fill at least ten times the buffer, so the deep queue actually forms
(S28), and BBR against Cubic on a replayed trace instead of iid loss (S27, S29). Correct
`transport/transport-conclusions.md` §1 and §3 in place.

**49 · I1.** After 43. With the idle penalty at 200 / 400 / 1 000 / 1 900 ms after 5 and 10 s idle:
what one ask on a warmed session costs, what the client's and the server's probe timers do with a
first packet that late, and what the inflated round-trip sample does to the *next* ask. A keep-alive
arm at 3 / 5 / 10 s against none, and a one-packet poke sent 100–300 ms before the ask (S35, S36).
This shows the stack's half only; the sizes and the battery are a device's.

**50 · W5.** The restart (`--congestion cubic-restart`) against plain Cubic at 0.1–1 % background
loss, with rounds enough to size it — five gave a four-fold spread. Default unchanged.

### Row 56

**56 · the first ask.** A decision, not a measurement. **It ends undecided on purpose**: the push wants
a page change and loses datagrams behind a shallow queue, the window is free but loses one cell, and
which matters depends on whether the session opens with a fill or an ask. The confirming run on the
shaped link waits on that choice.

### Row 40

**40 · E1.** Held by the owner. On a sweep over TLM markers with per-resolution tile-parts, and
code-block geometry: bytes, both decoders byte-exact, decode time, and TLM lengths equal to a prefix's
level boundaries — mutation-checked. Then the tooling for a lossy-source transcode question, ready for
when a census of source formats exists.

## When the queue runs dry: an identification sweep

A procedure, not a finding; it **identifies** levers and does not measure, build or fix. Run it when
the queue is empty, the target changes, or a constraint is lifted (re-run only the areas that
constraint had closed).

1. **Split the clock from raw runs** per goal (a fill's time to all frames; one frame asked on an idle
   session). A stage that is 5 % of the clock cannot be the answer.
2. **List what the rig's regime hides**: loopback hides every round trip, loss, slow start, buffer depth
   and outages; a desktop hides compile time, cores and memory; a warm profile hides first visits; one
   browser hides the others. Each hidden dimension is a search area.
3. **Inventory what is documented** per area — the verdicts and the regimes they were reached in. A
   verdict from a regime that does not apply to the target is a lead, not an exclusion.
4. **One read-only investigator per area**, in parallel, each opening from a code fact already verified
   (file:line), reading library source rather than docs, with arithmetic for the size on the target, a
   novelty check against the docs, and a "looked at and dropped" list; at most five candidates, each
   with mechanism, evidence, size, cost elsewhere, and the measurement that decides it and who can run it.
5. **Reconcile** conflicting reports by asking which cell the older result actually measured.
6. **Screen against the goal before ranking**: a candidate stays only if it moves a figure the
   comparison reports, on its content, bit-exact (§What a row may not change).
7. **Rank by effect on the target**, keep the dropped lists, record corrections owed to existing docs,
   and queue rows with the split between container, shaped-link VM, workstation and device.

Launch fresh investigators in two waves, highest expected effect first: a usage limit then costs the
tail, not the head.

## Blocked

**The rig is not reachable from a cloud container** (2026-09-15, still true): no key, and no egress to
its SSH port. Rig and timing lanes are the workstation's; `rig-limits.md` §9.

**Coalesce the decoded frames across decoders — design it, or drop it?** (2026-09-25, row 76). Batching
per decoder batches nothing on a slow CPU; batching across decoders needs a point they all pass
through, which changes §The decoders' shape. Its ceiling at 4–6×: about 10 ms of a fill's main
thread; less on the target link. **What is needed:** whether a proposal for the merge point is wanted
at that price ([`ARCHITECTURE.md`](ARCHITECTURE.md) §The hand-off). Not built meanwhile.

**Signed data in the product?** Still the workstation's: whether the product serves signed samples at
all. The decoders and the parity run cover signed 12- and 16-bit ([`decode/README.md`](decode/README.md) §Ground truth).

**Kept by DC2 as judgement calls** (2026-09-26) — the owner decides whether each stays:

* `docs/transport/upstream-quinn-ack.md` and `docs/transport/upstream-wtransport-settings.md` — drafts for
  the owner to file, not docs of this tree; kept so they are not lost before filing.
* `docs/telemetry/adr-server-pipeline.md` and `docs/telemetry/adr-instrument-clients-from-outside.md` —
  `telemetry/` was on the delete list and "the ADRs" on the keep list; they are ADRs, and now the only
  owners of the telemetry subject, so they stay under `telemetry/`.
* `--stream-mode pool:k` in the server — `adr-stream-shape.md` closes the shape, and the code stays only so
  its cells can be reproduced; removing it is a code row of its own.
* A second sequential telemetry session truncates `telemetry-server.rows` — a known defect, recorded in
  `telemetry/adr-server-pipeline.md` §Harvest, not fixed.
