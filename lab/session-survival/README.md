# session-survival

How long a page sits frozen when the path its session is on goes away, and how long it sits with
the resumption `docs/proposal-session-survival.md` describes. The numbers live in that proposal
§The measurement, taken; this says how they were made.

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

**Three arms, same binary, same page.** `built` is the client as it is. `quick` is the same code
with `{ stallMs: 1000 }` — what the default wait costs, not a proposed default (it was `{ stallMs:
1000, probeMs: 800 }` while the client probed, before 2026-09-24).
`today` passes `survival: false` and does what a page could do without resumption: it re-asks for
what it is missing the moment the transport reports the fill gone. That is a **generous** baseline:
a real page today gets the frames named and the fill failed (`client/downloader/README.md`) and has
to do something about it; this one does the best possible thing instantly. Every round runs all
three, order rotated.

**The two numbers.** `noticed` is the wall-clock gap from the cut datagram to the moment something
acted on it — this client resuming, or, with resumption off, the transport failing the run. `first
frame` is the gap to the first frame the page receives after the cut, which is `noticed` plus a dial
and a frame. Latency, not throughput: the fill's rate before and after the cut is the link's
and says nothing about this. The host saturates well above 20 Mbit on loopback, so the rate is the
relay's and not the box's; what the box's load does reach is the dial and the decode, which this
arm does not run (`decode: false`).

**What it read, 2026-09-22, 7 rounds interleaved** (median [min … max] ms from the cut): `today`
noticed 6552 [6539 … 6558], `built` 5010 [4996 … 5023], `quick` 1816 [1803 … 1821]; first frame
after the cut 6745 / 5191 / 1996. Detection is `stallMs + probeMs`, the resume costs ~180 ms on top,
and `today` hands the page 68 failed frames a round where the other two hand it none. The reading
and what it corrects are `docs/proposal-session-survival.md` §The measurement, taken. Those are the
probe design's numbers; the client now decides by the bytes and notices the same cut at ~3 016 ms.

**[`cells.sh`](cells.sh)** (row 66) runs the page against its own server, relay and static host for
one cell — `cut`, `radio`, `blinks`, `slow` (700 kbit), `deep` (700 kbit behind a 4 s queue) or `asks`
(six frames asked at once on the slow link) — and puts `client/dev-transport.json` back after.
`run.mjs --no-cut` counts every resume as a false alarm, `--blink-every` blinks the relay, `--asks K`
asks instead of filling. Its readings are `docs/proposal-session-survival.md` §Detection by the
bytes.
