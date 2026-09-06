# Running the transport campaigns on the Oracle rig — guide for a local agent

**Who this is for:** a Claude Code or Cursor session running **on a laptop or any machine
with ordinary outbound internet**. Not a cloud agent container — see "Why not from a cloud
agent" below, and run the preflight before doing anything else.

**One command decides whether you can proceed:**

```bash
lab/scripts/cloud_preflight.sh
```

If it says `PREFLIGHT FAILED` on TCP:22, **stop**. You are in the wrong environment, not
misconfigured, and nothing downstream will work.

---

## Why not from a cloud agent

A cloud agent container's outbound traffic goes through an HTTPS `CONNECT` proxy. That
proxy carries **neither raw TCP nor UDP**. Two consequences, both established by testing
rather than assumed:

- SSH to the rig times out; `CONNECT` to :443 is refused by egress policy.
- **QUIC is UDP, so the measurement itself cannot reach the rig** — and an SSH tunnel would
  not help, because `CONNECT` tunnels TCP only.

This is not a limit worth working around. Run from a machine with normal internet.

---

## Setup, once

```bash
# 1 · the key — outside the repository, mode 600. NEVER commit it.
#     Get it from whoever administers the rig; verify the fingerprint against
#     docs/cloud-rig-access.md before use.
install -m 600 /path/to/rig_key ~/.ssh/id_ed25519_rig_agent
ssh-keygen -lf ~/.ssh/id_ed25519_rig_agent     # cross-check this fingerprint

# 2 · preflight
lab/scripts/cloud_preflight.sh

# 3 · build locally; the harness runs on YOUR machine, the server on the rig
cargo build --release --workspace
```

Host, user and port live in `lab/scripts/cloud_common.sh` and are overridable by
environment (`CLOUD_HOST`, `CLOUD_USER`, `CLOUD_PORT`, `SSH_KEY`).

---

## The rule that matters more than any command

**Do not run an arm comparison until the rig has proved it can produce the effect you are
comparing.**

This project has invalidated its own conclusions five times, always the same way: *a guard
was checked once and then assumed to hold*. The most expensive instance ran four campaigns
on a client that made head-of-line blocking structurally impossible — the rig strands
**0.00 MB** with the closed-loop reader and **18.31 MB** with the open-loop one, in the same
cell, with the same server.

So the order below is not bureaucracy. Steps 3 and 4 are the campaign.

---

## Running a campaign

### 1 · Deploy the server

```bash
lab/scripts/deploy_exact_server_cloud.sh
```

### 2 · Shape the path with the real kernel, not the simulator

```bash
lab/scripts/cloud_netem.sh 25 20 0.1     # one-way delay ms, rate Mbps, loss %
```

The rig exists *because* `sch_netem` loads on a VM and not in a container. Use it.
`lab/netsim` is the userspace fallback and it forwards datagram-by-datagram, which destroys
send-side GSO batching — **no CPU or throughput number may pass through netsim.**

### 3 · Prove the instrument works on this path

```bash
DELAY=25 RATE=20 LOSS=0.1 lab/scripts/e0_r6_reader_validate.sh
```

Require: `closed` strands **0** bytes and `open` strands a large non-zero figure. This also
doubles as the authoritative UDP test — if the harness completes a run, QUIC reached the
rig.

**If open mode does not strand on the real path, stop.** The reader is not outrunning the
transport there, and no arm comparison is admissible.

### 4 · Re-calibrate the operating point — the netsim numbers will be wrong

The step-scales baked into `r6_campaign.sh` were fitted to `netsim`'s achievable rate. A
real path has a different one.

```bash
DELAY=25 RATE=20 LOSS=0.1 SCALES="1 2 4 8" lab/scripts/e0_r6_calibrate.sh
```

Admissible band, fixed before any arm runs:

```
center_asks_dropped == 0        the frame being measured was always actually asked for
stranded_frames     >  0        something arrived the reader no longer wanted
censored_frac       <= 0.25     the arm did not simply collapse
nz_n                >= 30       there is a tail to take a percentile of
```

Calibrate on the **incumbent arm only** (`shared`), then **freeze** the scale across all
arms — tuning it per-arm lets the rig be shaped to fit whichever answer starts looking
right.

**Then re-check the chosen scale at every seed the campaign will use:**

```bash
for R in 1 2 3; do
  SEED=$((R*7919+13)) SCALES="<chosen>" lab/scripts/e0_r6_calibrate.sh
done
```

This step is not optional and is not theoretical: calibrating on one seed passed cleanly,
then **voided 4 of 9 rows** on the campaign's own seeds. See
[`measurements/r6/E0-validation.md`](measurements/r6/E0-validation.md) §E0-R6c, and
`measurements/r6/r6scrub_scale6_VOIDED.tsv`, which is committed as the evidence.

### 5 · Run, analyse, review

```bash
EXP=r6cloud CELLS="X1 X2 X3 N0" lab/scripts/r6_campaign.sh 3
python3 lab/scripts/r6_analyse.py .local/measurements/r6/r6cloud.tsv
```

Three gates before any conclusion is written:

1. **N0 must not separate** for `shared` vs `perframe_fifo`. If it does, the rig is
   measuring something other than what it claims and the campaign is void — not adjusted,
   **void**. (N0 *is* expected to separate for `perframe_fair`; that arm's control is known
   invalid — [`measurements/r6/adversarial-review.md`](measurements/r6/adversarial-review.md) §3.1.)
2. **VOID rows are kept and reported**, never deleted. Failures are systematically the
   slowest runs, so dropping them flatters whichever arm fails. This project has already
   biased one result exactly that way.
3. **Adversarial review before the conclusion is written** — hand a reviewer the data and
   the pre-registration and ask them to break the reading, not confirm it.

---

## What the rig can answer that the simulator cannot

Worth running here specifically, because these are `netsim`'s hard limits:

| question | why the rig |
| -------- | ----------- |
| **CPU per byte, throughput** | netsim voids these by construction. This is where the GSO segment-cap finding (+17 % throughput, −21 % CPU/byte) should be confirmed on real hardware. |
| **Competing-flow fairness** | The main BBR deployment risk, unmeasured everywhere in this project. Two flows, one bottleneck, measure the split. |
| **Real queues, AQM, ECN** | netsim has one drop-tail depth and no marking. |
| **Real MTU / PMTUD behaviour** | netsim does not model it. |

## What the rig still cannot answer

Both endpoints are datacentre grade. **Handovers, fading, and bandwidth that changes by an
order of magnitude mid-scroll live at the client's radio edge**, and an Oracle-to-laptop
path has none of them. For those you need a real device on a real mobile link
([`transport-assumption-audit.md`](transport-assumption-audit.md) A1–A3).

---

## Where to read the results this replaces

| document | what |
| -------- | ---- |
| [`transport-conclusions.md`](transport-conclusions.md) | the answers, and their confidence |
| [`lanes/R6-preregistration.md`](lanes/R6-preregistration.md) | hypotheses and decision rules, fixed before running |
| [`measurements/r6/`](measurements/r6/) | data, instrument validation, adversarial review |
| [`measurements/r6/oracle-runbook.md`](measurements/r6/oracle-runbook.md) | the long-form version of this guide |
| [`lanes/L1-R6-convergence.md`](lanes/L1-R6-convergence.md) | how the two lanes on this branch relate |

## Key hygiene

The rig key is a credential. Keep it outside the repository, mode 600, and never paste it
into a chat, an issue, or a commit. A key that has been exposed in a transcript should be
**rotated**, whether or not it was used.
