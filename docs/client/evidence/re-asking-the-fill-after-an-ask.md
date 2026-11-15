# Re-asking the fill after an ask

**Question:** Today an ask ends the fill and the downloader asks for the rest again. If it re-asks on the asked frame's
8-byte envelope head instead of its last byte, does the idle wire after the ask go, and does the send window that
follows cwnd then keep its faster ask at no cost to the fill?

*Folded 2026-11-14. The theory and the protocol, fixed before the data, are
[`../../transport/link-conditions.md`](../../transport/link-conditions.md) §Re-measured, proposed, the *ASKTHENFILL*
item (2026-10-14; [`../../native/ask_then_fill.py`](../../native/ask_then_fill.py) prints its derived numbers). The first run, below, is
`claude/wip-210-ASKTHENFILLMEASURE:docs/transport/link-conditions.md` §Measured (`c09ecf54`); only its one-line summary
reached the tip ([`../../av1/queue.md`](../../av1/queue.md)). Its re-run, which made the head re-issue the default, is in
link-conditions.md at the paragraph after the protocol (2026-10-15). What a server that keeps the fill would change is
[`ask-during-a-fill.md`](ask-during-a-fill.md).*

**Variants**, used only here: **T** today (re-ask on the asked frame's last byte); **B** the re-ask on its head
(`refill: "head"`); **W** the send window following cwnd (`--send-window-follows-cwnd`); **A** the re-ask sent right
behind the ask (`refill: "ask"`). W + B is the window with the head re-ask.

## The first run (2026-10-14)

**Rig and fixtures.** Run by a session given only the protocol, the rule and the head trigger's needs. The downloader's
lab flag `refill` (`head`, `ask`), off by default, two tests, 8/8 mutations caught. `lab/ask-ahead/`, Chromium
141.0.7390.37, the product's downloader, decoding off, `dbt10_ea1141` HTJ2K (24 frames, 13 637 860 B), `cubic-restart`,
quinn's defaults, shared stream, one server build (`9240bc85`), relay under `chrt -f 50`. **Deviation from the
protocol:** the ask is for the last frame (23, 560 018 B), not the largest (14, 571 632 B): every frame is 0.56–0.57 MB,
and at 50 % a deep queue has frame 14 written ahead before the ask. Cells: 18 and 103 Mbit/s × idle 46 and 92 ms ×
FIFO 20 ms and CoDel 5:100 at 10 % and 50 %; FIFO 360 and 800 ms at 50 %; 18/300 FIFO 20 (relay p99 0.3–0.5 ms there);
W + A at 18/46 and 103/46 FIFO 20; fills with no ask under T and W; W and W + B under `cubic` at 103/92. **10 Williams
rounds, 30 cells, 1 100 runs, every frame SHA-256-exact, 105 `VOID`**; strict keeps the rounds no variant of the cell
voided (n = 4–9). 309 Mbit/s and loss were not run: the first is past this host, in the second the gap is under a loss
event's spread. Raw rows: `claude/wip-210-ASKTHENFILLMEASURE:lab/ask-ahead/rows-askthenfill.jsonl`, read by
`askthenfill.py` there.

| strict, median against T's | ask, W + B | fill, W + B | fill, T + B at 10 % |
|---|---|---|---|
| 18/46 FIFO 20 · CoDel | ×0.33–0.40 | −102 to +1 ms, tie or better | −67 · −28 ms, ties |
| 18/92 FIFO 20 · CoDel | ×0.32–0.42 | −111 to +8 ms, tie or better | −92 · −104 ms, better |
| 18/46, 18/92 FIFO 360 · 800 (50 %) | ×0.31–0.56 | −1 to +2 ms (+2 beyond a 2 ms spread at 18/46/800) | – |
| 103/46 FIFO 20 · CoDel | ×0.41–0.72 | +6, +79 ms worse at 50 %; better at 10 % | −60 · −33 ms, better |
| 103/92 FIFO 20 · CoDel | ×0.59–0.88 | +97, +99 ms worse at 50 %; +100 (tie), −73 at 10 % | +9 (tie) · −46 ms, better |
| 103 FIFO 360 · 800 (50 %) | ×1.00 | ties | – |
| 18/300 FIFO 20 | ×0.34–0.60 | −176, −71 ms, better | −273 ms, better |

The idle wire between the asked frame and the next fill frame (its landing less its time on the wire): T 53–142 ms at
18 Mbit/s, 370 at 18/300, 64–108 at 103; T + B 4–73 ms, 63 at 18/300, 4–62 at 103. At 50 % neither T nor T + B ever had
a fill frame after the ask: today's send buffer had written all of the remainder ahead.

* **The head re-ask:** round-paired, no cell worse and six 10 % cells' fills better (−33 to −282 ms): adopted. Strict:
  the same six better, but 103/46 CoDel at 50 % +4 ms (×1.003) beyond T's 9 ms spread, a cell where B never fires: not
  adopted. **The readings disagree: not conclusive on this host**; only T and T + B needed re-running.
* **The window:** W + B's ask ≥ 20 % better in 9 of 10 short-queue cells strict (103/92 FIFO 20 at 10 % ×0.82), 10 of
  10 round-paired; its fill worse beyond T's spread at 103/46 CoDel (+79, +82 ms) and 103/92 FIFO 20 and CoDel (+97 to
  +101 ms) at 50 %, where RTT − S ÷ rate is 3 and 49 ms, so worse by more than the gap the rule allows: **not
  adopted**, both readings. Its fill cost is the window's own (prediction 5).
* **Predictions:** (1) W + B's fill at 50 % within T's spread at 18 and at 103/46: **failed at 103/46 CoDel** (+79 ms
  against ≤ 25), held elsewhere. (2) W + B's ask equals W's: held but for 3 of 26 cells (+1 ms at 18/46 FIFO 20,
  +52 ms at 103/92 CoDel, +153 ms at 18/300 at 10 %). (3) T + B a tie at 50 %, shorter by min(RTT, S ÷ rate) at 10 %:
  held (−92, −104, −60, −33, −46, −273 ms against −46 to −260), but 103/92 FIFO 20 +9 ms and 18/46 −67 and −28 are
  ties. (4) The re-ask with the ask costs 777 ms ± 20 % at 18/46: **held** (+723 ms); 148–222 ms at 103/46: **failed**
  (+111). (5) The window alone costs a fill with no ask nothing: **failed**, +15 ms at 103/46 CoDel and +46 ms at 103/92
  FIFO 20 — the window's own cost, which B cannot remove. (6) `cubic` against `cubic-restart` a tie: held behind FIFO
  20 and for W behind CoDel; W + B under `cubic` behind CoDel 69 ms better, its ask ×0.78.

## The re-run (2026-10-15)

T, T′ and T + B only, by the A/A rule, 24 rounds, 1 296 runs: **the head re-ask became the downloader's default**
(`refill: "head"`), the idle wire after a 10 % ask 53–141 ms → 4–79 ms. Text and table:
[`../../transport/link-conditions.md`](../../transport/link-conditions.md) §Re-measured, proposed. The window was not
re-run there; it was measured again beside the one queue ([`ask-during-a-fill.md`](ask-during-a-fill.md)).

**Scope.** The first run did not measure the relay's ceiling; the re-run, on the same rig, found the host saturating
between 103 and 200 Mbit/s, so nothing past 103 is claimed. Chromium only, one 24-frame DBT series, no loss, no
phone.
