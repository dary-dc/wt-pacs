# What a scroll ahead of the fill asks

**Question:** While the reader scrolls past what the fill has delivered, should the client ask for every step, only for
the frame under the cursor (the frame the viewer shows, moved by each step), or re-aim the fill at the cursor — which
gives the reader that frame soonest while the fill still completes?

*Folded 2026-11-14 from `claude/scroll-policies:docs/WIRE.md` §What a scroll ahead asks (pre-registered 2026-10-27 at
`a3dc100`, run the same day, `b3bd8117`, reviewed `4bc2d5f2`). The servers T and QW are those of
[`ask-during-a-fill.md`](ask-during-a-fill.md); the bytes ahead of an ask, B, are defined there. Nothing here is on the
tip but the 29–37 % packet figure, quoted in [`view-worker-design.md`](view-worker-design.md).*

## The policies, built as a lab flag

The downloader's lab flag `scroll` (`claude/scroll-policies:client/transport/downloader.js`, `1c8c05f9`; node tests
`noneLeavesTheFillToTheServer` and `aScrollAhead` in `downloader.test.mjs` there). It is not on the tip, and neither
[`../../CLIENTS.md`](../../CLIENTS.md) nor [`../../../client/README.md`](../../../client/README.md) names it. The viewer is
unchanged and asks every step whose frame is missing.

* **Every step** (E, no flag): each step's ask goes to the wire.
* **The cursor's frame only** (C, `scroll: "cursor"`): while an ask is on the wire, a step's ask is held, a newer one
  replacing it; when the ask on the wire lands, the held one goes out if the fill has not delivered it.
* **The fill re-aimed at the cursor** (F, `scroll: "aim"`): an ask for a frame the fill still owes sends no ask; the
  fill is re-issued from that frame (`stream_frames` from it), the earlier frames after it. With `refill: "none"` a run
  can end short.

Ep is E again, the A/A variant; on QW's server the four are QE, QEp, QC, QF.

## Protocol (2026-10-27)

**The shape.** `dbt10_ea1141` (24 frames, 13.6 MB), once 10 % has landed: the cursor jumps to frame 14 and steps one
frame every 500, 100 or 20 ms to 23; ten steps. *Stale*: the time the cursor showed another frame than its own (each
step's wait for its frame, cut at the next step; the last step's whole), what the rule judges. *Rest*: the last step to
its frame. *The fill*: its issue to its last frame on the page.

**Cells.** 18 and 103 Mbit/s at 46 ms behind FIFO 20; steps every 500 and 100 ms at 18, 100 and 20 ms at 103, below and
above the fill's R ÷ S (3.9 and 22 frames a second). Each on T's server (`?refill=head`) and QW's.

**Predictions (D)**, B ≈ 2.8 s at 18 and 0.49 s at 103 on T's server, ≈ 0.6 s and 0.14 s under QW: on T's, C a tie
everywhere and F a tie on stale but its fill worse by ≈ B ÷ R; on QW's, C a tie below R ÷ S and better above (≈ ×0.6 at
18/100, ≈ ×0.75 at 103/20), F better below (≈ ×0.3, ≈ ×0.4) at a fill ≈ ×1.1.

**Rule, fixed before the data.** A cell is `VOID` when over 20 % of its visits are `VOID` or its A/A (Ep ÷ E) falls
outside ×0.90–1.10. A policy wins a cell when `lab/scripts/aa_rule.py` (bar 5 %) reads its stale better than E's and
its fill not worse, every frame exact; stale better with the fill worse is a trade-off for the owner. Per server and
regime the answer is the policy that wins both cells, decided only where the strict and round-paired readings agree.

## Measured (2026-10-27)

**Rig.** One frozen release build (`--features lab-levers`, `627a6ca`), Chromium 153.0.8010.12, relay under `chrt -f 50`,
run by `lab/ask-ahead/scrollpolicy.sh` and read by `scrollpolicy.py` (both on the branch). An A/A campaign first (7
rounds, 112 runs: Ep ÷ E ×0.987–1.005, but 36–43 % of visits `VOID` in four cells); the main campaign **10 rounds,
320 runs, every frame SHA-256-exact**, A/A ×0.996–1.006, 44 visits `VOID`: 5–15 % in six cells, **28 % (QW 18/500) and
25 % (QW 18/100)**, so those two cells are `VOID`. **The host saturates between 103 and 200 Mbit/s** (17.7 Mbit/s at 18,
100.1–100.4 at 103, 166–193 at 200); nothing is claimed past 103. One series, one RTT, no loss, Chromium only, one
session. Raw rows: `claude/scroll-policies:lab/ask-ahead/rows-scrollpolicy.jsonl`, `rows-scrollpolicy-aa.jsonl`,
`rows-scrollpolicy-ceiling.jsonl`.

| round-paired, × E | stale: E ms | C | F | fill: E ms | C | F | rest: E → C · F ms |
|---|---|---|---|---|---|---|---|
| T's, 18, step 500 ms | 5 495 | ×0.999 ↓ (strict tie) | ×0.907 ↓ | 6 478 | ×0.998 | ×1.379 **↑** | 995 → 988 · 483 |
| T's, 103, step 100 ms | 951 | ×1.005 | ×0.815 ↓ | 1 392 | ×1.005 | ×1.337 **↑** | 51 → 54 · 0 |
| T's, 18, step 100 ms | 4 986 | ×0.686 ↓ | ×1.002 | 6 477 | ×1.002 | ×1.386 **↑** | 4 086 → 2 512 · 4 082 |
| T's, 103, step 20 ms | 853 | ×0.688 ↓ | ×1.001 | 1 389 | ×1.002 | ×1.339 **↑** | 673 → 408 · 673 |
| QW's, 18, step 500 ms `VOID` | 5 512 | ×0.996 | ×0.312 ↓ | 6 487 | ×0.995 | ×1.108 **↑** | 1 012 → 1 003 · 0 |
| QW's, 103, step 100 ms | 1 034 | ×0.913 ↓ | ×0.515 ↓ | 1 473 | ×0.941 ↓ | ×1.170 **↑** | 134 → 46 · 0 |
| QW's, 18, step 100 ms `VOID` | 3 356 | ×0.610 ↓ | ×1.002 | 6 457 | ×1.005 | ×1.110 **↑** | 2 456 → 1 040 · 2 380 |
| QW's, 103, step 20 ms | 720 | ×0.748 ↓ | ×1.000 | 1 386 | ×0.998 | ×1.247 **↑** | 540 → 359 · 539 |

↓ better, **↑** worse, unmarked a tie (`aa_rule.py`, bar 5 %, MDL 0.4–2.0 % round-paired). The strict reading kept 6–8
rounds in the clean cells and agrees but for C at T's 18/500 (a tie); in the two `VOID` cells it kept 4 and 2.

* **T's server, below R ÷ S: every step stays.** F is a trade-off, stale ×0.91 and ×0.82 at a fill +2.47 s (×1.38) and
  +0.47 s (×1.34); C does not win both cells.
* **T's server, above R ÷ S: the cursor's frame only**, stale ×0.686 and ×0.688, rest 4.1 → 2.5 s and 0.67 → 0.41 s,
  the fill a tie; both readings agree.
* **QW's server: not resolved on this host** in either regime. Leaning, round-paired: below, F (×0.31, ×0.52) at a fill
  ×1.11 and ×1.17 (+0.69 s, +0.25 s), C a tie at 18 and better at 103; above, C (×0.61, ×0.75), the fill a tie.
* **Predictions.** T's C a tie: held below, **contradicted above** (×0.69 at both rates). T's F a tie on stale:
  **contradicted below** (×0.91, ×0.82), held above; its fill cost held (+2.47 s and +0.47 s against 2.8 and 0.49). QW's
  C above: held at 103/20 (×0.75); ×0.61 at 18/100 is a `VOID` cell's leaning. QW's F below: better at 103/100 but
  weaker than predicted (×0.52 against ≈ ×0.4); its fill cost larger (×1.11–1.25 against ≈ ×1.1). *Corrected on the
  branch by its review:* these had read "QW's C: held" and "QW's F: held below", from `VOID` cells.
* **Why F costs the fill (D, not isolated):** the client drops frames an earlier run had written ahead (a frame no fill
  owes, `frame-session.ts` `deliver`), so they are sent again; consistent with F's runs sending 29–37 % more packets
  than E's on T's server and 10–23 % on QW's. Keeping those frames is the change F would need before it could win.
* **Not explained:** why one ask for the newest step beats ten in order on T's server, where every ask was predicted to
  wait behind the 6 MiB credit alike. A guess, not measured: the head re-ask goes out on the first ask's head, and the
  second ask ends that refill before most of it is written.

## Verdict, and what is open

The policies split by regime and no one wins both. **The cursor's frame only lost no cell** and helps above R ÷ S on T's
server and at QW's 103/20. The owner's question (`claude/scroll-policies:docs/WIRE.md` §Questions for the owner, 2):
take the cursor's frame only, keep the re-aim for a client that keeps an earlier run's frames, or rerun QW's
18 Mbit/s cells on a quieter host. Scope: one 24-frame DBT series at 0.57 MB a frame, 46 ms, no loss, the container,
Chromium 153, nothing past 103 Mbit/s, no phone.
