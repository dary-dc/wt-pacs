# session-survival

How long a page sits frozen when the path its session is on goes away, and how long it sits with
the resumption `docs/proposal-session-survival.md` describes. The numbers live in that proposal
§The measurement this owes; this says how they were made.

```bash
./server/scripts/gen_dev_cert.sh                      # then point wt_url at the relay, below
cargo run --release -p exact-server -- --port 4482 --study <study>.sbnd \
  --max-idle-timeout-ms 60000 --keep-alive-interval-ms 20000
python3 lab/scripts/link_impair.py --udp 5582:4482 --rate-kbit 20000 --queue-pkts 200 \
  --control-port 5583
python3 server/dev-server.py --port 8792
NODE_PATH=$(npm root -g) node lab/session-survival/run.mjs --rounds 7 --out cut.jsonl
```

`client/dev-transport.json` must name the relay, not the server: `"wt_url":
"https://127.0.0.1:5582/"`. The study is any packed study whose fill outlasts the cut — 87 frames
of 428 KB at 20 Mbit is about 15 s, which leaves room to cut a fifth of the way in.

**The cut.** `link_impair.py`'s `cut` blackholes the client port this session is on for good and
rebinds its own upstream port, so the server's half of that session goes nowhere either; a session
dialled from a new port is untouched. That is a handover modelled on one host: the old path is
gone, a new one works, and **nothing tells the client** — no close, no reset, no error. A
`blackout` is not this: the same path comes back, and QUIC recovers by itself without anything
here doing a thing.

**The two arms, same binary, same page.** `built` is the client as it is. `today` passes
`survival: false` and does what a page could do without resumption: it re-asks for what it is
missing once the transport reports the fill gone — which happens at the browser's idle timeout and
not before. Every round runs both, order rotated.

**What the number is.** The wall-clock gap from the cut datagram to the first frame the page
receives after it. Latency, not throughput: the fill's rate before and after the cut is the link's
and says nothing about this. The host saturates well above 20 Mbit on loopback, so the rate is the
relay's and not the box's; what the box's load does reach is the dial and the decode, which this
arm does not run (`decode: false`).
