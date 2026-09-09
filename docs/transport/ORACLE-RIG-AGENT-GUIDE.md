# Running the transport campaigns on the Oracle rig — guide for a local agent

**Who this is for:** a Claude Code or Cursor session running **on a laptop or any machine
with ordinary outbound internet**. Not a cloud agent container — see "Why not from a cloud
agent" below, and run the preflight before doing anything else.

**One command decides whether you can proceed:**

```bash
lab/transport/scripts/cloud_preflight.sh
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
lab/transport/scripts/cloud_preflight.sh

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
cargo build --release --workspace
bash lab/transport/scripts/quinn_lab_build.sh 10 32        # target/lab-arms/exact-server-seg{10,32}
```

For R6 you do **not** need `deploy_exact_server_cloud.sh`: the `*_cloud.sh` scripts upload
`target/lab-arms/exact-server-seg10` and the fixture themselves, and restart the server with
each arm's flags. `deploy_exact_server_cloud.sh` ships `target/release/exact-server` and the
250 KB *live* fixture, which is a different experiment.

The `frames_500x64k` / `frames_500x250k` fixtures are gitignored — regenerate them before a
first run (`lab/fixtures/frames_500x250k/README.md` records the generator).

### 2 · Shape the path with the real kernel, not the simulator

```bash
lab/transport/scripts/cloud_netem_exact.sh 25 20 0.1    # one-way delay ms, rate Mbps, loss %
```

**Not `cloud_netem.sh`.** That script takes a named *profile* (`20|30|50|60|90|150|180`)
with its delay and rate baked in, and it shapes **whatever machine it is run on** — invoked
locally as `cloud_netem.sh 25 20 0.1` it parses `25` as an unknown profile and exits 1,
having first deleted your laptop's root qdisc. `cloud_netem_exact.sh` is the
explicit-parameter version, runs on the rig, and is pushed there for you by the `*_cloud.sh`
scripts below.

The rig exists *because* `sch_netem` loads on a VM and not in a container. Use it.
`lab/transport/netsim` is the userspace fallback and it forwards datagram-by-datagram, which destroys
send-side GSO batching — **no CPU or throughput number may pass through netsim.**

**But netem has a defect of its own, and it bites exactly this campaign.** It draws loss
**once per GSO batch, not per datagram**, and the batch size depends on the sender — a
shared stream packs ~6.9 datagrams per batch where per-frame streams pack ~4.3, so at equal
bytes the shared arm absorbs ~1.5× fewer congestion events. Any loss cell comparing stream
shapes must therefore also be run with the server started
`--segmentation-offload false`, which forces batch = 1. Measured and quantified in
[`measurements/r6/r6cloud-results.md`](measurements/r6/r6cloud-results.md) §3.2.

### 3 · Prove the instrument works on this path

```bash
DELAY=25 RATE=20 LOSS=0.1 lab/transport/scripts/e0_r6_reader_validate_cloud.sh
```

**Note the `_cloud` suffix, here and below.** `e0_r6_reader_validate.sh`,
`e0_r6_calibrate.sh` and `r6_campaign.sh` are localhost + `lab/transport/netsim` only: they start
`exact-server` on `127.0.0.1` and shape with `target/release/netsim`. Running them on this
machine measures the simulator and reports it as a real-path result. The `*_cloud.sh`
variants beside them run the server on the rig behind `sch_netem`.

Require: `closed` strands **0** bytes and `open` strands a large non-zero figure. This also
doubles as the authoritative UDP test — if the harness completes a run, QUIC reached the
rig.

**If open mode does not strand on the real path, stop.** The reader is not outrunning the
transport there, and no arm comparison is admissible.

### 4 · Re-calibrate the operating point — the netsim numbers will be wrong

The step-scales baked into `r6_campaign.sh` were fitted to `netsim`'s achievable rate. A
real path has a different one.

```bash
DELAY=25 RATE=20 LOSS=0.1 SCALES="1 2 4 8" lab/transport/scripts/e0_r6_calibrate_cloud.sh
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

**Then re-check the chosen scale under the campaign's own loss realisations:**

```bash
DELAY=25 RATE=20 LOSS=0.1 SCALES="<chosen>" REPS=3 lab/transport/scripts/e0_r6_calibrate_cloud.sh
```

`sch_netem` has **no seed** — its loss comes from kernel randomness, so every run is already
an independent realisation and `SEED=` has no analogue here. The guard survives the
translation: re-run the chosen scale N times and require the band to hold in *every*
repetition. Add `CONTROL=1` for N0, whose passing condition is `stranded == 0`.

This step is not optional and is not theoretical: calibrating on one seed passed cleanly,
then **voided 4 of 9 rows** on the campaign's own seeds. See
[`measurements/r6/E0-validation.md`](measurements/r6/E0-validation.md) §E0-R6c, and
`measurements/r6/r6scrub_scale6_VOIDED.tsv`, which is committed as the evidence.

### 5 · Run, analyse, review

```bash
EXP=r6cloud CELLS="X1 X2 X3 N0" lab/transport/scripts/r6_campaign_cloud.sh 3
python3 lab/transport/scripts/r6_analyse.py .local/measurements/r6/r6cloud.tsv
python3 lab/transport/scripts/r6_adversarial_checks.py .local/measurements/r6/r6cloud.tsv
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
