# A wake on the exact session before *Lossless* asks

**The question:** after a fill the page is silent and a cellular radio drops to idle; the reader's *Lossless* ask then
pays the radio's promotion. Can the client take part of that off by sending something on the exact session at
`pointerdown`, ahead of the `click` that asks?

*Folded 2026-11-14 from `claude/proposals:docs/lines/proposals.md` (`5b4c3341`) §P3, §Red team and §R3,
`claude/direction:docs/lines/client.md` §4 item 8 and `claude/reviews-2026-11-13:docs/reviews-2026-11-13.md` §4. On
this branch [`../../transport/transport-conclusions.md`](../../transport/transport-conclusions.md) records the page's
wake as not built; it still is not.*

## Theory (2026-11-11)

*By report*, carriers drop a radio to idle after 5–10.5 s without traffic, and promotion costs 190–396 ms on 4G and
341–1 907 ms on 5G (`transport-conclusions.md` §9 item 4). The relay's idle model shows a packet sent L ahead takes L
off a promotion P: max(0, P − L) within 4 ms (§3 *The idle radio*). A control-stream message would end a running fill,
but the exact session never has a fill, and `end_stream` without a fill does nothing (`docs/WIRE.md` §FoD messages).
So: on `pointerdown` on the lossless button, send `end_stream` on the exact session; ask on `click` as today. No wire or
server change. L is a tap's down-to-click time, ~50–150 ms. **Expected (assumption):** 0–150 ms on an `l` after a
dwell, on cellular; nothing on Wi-Fi beyond power save, nothing in a container. *Corrected by the red team:* a browser
pings every 15 s, so the radio is idle only 4.5–10 s of each 15, and the expected gain is **0–100 ms**.

## Measured on the relay's radio model (plumbing only)

**Fixtures:** the relay `--idle-promote 5:300` on the exact session alone (30 ms each way, 20 Mbit/s), the
optimal-quality session direct on loopback; one 4-core host, headless Chromium; DBT volumes of one dataset; on a
filled page, 10 s of quiet on frame 0, then `l` from the `click` to *Lossless*.

* **First arm (2026-11-11, 7 rounds, 105 runs):** a lab copy whose `pointerdown` called the exact downloader's
  `cancel()`. On `dbts_a1` and `dbts_c1` the wake took the lead off as the model says (on L against off: −4, −44,
  −88 ms and −4, −48, −105 ms for L = 0, 50, 100). The registered rule was refuted by the rig on `dbts_b1`: its fill
  ends later, so `l` comes 15–17 s into the exact session's life and something else wakes the radio first, fitting the
  browser's 15 s ping (2 runs a variant outside the protocol; which packet it is was not read).
* **Red team:** `cancel()` is not the proposed mechanism; it also raises the generation and drops every record, ask
  and want, so a tap during an `l` in flight would lose that ask's bookkeeping. And the registered phone row's 15 s
  dwell sits on the ping's own period.
* **Rebuilt on `end_stream` alone (2026-11-11 20:56–21:17, 42 runs):** a `wake` message calling the exact session's
  `endStream()` and nothing else; a lab test, mutated (3 mutants killed), shows the wake never reaches the
  optimal-quality session and a wake during an ask in flight still delivers the frame. `dbts_b1` excluded (its `l` falls
  past the ping).

| series | off ms | on, L = 100 ms | A/A ms | on − off | tolerance | failed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `dbts_a1-q8-g8-cut` | 1104 | 1001 | 1112 | **−103** | ±15 | 0 |
| `dbts_c1-q8-g16-cut` | 1045 | 940 | 1043 | **−105** | ±15 | 0 |

Medians of 7; the rule (−100 ± 15 ms) holds; the A/A arm moved 8 and 2 ms; every run ended at *✓ Lossless* with the
optimal-quality series whole and one promotion.

## Verdict, scope

The plumbing holds on a modelled radio (−103 and −105 ms on two DBT volumes, one host); the gain on a phone is
expected at 0–100 ms and is not measured. *Decides it:* the owner's phone on cellular, 20 dwells an arm alternating,
each dwell drawn in advance uniformly over 6–14 s after the session's last packet (a seeded list written into a
protocol amendment), the time since the last packet recorded per `l`; adopt if the on arm's median `l` is lower by
≥ 30 ms with an A/A pair setting the floor and no `l` failing. A keep-alive on the exact server (≤ 5 s) would take all
of P off at the radio's energy cost: the owner's, named only.

Raw rows: `claude/proposals:lab/proposals/rows/p3.jsonl`, `r3.jsonl`.
