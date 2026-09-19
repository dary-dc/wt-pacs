# The rig runbook — every shaped campaign, in order

**Why this exists:** `sch_netem` loads on a VM but not in an agent container, so every shaped
cell runs on the Oracle rig ([`../cloud-rig-access.md`](../cloud-rig-access.md)). A container can
now shape in userspace instead (`../rig-limits.md` §3), which is where a mechanism is shown; these
campaigns are the verdicts, and they stay here until the two are calibrated against each other. The cloud
agent cannot reach it at all — that environment has no `ssh` binary, no route to port 22, and
its containment layer refuses a tunnel — so these campaigns are run by a **local** agent or by
the owner, and the results come back as commits on this branch.

Three campaigns are ready. They are independent and can run in any order, but only **one at a
time**: a second `tc qdisc replace` silently corrupts the first, and the rig is two cores.

| # | Campaign | Decides | Plan |
| --- | --- | --- | --- |
| 1 | Stream shape — `shared` vs `pool:k` vs `per-frame` | whether the default changes | [`T3`](T3-stream-shape.md) |
| 2 | Congestion controller — Cubic vs BBR on radio loss | the largest throughput number open | [`T2`](T2-controller.md) |
| 3 | Segment cap — seg45 vs seg10 on a paced link | whether the quinn patch is deleted | [`T9`](T9-segment-cap.md) |

`T1` (the client window) is parked by the owner. `T10` (placement at scale) needs a second box
for the client and is not in this runbook.

## 0 · Preflight, once

The rig has two cores and 954 MB and **cannot build** — every binary is built on the
workstation and copied.

```bash
export SSH_KEY=~/.ssh/id_ed25519_rig        # never the agent key; see cloud-rig-access.md
RIG=ubuntu@168.138.130.163

cargo build --release                        # workstation
scp -i "$SSH_KEY" target/release/{exact-server,window-harness,server_ab} "$RIG":~/bin/
ssh -i "$SSH_KEY" "$RIG" 'cd ~/wt-pacs && git fetch origin claude/clever-curie-flm0wi \
  && git checkout claude/clever-curie-flm0wi && git pull \
  && bash server/scripts/gen_dev_cert.sh && bash lab/scripts/gen_tf_fixtures.sh'
```

Fixtures and the dev certificate are gitignored, so they are generated on the rig, not copied.
Then prove the shaping works before trusting a number from it:

```bash
ssh -i "$SSH_KEY" "$RIG" 'cd ~/wt-pacs && lab/scripts/verify_netns_netem.sh'
```

`verify_netns_netem.sh` takes the unprivileged path, which this rig refuses —
`kernel.apparmor_restrict_unprivileged_userns=1` makes `unshare --user --map-root-user --net`
fail on `/proc/self/uid_map`. There, prove it with `sudo unshare --net -- tc qdisc replace dev
lo root netem delay 20ms` and check the host's own `lo` stayed `noqueue`. **Run the cells the
same way** — `sudo unshare --net -- lab/scripts/…`, not the `--user --map-root-user` form,
which cannot write the cell's logs under `sudo`. The rig also has no `git`: the campaign tree
is copied, and `/home/ubuntu/wt-pacs` is a deploy tree with a field server on UDP 4437 that
must stay off the shaped path.

**Before releasing any stream-shape cell**, run the pre-flight on a machine with the binaries —
it needs no rig and no `tc`:

```bash
lab/scripts/stream_shape_preflight.sh
```

It exercises the cell end to end on unshaped loopback (which marks itself `UNSHAPED`, and the
pooler refuses such a directory) and checks every void check fires on data built to trip it and
clears on data that should not. Of the five faults in the 2026-09-15 campaign, three would have
surfaced here instead of on the rig.

## 1 · Stream shape (T3)

The three arms are built; `pool:k` landed with this runbook. Read
[`T3-stream-shape.md`](T3-stream-shape.md) first — in particular **the validity condition**:
at depth 1 the arms are byte-identical, so every cell here runs at `D_min > 1`, and the result
does not transfer to the mammography sizes.

```bash
cd ~/wt-pacs
for loss in 0 0.5 2; do
  RATE_MBIT=10 RTT_MS=60 LOSS_PCT=$loss REPS=6 DEPTH=2 \
  FX=$PWD/lab/fixtures/frames_250k/frames_250k.sbnd ARMS="shared pool:2 per-frame" \
  sudo unshare --net -- \
    lab/scripts/stream_shape_cells.sh out/t3-250k-l$loss ~/bin/exact-server ~/bin/window-harness
done
LOSS_MODEL=gemodel RATE_MBIT=10 RTT_MS=60 REPS=6 DEPTH=2 \
FX=$PWD/lab/fixtures/frames_250k/frames_250k.sbnd ARMS="shared pool:2 per-frame" \
sudo unshare --net -- \
  lab/scripts/stream_shape_cells.sh out/t3-250k-ge ~/bin/exact-server ~/bin/window-harness

for loss in 0 0.5 2; do
  RATE_MBIT=10 RTT_MS=60 LOSS_PCT=$loss REPS=6 DEPTH=4 \
  FX=$PWD/lab/fixtures/frames_32k/frames_32k.sbnd ARMS="shared pool:2 pool:4 per-frame" \
  sudo unshare --net -- \
    lab/scripts/stream_shape_cells.sh out/t3-32k-l$loss ~/bin/exact-server ~/bin/window-harness
done

for d in out/t3-*; do echo "== $d"; lab/scripts/stream_shape_pool.py "$d"; done
```

`stream_shape_pool.py` **exits non-zero and prints VOID** when the cell decides nothing — the
reference arm pooled under 20 misses, the reader never met its schedule, over 10 % of waits
were censored, or the cache served the run. A VOID cell is a cell to fix, never a cell to
re-run with more repeats: that is precisely the mistake the Phase C review found.

## 2 · Congestion controller (T2)

**Step 1 is not a measurement and comes first:** read `quinn-proto/src/congestion/bbr`
against quiche's `bbr_sender.cc` — the pacing-gain cycle, the min-RTT probe, the recovery
handling — and write the differences into `transport-conclusions.md` §1 *before* running a
cell. moq-dev's issue #686 calls quinn's BBR broken without naming a cause; a controller that
never leaves startup or never probes RTT is what the review is looking for.

```bash
cd ~/wt-pacs
LOSS_MODEL=gemodel RATE_MBIT=10 RTT_MS=60 REPS=6 \
  unshare --user --map-root-user --net -- lab/scripts/rig_cells.sh cc out/t2-10-60.tsv x ~/bin/exact-server
LOSS_MODEL=gemodel RATE_MBIT=20 RTT_MS=50 REPS=6 \
  unshare --user --map-root-user --net -- lab/scripts/rig_cells.sh cc out/t2-20-50.tsv x ~/bin/exact-server
```

Rules 2 and 3 of [`T2`](T2-controller.md) — the congestive cell with a shallow netem `limit`
and drops read from `tc -s qdisc`, and the fairness cell against one TCP Cubic flow — have no
script yet and are the campaign's own work. **All three rules must hold to flip the default**;
rule 1 alone leaves BBR behind `--congestion bbr`.

## 3 · Segment cap (T9)

```bash
# workstation: the seg10 arm caps the patch's own constant, which the tree sets to 64
#   (the cap binds at 65_527 / 1452 = 45 segments at the current MTU)
sed 's/MAX_TRANSMIT_SEGMENTS: usize = 64;/MAX_TRANSMIT_SEGMENTS: usize = 10;/' \
  patches/quinn-0.11.11-mtu-gso.patch > /tmp/seg10.patch
# point patched/quinn at it, build into its own target dir, copy as ~/bin/exact-server-seg10:
for p in "20 50" "100 30" "1000 1"; do set -- $p
  RATE_MBIT=$1 RTT_MS=$2 REPS=6 unshare --user --map-root-user --net -- \
    lab/scripts/rig_cells.sh segs out/t9-$1-$2.tsv seg45 ~/bin/exact-server -- seg10 ~/bin/exact-server-seg10
done
lab/scripts/runtime_ab_pair.py out/t9-*.tsv
```

`1000 1` is the LAN control and the 45-segment burst **must** show there. If it does not, the
rig's two cores never reached the CPU-bound regime, the cell is void, and the loopback figure
stands as the LAN number.

## The five rules that have each already produced a wrong answer here

* **Interleave the arms.** Sequential before/after measured +8.1 % on code that was a tie.
  Every script here reverses arm order per repeat; do not "simplify" that away.
* **Mutate every new test** — break the code on purpose and watch the test fail.
* **Quote latency or throughput, not both** — one is the other divided by depth.
* **Say where the host saturates and claim nothing past it.** The rig is two cores.
* **A dead cell is a design error.** Raising repeats on a VOID cell manufactures a result.

## What comes back

Per campaign, committed to `claude/clever-curie-flm0wi`:

* the raw JSONs or TSVs under `docs/measurements/r2/`,
* the pooler's table (T3) or `runtime_ab_pair.py`'s (T9) in the campaign's own lane file,
* the reading in the document that owns the subject — `transport-conclusions.md` §1 for the
  controller, §2 for stream shape, `why-these-changes.md` §9 for the segment cap — with the
  decision rule's verdict stated as pass or fail, not as a narrative.

**Raw rows first, and no interpretation in the same commit as the data.**
