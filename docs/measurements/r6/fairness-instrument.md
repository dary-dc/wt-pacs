# Competing-flow fairness on the Oracle rig — what the instrument can and cannot pose

Moved out of `r6_fairness_cloud.sh`. The script carries the procedure; this carries why it
is shaped the way it is, and the four operational traps that each cost a run.

**The question.** `transport-conclusions.md` §1 names BBR's deployment risk as a claim about
a *neighbour*: quinn ships BBRv1, marked experimental, documented to take >90 % of a shallow
buffer from competing Cubic flows. Testing that needs two flows and **one shared bottleneck**.
`lab/netsim` gives every client its own pipe, so it cannot pose the question at all.

## What the rig permits

The Oracle VCN admits exactly two ports: **UDP 4435** and **TCP 22**. UDP 4436/4437 are open
in the host's iptables and blocked upstream at the VCN — verified by a QUIC handshake timing
out against a server confirmed listening. Two consequences:

- **Both QUIC flows share one server**, so both get that server's congestion controller.
  *QUIC-BBR against QUIC-Cubic is therefore not constructible here.*
- **The only other transport that reaches the rig is TCP on port 22**, which
  `cloud_netem_exact.sh` deliberately files into an unshaped band so shaping cannot lock the
  rig out. For the cross-protocol cells, and only those, that bypass is removed so ssh shares
  the bottleneck. A deadman timer on the rig restores the qdisc unconditionally after
  `DEADMAN_S` seconds — recovery does not depend on the network still working.

| cell | flows | what it is |
| --- | --- | --- |
| `qcubic_qcubic` | QUIC Cubic × 2 | self-fairness control, expect ~50/50 |
| `qbbr_qbbr` | QUIC BBR × 2 | does BBR share with itself? |
| `qcubic_tcp` | QUIC Cubic vs TCP Cubic | cross-protocol control |
| `qbbr_tcp` | QUIC BBR vs TCP Cubic | **the deployment risk from §1** |

## Four traps, each of which cost a run

**Queue depth matters more than any other knob.** The BBRv1 warning is specifically about a
*shallow* buffer. A 500-packet queue at 5 Mbps is 1.2 s of buffering — the case BBR handles
politely. `QUEUE=20` (~48 ms at 5 Mbps) is the case it is warned about.

**The deadman is addressed by PID file, never `pkill -f <name>`.** ssh hands the remote sshd a
command line that *contains* the pattern, so a pattern-matching `pkill` matches its own shell,
kills it, and ssh returns 255. That is how the first version both failed to arm the timer and
then died claiming success.

**`timeout` always exits 124 here.** The blob is 400 MB and the window is seconds, so being
cut off is the design. Under `set -o pipefail` that 124 becomes the pipeline's status and
`set -e` kills the subshell after the byte count is captured but before it is written — which
is precisely how six runs reported a competitor moving 0.00 Mbps. Swallow it in the pipeline.

**The TCP competitor needs its own non-multiplexed ssh.** The control channel is a
`ControlMaster` session; a bulk transfer down it shares one TCP flow with the orchestration,
which is not the flow being measured.

## The guard the experiment cannot run without

*Two flows, one bottleneck* is only a measurement if the bottleneck is **the one we
installed**. A residential path is not a constant: this link delivered 51 Mbps at the start of
a session and 9 Mbps three hours later, at which point a 20 Mbit netem cap was no longer
binding and both flows shared an *uncontrolled* bottleneck of unknown queue depth. The split
was still measurable and still meaningless.

**So: prove a single flow can reach the cap before putting two flows through it.**

## The known bias in the denominators

`a_window_s` and `b_window_s` are the spans each flow's rate was divided by, and **they are
not equal** — which is why both are recorded. The TCP flow is timed over a window starting
1.5 s late and ending 3 s early, so ssh connect time cannot inflate it, while the QUIC flow's
bytes are divided by its *configured* dwell. QUIC therefore runs unopposed at both ends of its
own denominator and overstates its share by a few points (adversarial review 2026-09-07, S2).

Equalising them needs the harness to emit its **measured** fill span —
[`../../proposals/product-code-changes.md`](../../proposals/product-code-changes.md) §2. Until
then the asymmetry is at least visible. It is far too small to manufacture the 99.4 %
starvation figure; it does move the modest "Cubic still takes 70–77 %" number.
