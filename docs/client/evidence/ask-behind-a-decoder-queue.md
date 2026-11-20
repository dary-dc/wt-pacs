# An ask behind a decoder's queue

**Question:** Once an asked frame's bytes are in hand, does sending it to the decoder whose current decode started
earliest, ahead of that decoder's queued fill frames, cut the ask's wait for its pixels with the fill unchanged?

*Folded 2026-11-14 from `claude/askjump-measure:docs/decode/README.md` §An ask behind the decoders, *Run as* and
*Measured* (2026-10-22, `61a69b2c`; run command `0e3bcd51`; the flag `6896fc94`). The theory, the model's predictions
and the protocol, fixed before the data, stay in [`../../decode/README.md`](../../decode/README.md) §An ask behind the
decoders (2026-10-13; model [`../../../lab/ask-behind/sim.py`](../../../lab/ask-behind/sim.py)). The wait before the
bytes are in hand, behind the fill already written to the transport, is [`ask-during-a-fill.md`](ask-during-a-fill.md).*

**Variants:** A today (the frame goes to the decoder with the fewest outstanding, behind its queue); A′ today under
another name, the A/A variant; B the downloader's lab flag `askJump` (the ask goes to the decoder whose current decode
started earliest, one over `perDecoder`, and `decoder.js` runs it before its queued fill frames; the ring one buffer
larger). The theory predicts B's wait R_min + T against A's R_min + 2T when every decoder is full, T a frame's decode.

## Corrections the run made to its protocol

* **The ask's decoder wait** was to be `decodeEnd − lastByte`. *Corrected:* from the later of `lastByte` and the ask,
  since at AV1 4× every asked frame was already in hand and promoted at the ask.
* **The wait for a free wire buffer** is **not measurable**: the ring never waits, a miss allocates
  (`WireBuffers.take`), so there is no wait to compare and that clause of the rule is void.
* **No 300 Mbit/s cell ran:** at 300 Mbit/s every relay visit was `VOID` (p99 2.6–28 ms) and a fill averaged 144–148
  Mbit/s, so the protocol's `r300000` cells, and the predictions that needed them, were dropped.

## Measured (2026-10-22)

**Rig and fixtures.** `dbt12_ea1141` (29 frames) coded twice by `lab/av1/tools/ingest_coded.py`: HTJ2K, and the
product's AV1 (`--representation optimized --preset good:6`), each packed into a series bundle, each its own campaign.
`lab/ask-ahead/cells.py` with decoding on, 100 Mbit/s, 23 ms one way, FIFO `--queue-ms 650`, Chromium's CPU throttle
at 1× and 4×; variants in `lab/scripts/order.py`'s order; 12 rounds, extended to 24 because each series had a cell not
conclusive at 12. **Where the host saturates:** four cores, the relay alone on core 3 at `chrt -f 50`, browser, server and
three decoders on 0–2; at 100 Mbit/s half the visits were `VOID`; at 300 Mbit/s every one. The throttle's own check read
3.1–3.4×, not 4×, on a busy loop. Raw rows: `claude/askjump-measure:lab/ask-ahead/rows-askjump-av1.jsonl` and
`rows-askjump-htj2k.jsonl`, read by `askjump.py` there.

Round-paired, n = 24 a cell; ms, A then B, median / p90; B/A and A′/A the medians of round-paired ratios:

| `dbt12`, 100 Mbit/s | ask's decoder wait | B/A (A′/A) | ask's total, B/A | fill, ms | fill, B/A (A′/A) |
| --- | --: | --: | --: | --: | --: |
| AV1, 4× | 690 / 775 → **491 / 717** | **×0.76** (×0.96), better | ×0.76, better | 3 310 → 3 340 | ×1.005 (×0.994), tie |
| AV1, 1× | 217 / 260 → 163 / 226 | ×0.75 (×1.05), better | ×0.90, better | 1 712 → 1 700 | ×1.001 (×1.005), tie |
| HTJ2K, 4× | 46 / 64 → 47 / 62 | ×0.99 (×0.90), not conclusive | ×1.010, tie | 1 551 → 1 549 | ×0.998 (×1.001), tie |
| HTJ2K, 1× | 12 / 17 → 12 / 17 | ×0.97 (×1.07), not conclusive | ×0.998, tie | 1 512 → 1 511 | ×0.998 (×0.998), tie |

* **AV1 at 4× held its prediction:** ×0.76 at the median, inside the predicted ×0.57–0.88, the fill a tie (the rule's
  loss at its A/A spread 3.6 %). The milliseconds are not the model's 259 → 185: this host's 4× AV1 decode is slower.
  The model's forms at the host's T (3.31 s × 3 decoders ÷ 29 frames ≈ 340 ms) give R_min + 2T ≈ 765 against 690
  measured, and R_min + T ≈ 425 against 491.
* **AV1 at 1× contradicts its predicted tie:** it is decode-bound here too (fill 1.71 s against HTJ2K's wire-bound
  1.51), so the ask gains.
* **HTJ2K is wire-bound at 1× and 4×**, as predicted: total and fill tie; its 12–46 ms decoder wait has an A/A spread
  of 20–28 %, too wide to call.
* **Exact:** 288 visits, every frame; `MUTATE=sample` and `truth` gave 0 of 29 on each series and variant.

## Verdict

**Not resolved on this host; the flag stays off.** By the rule no cell is worse, a 4× cell is better and every frame is
exact, but 65 of 144 AV1 visits and 74 of 144 HTJ2K were `VOID` (p99 over 1 ms), over the 20 % that drops a link. The
strict reading keeps 2–6 rounds a cell and decides nothing; the `VOID` visits read as the clean ones (AV1 4×, clean
only: 635 → 475 ms, fill 3 310 → 3 281). Scope: one 29-frame DBT series, one link, Chromium only, a CPU throttle
standing in for a phone, nothing at 300 Mbit/s. What decides it: the same protocol, as corrected above, on a host that
holds 100 Mbit/s under 20 % `VOID`.
