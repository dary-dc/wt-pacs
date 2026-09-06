# R6 on the Oracle rig — why it did not run here, and how to run it there

The intent was to repeat R6 over a real network path rather than a userspace simulator.
**It could not run from this agent container.** This document records what was established
about that, and gives the exact commands to execute the campaign from a host with ordinary
outbound access.

---

## What was established, by testing rather than assumption

The container's outbound access goes through a policy-enforcing egress proxy
(`HTTPS_PROXY`, CA bundle at `/root/.ccr/ca-bundle.crt`).

| target | result |
| ------ | ------ |
| direct TCP to `168.138.130.163:22` | connection timed out |
| direct TCP to `168.138.130.163:4435` | connection timed out |
| proxy `CONNECT` to `:443` | **403 Forbidden** — egress policy denial, recorded proxy-side as `connect_rejected` |
| UDP to the rig | not established — see below |

The proxy's own documentation lists what it does not carry: *"gRPC / HTTP2-only APIs,
WebSocket upgrades, client-mTLS, certificate-pinned clients, **non-443 HTTPS ports, raw-TCP
databases**"*, with the instruction to report rather than work around. SSH is raw TCP;
QUIC is UDP. Neither is carried.

**The UDP question is the decisive one and it is not close.** Even with an SSH tunnel, a
WebTransport client in this container must reach the server over **UDP**. An HTTP `CONNECT`
proxy tunnels TCP only. There is no configuration of this environment in which QUIC
datagrams reach an external host.

So the Oracle leg is blocked on network policy, not on credentials or on the rig.

### The key itself

The provided cloud-agent key was installed at `~/.ssh/id_ed25519_rig_agent`, mode `600`,
**outside the repository**, and its fingerprint verified against
[`../../cloud-rig-access.md`](../../cloud-rig-access.md):

```
SHA256:CAD0bvPh5zni9qJ5mZhO3UUr+1Fwg7ZMS70O4blE90g  wt-pacs-cloud-agent-2026-08-29
```

It matches the documented cloud-agent row. It was never written into the repository, never
echoed to a terminal, and never committed — `git grep` for private-key material returns only
the pre-existing `server/dev-cert/key.pem`. The container is ephemeral, so the copy goes
away with it.

Per that document's own policy — *"a deauthorized key is inert but should not linger in
someone else's environment"* — this key was exposed in a chat transcript and **should be
rotated**, on the same reasoning that retired the previous one. It should be treated as
compromised regardless of whether it was ever used.

---

## What the real path would have added, and what it would not

Worth being precise, because it changes what the missing leg costs.

**It would have added** what `netsim` cannot model at all: real queueing and AQM at real
routers, ECN if the path marks, real MTU and PMTU behaviour, real cross-traffic, and
scheduling jitter from a kernel under real load. Audit items A7, A8 and A12.

**It would not have added** the thing that most limits R6. Both endpoints are datacentre
grade. The characteristics that dominate a radiologist on a tablet — handovers, fading,
bandwidth that changes by an order of magnitude mid-scroll (A1–A3) — live at the *client's*
radio edge and are absent from an Oracle-to-container path. A real server is not a real
mobile link.

**And it would not have fixed the defect this lane exists to correct**, because that defect
was in the client. A closed-loop reader suppresses head-of-line blocking over a real
network exactly as thoroughly as over a simulated one. That fix (`--reader-mode open`) is
in the harness and applies to both.

---

## Runbook — executing R6 on the rig

From a host with ordinary outbound access. `lab/scripts/cloud_common.sh` already carries
the host, user and port.

```bash
export SSH_KEY=~/.ssh/id_ed25519_rig_agent      # or the human key, per cloud-rig-access.md
ssh -i "$SSH_KEY" ubuntu@168.138.130.163 'uname -r; nproc'
```

### 1 · Build and deploy

```bash
lab/scripts/deploy_exact_server_cloud.sh          # builds and ships exact-server
cargo build --release -p window-harness           # client runs locally
```

### 2 · Shape the path on the server, not in userspace

The rig exists because `sch_netem` loads on a VM but not in an agent container. Use it —
`netsim` is a userspace fallback and destroys GSO batching:

```bash
lab/scripts/cloud_netem.sh 25 20 0.1     # one-way delay ms, rate Mbps, loss %
```

### 3 · Validate the instrument before comparing anything

**Do not skip this.** It is the check whose absence invalidated four campaigns.

```bash
DELAY=25 RATE=20 LOSS=0.1 lab/scripts/e0_r6_reader_validate.sh
```

Require: `closed` strands **0** bytes and `open` strands a large non-zero figure. If open
mode does not strand on the real path, stop — the reader is not outrunning the transport
there and no arm comparison is admissible.

### 4 · Recalibrate the operating point — do not reuse the netsim scales

The step-scales baked into `r6_campaign.sh` were calibrated against `netsim`'s achievable
rate. A real path has a different one, so they will be wrong.

```bash
DELAY=25 RATE=20 LOSS=0.1 SCALES="1 2 4 8" lab/scripts/e0_r6_calibrate.sh
```

Take the scale meeting the pre-registered band — `center_asks_dropped == 0`,
`stranded_frames > 0`, `censored_frac <= 0.25`, `nz_n >= 30` — calibrating **on the shared
arm only**, then freeze it across arms and edit `cell_params` accordingly.

### 5 · Run, analyse, review

```bash
EXP=r6cloud CELLS="X1 X2 X3 N0" lab/scripts/r6_campaign.sh 3
python3 lab/scripts/r6_analyse.py .local/measurements/r6/r6cloud.tsv
```

Then the same three gates this campaign used: N0 must show no separation; VOID rows are
kept and reported; adversarial review before any conclusion is written.

### 6 · What a real path can additionally answer

Worth adding once the above reproduces, since these are `netsim`'s hard limits:

- **CPU per byte and throughput.** `netsim` voids these by construction; the rig does not.
  This is where the GSO segment-cap finding (+17 % throughput, −21 % CPU/byte) should be
  confirmed on real hardware.
- **Competing-flow fairness.** The main BBR deployment risk, and unmeasured everywhere in
  this project. Run a second flow against the same bottleneck and measure what each gets.
- **ECN and AQM**, if the path marks.
