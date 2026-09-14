# T2 — The congestion controller for a radio-loss link

**Status:** open · **Needs:** the cloud rig, a reviewer for quinn's BBR · **Size:** two rig days, one review

## Question

The measured answer is two-sided: quinn's BBR −44 to −48 % on exogenous loss, Cubic +63 %
better on congestive loss, and BBRv1 takes 99.4 % of a shallow-buffer bottleneck from a
competing TCP Cubic flow ([`../transport/transport-conclusions.md` §1](../transport/transport-conclusions.md)).
The target is stated as mobile, which is radio loss with bufferbloat underneath. Two things
are unknown: the mix on real sessions, and whether quinn's BBR (a port of quiche's BBRv1
`bbr_sender.cc`, 900 lines) is sound — moq-dev's issue #686 calls it "horribly broken from
every indication" without naming a cause and moved its default to it anyway; do not copy that
default either way. `congestionControl` in the browser only shapes the browser's send side and
has no bearing on downloads.

## Decision rule

Flip the default to BBR only if all three hold on the rig, six repeats, arms interleaved:

1. Gilbert–Elliott loss, mean 0.5 %, burst ≈ 7, at 10 Mbit / 60 ms and 20 Mbit / 50 ms: BBR
   beats Cubic by more than 15 % on miss-only p95 wait (L1's metric and gates).
2. Congestive cell (a short netem queue, no random loss): BBR's queue drops are under 3×
   Cubic's and its p95 is not worse by more than 15 %.
3. Fairness: sharing the bottleneck with one TCP Cubic flow over a shallow buffer, BBR's share
   stays at or under 80 %.

If only rule 1 holds, BBR stays behind `--congestion bbr`, and "a production-tested BBR as a
custom `ControllerFactory`" opens as the follow-up. If rule 1 fails, close the item.

## Steps

1. **Review** `quinn-proto/src/congestion/bbr` against quiche's `bbr_sender.cc`: the
   pacing-gain cycle, the min-RTT probe, the recovery handling, and anything the port marks as
   simplified. Write down what differs before running anything.
2. **Cells.** `lab/scripts/rig_cells.sh cc` with `LOSS_MODEL=gemodel` at the two profiles
   (rule 1); the same with `LOSS_PCT=0` and the netem `limit` set to the bottleneck's shallow
   queue, drops read from `tc -s qdisc` (rule 2); the L4 fairness scripts from tag
   `archive/transport-lab-2026-09` for rule 3.
3. **qlog** both arms (`TransportConfig::qlog_stream`) and read pacing rate, cwnd and
   recovery episodes; a BBR that never leaves startup or never probes RTT is the defect the
   review looked for.
4. **The mix in the field.** Add to the client recorder the RTT trend in the second before
   each loss (rising → congestive, flat → radio). Until that exists the rig decides.

## Report

Three tables, one per rule; the review as a section in `transport-conclusions.md` §1.

## Stop conditions

BBR stalling or panicking on any cell — file upstream with the qlog and stop the campaign.
