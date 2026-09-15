# T11 — The cost items: LTO, the read path on the target, limits at thousands of sessions

**Status:** open, three small items · **Needs:** T1's outcome, the disk lane, the cloud rig

## LTO (PR #27)

`lto = "fat"`, one codegen unit: −3 to −6 % CPU per ask at saturation on this tree; +7 % p50
(6/6) at 32 KB, depth 1, one session ([`../transport/why-these-changes.md` §10](../transport/why-these-changes.md)
entry 5). **Rule:** once T1 makes depth ≥ 2 the product's shape, merge it; if large frames at
depth 1 ship, re-run that cell on the profile first and let it veto.

## The read path on the target

[`../disk-access/NEXT.md`](../disk-access/NEXT.md) P0 and the rest are the disk lane's, in its
order. On the target a read is about 1 % of a frame's wire time, so every row there is cost,
not latency; nothing in this list waits on it.

## Memory and limits at a thousand sessions

`send_window` (10 MB) is the ceiling per stalled client and the chunked path holds 180 kB of
it; rings charge `RLIMIT_MEMLOCK`; there is no admission control at accept. **Steps:** the
stall campaign (`window-harness --mode stall`) at 1 000 sessions on the rig, RSS per session
and fds read from `/proc`; the manifest lines in [`../disk-access/DEPLOYMENT.md`](../disk-access/DEPLOYMENT.md)
(`LimitNOFILE`, `LimitMEMLOCK` or `CAP_IPC_LOCK`) into the unit file; an accept cap
(`--max-sessions`, refuse past it) if the stall campaign shows memory growing without bound.
**Rule:** RSS per stalled session under 300 kB and fds under 3 — then no cap is needed
beyond the manifest.
