# Task B — mild_cell timeout repro

Evidence: T2 attempt on this host.

## Result

**Did not run.** Gate: netem unavailable.

## Facts

- Command intended (from brief):

```bash
unshare --user --map-root-user --net -- bash
ip link set lo up
tc qdisc add dev lo root netem delay 30ms rate 10mbit
ping -c3 127.0.0.1
```

- Observed:

```text
$ tc qdisc add dev lo root netem delay 30ms rate 10mbit
Error: Specified qdisc kind is unknown.
```

- `modprobe` / `lsmod` not available in this environment (`sudo: modprobe: command not found`).
- After failed add, `tc qdisc show` reports `qdisc noqueue 0: dev lo root`.
- `ping -c 2 127.0.0.1` without netem: rtt min/avg/max/mdev = 0.036/0.037/0.039/0.001 ms (not ~60 ms).

Per standing rule: if a gate trips, stop and report. No mild_cell harness run was started. No substitute (`--rtt-ms`, no-netem localhost) was used.
