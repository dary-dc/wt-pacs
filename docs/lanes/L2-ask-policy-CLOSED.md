# L2 ask-policy — investigation closed

**Closed 2026-09-09** on `cursor/l2-harness-fix-plan-c999` (PR #9).  
**Lab only.** Product ask paths (`client/transport-ts`, `client/transport-wasm`) were not
changed and are not locked by this file.

The lane asked two questions: does bounding in-flight asks help, and does adapting that bound
live beat a fixed number? This file is the answer this branch will stand on. Cite it, not the
void campaign summaries.

## What is void — do not quote as a winner

| Campaign | Why it is void |
| --- | --- |
| v1–v3 arm rankings | Ring window walked off the study edge; “fixed” and “dynamic” were the same `D=16` policy; the estimator’s RTT input was overridden. |
| Cloud v4, 182 rows (2026-09-07) | `cloud_netem.sh stats` deleted the shaper. The file is an unshaped WAN bake-off labelled as netem 60 / 0.5 %. No loss conclusion, no shaped-path ranking, no cap ranking. |

Those files stay in the repo as history. They are not evidence for a policy.

## What we can conclude

These hold as **mechanisms**. They are not a product shipping decision.

1. **Do not ask the whole study at once if the reader might jump.** On the jump trace, bulk
   left **768 KB** in flight that no later step wanted. A short forward prefetch left **96 KB**.
   Asking only the on-screen frame left **0**. Same pattern in the FIFO model and in the local
   harness. The shipping clients still bulk-ask; this branch did not change them.

2. **Ask a few frames ahead when the link can keep up.** On unsaturated scroll (40 ms steps,
   10 Mbps, 32 KB frames), any forward prefetch that covers about one path delay drove median
   lateness to **0**. Asking one frame at a time stayed about one path delay late (~63 ms on
   the `--rtt-ms 60` emulator).

3. **When the reader is faster than the link, ask policy cannot save lateness** except by not
   putting unwanted frames first. The 16 ms scroll cells are that regime. They rank the link,
   not the policy. Do not run them again to pick a winner.

4. **A small in-flight cap was not shown to help or hurt.** `window` (same prefetch, no cap)
   and `adr` (formula `D=4`) tied on the fair local rerun. The one comparison that could have
   said “this `D` costs” was the shaped-path grid. That grid is void, and the rerun never ran
   (rig rejected the agent key).

5. **Live adaptivity was not shown to win or lose.** With `dynfb` in the grid, first-byte
   moved `D` from 4 to 3 and did **not** run to 16. Reader numbers matched the fixed cap.
   That is a one-step move on an idle emulator. Separately: ask→first-byte on a *busy* pipe
   measures the client’s own queue (unit test + loopback); Chromium 141 exposes no transport
   RTT to a page. So there is no input that is both clean and available in the regime where a
   cap would matter. That is why dynamic is a poor *default*, not proof that “fixed beat
   dynamic” in a bake-off.

6. **How to read the numbers.** Rank **median lateness** and **stranded bytes**. On these
   short traces, p95 is mostly session start. Switching the primary after seeing the table is
   how the void cloud write-up oversold itself.

7. **The on-screen frame is asked immediately.** Any cap applies only to lookahead. That is
   harness semantics, so a bound cannot block the frame the reader is looking at. It is not
   itself a measured win over “no cap.”

## What we will not conclude

- “Lab implements fixed `D`” or “the cap is the policy.”
- “Do not adapt,” as if `dynfb` lost a fair race. It did not lose. It also did not win.
- Anything about 0.5 % loss. Never measured with the shaper still on.
- An ADR / D26 product change. The existing ADR is untouched.

The 2026-09-06 design note’s §5 (fixed cap, no dynamic) is a **design preference** given the
missing RTT, not a result of a fair shaped campaign. This close-out supersedes it as a lock.

## What this branch leaves behind

Useful, and finished:

- Harness: forward window, `--depth` vs `--prefetch`, `--rtt-source`, lateness by step
- FIFO simulator that reproduces the v2 *rows* (not the v2 ranking)
- `cloud_netem.sh stats` no longer deletes the qdisc; packet e0 exists
- Local rerun with `dynfb`: [`../measurements/r2/l2_ask_policy_v4_local_rerun_SUMMARY.md`](../measurements/r2/l2_ask_policy_v4_local_rerun_SUMMARY.md)

Not done, and **not** this branch’s next step:

- Shaped-path `window` vs `adr`
- Loss
- A browser cell
- Real reader traces

Those need a new campaign after the rig accepts a key again. They do not reopen these
conclusions.

## Lab default if someone keeps measuring

On-screen frame at once, forward prefetch `K`, bulk only for preload. Treat `D` and live
adaptivity as optional knobs until a shaped-path grid with packet e0 actually ranks them.
Do not copy this into product clients from this PR.
