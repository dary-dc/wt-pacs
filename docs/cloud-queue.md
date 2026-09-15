# Cloud queue

A place to hand work to a cloud agent between sessions, and for it to hand results back.
`cloud-lanes-2026-09-14.md` holds the briefs; this holds the order and the state.

## Protocol

**You are the cloud agent.** After you finish a lane and push:

1. `git fetch && git rebase origin/claude/serene-rubin-wakfg7` — the queue changes while you work.
2. Read the table below. Take the **topmost row marked `ready`**.
3. Edit that row to `claimed` with the date, commit it alone, push it. That is the lock; if the
   push is rejected someone took it first, so rebase and take the next one.
4. Do the lane. Push your work.
5. Set the row to `done` with the commit, and **add anything you learned that changes another
   row** — a lane that is now pointless, a prerequisite that turned out missing. Push.
6. Go back to step 1. Stop when no row is `ready`, and say so in your final message rather than
   inventing work.

**Answering a question rather than running a lane.** A row may be a question, not a lane. Answer it
in `## Answers` below, push, mark it done. Keep it short — the asker has no other channel.

**Asking for something.** If a lane is blocked on a decision only the workstation can make, add a
row to `## Blocked` saying what you need, push, and move to the next `ready` row. Do not wait.

## Queue

| # | what | brief | state |
| --- | --- | --- | --- |
| 5 | **L2** — the BYOB frame-0 cost | lanes §L2 | **not for cloud** — workstation lane; browser timing, no VM needed |
| 6 | **L3** — a lossy, rate-limited link | lanes §L3 | **not for cloud** — workstation lane; drives the VM over ssh |
| 7 | **L7** — a regime where the read path misses | lanes §L7 | **not for cloud** — workstation lane; drives the VM over ssh |
| — | L4 a closed session is noticed | lanes §L4 | done `62cf243` |
| — | L5 the tail at SIGTERM | lanes §L5 | done `23bd447` |
| — | L6 idle sessions, and the pair | lanes §L6 | done `c69450a` |
| — | L11 dispatch measured; harness wiring **proposed, not built** | below | part done `ccf5317` |
| — | L1 decoder heaps | lanes §L1 | done `2ffc0aa` |
| — | L8 a decoder built from source | lanes §L8 | done `82a13d9` |
| — | L9 the conformance suite | lanes §L9 | done `4928b74` |
| — | L10 what telemetry costs | lanes §L10 | done `c0197d4` |

### L11 — decode in the harness

```
The harness does not decode: client/harness/index.html says "not clinical decode" and
shell.js touch() reads one byte per 4 KiB purely to make the copy real. That is why the
decode and pipeline questions have had no home here.

L8 built a decoder from source that is byte-identical to the package across 609 frames
and takes a 4 MB floor at 512x512. Use it. Wire a real decode path into the harness:
one pool, first-free dispatch (a free decoder takes the next frame; not round-robin),
sized from navigator.hardwareConcurrency rather than a constant.

Then measure the thing nobody has: first-free against round-robin, at equal width. It is
believed to matter when decode times are uneven and to be a wash when they are even. That
belief has never been tested in either direction. Uneven decode times are the device case,
so if it is a wash on uniform frames say so and then make them uneven — mixed sizes in one
pool — and measure again.

Report the per-frame split: time waiting for a decoder, time decoding, time for the page
to take it. They must sum to the total; a split that does not sum is not a split.

This is client-shape milestone M2 (docs/client-shape-plan.md). Structural: propose the
shape before implementing it.
```

## Answers

**`wasm-pack` cannot fetch `wasm-opt` in the cloud container** (2026-09-15, from L4). The build
compiles, then dies on `failed to download …/binaryen-version_117-x86_64-linux.tar.gz`. The URL is
reachable — `curl` gets 200 — so it is wasm-pack's own downloader not using the proxy, not an egress
block. Seeding its cache by hand works and costs a minute:

```bash
curl -sSL -o /tmp/b.tar.gz https://github.com/WebAssembly/binaryen/releases/download/version_117/binaryen-version_117-x86_64-linux.tar.gz
# the dirname is a hash of the URL; wasm-pack writes .<dirname>.lock before it downloads, so run
# build.sh once and read the name out of ~/.cache/.wasm-pack/
mkdir -p ~/.cache/.wasm-pack/wasm-opt-1ceaaea8b7b5f7e0
tar xzf /tmp/b.tar.gz -C ~/.cache/.wasm-pack/wasm-opt-1ceaaea8b7b5f7e0 --strip-components=1
```

It wants `<dirname>/bin/wasm-opt`. Any lane needing a WASM build per arm — **L2** — pays this first.
`rustwasm.github.io` is blocked by egress policy (403), so install wasm-pack with `cargo install
wasm-pack`, not the shell installer.

**The SIGTERM tail was not lost where L5's brief said** (2026-09-15). `sink.rs` already had
`flush_on_exit` and a test for it; the rows that went missing were never in the channel. A `Tap`
buffers up to 63 rows before sending a batch of 64, and a session still open when the signal lands
never drops its `Tap`. Fixed by sharing each session's buffer so the shutdown can take it. Worth
knowing for **L6**, which also reasons about what an open session holds.

**L11's premise did not hold, so its wiring is proposed rather than built** (2026-09-15).
first-free beats round-robin only on a *short* uneven queue, and only on batch time, and only with
one frame of lookahead; plain first-free — the thing the brief asked to wire — is worse than
round-robin almost everywhere. `docs/proposal-decode-in-the-harness.md` says what to build instead.
**Still open:** the harness decode arm itself, and the decision it waits on — whether it uses the
published decoder or the build from source, since the pool cap depends on the per-instance heap.

**The product's client cannot keep its own session alive** (2026-09-15, from L6). The WebTransport
API exposes no keep-alive knob, so the server is the only end that can hold a browser's session
open — `--keep-alive-interval-ms` now exists for that, off by default until
`docs/transport/adr-idle-sessions.md` is accepted. An idle held session costs ~75 KB of server
memory, linear to 2 000. Relevant to **L11**, which holds a session across a viewer's lifetime.

**A cancelled fill leaves its waiters armed until `FRAME_TIMEOUT_MS`** (from L4). `endStream()`
stops the server sending but settles nothing on the client, so the promises sit for 15 s. Not
fixed: it wants a decision about what a cancelled waiter should reject with. Relevant to **L11**,
which will cancel fills for real, and to L6's lifecycle work.

## Blocked

**The rig is not reachable from a cloud agent container** (2026-09-15). Rows 5, 6 and 7 — L2, L3 and
L7 — all say "needs the VM", and a cloud agent cannot get there:

* `~/.ssh/id_ed25519_rig_agent` is not present, and `~/.ssh` is empty. The key lives on the
  workstation; nothing puts it in this environment.
* Outbound traffic goes through an HTTPS proxy. A plain TCP connection to `168.138.130.163:22` does
  not open, so even with the key `ssh` would not reach it.

**Resolved from the workstation, 2026-09-15 — the rows are not blocked, only mis-routed.** Checked
there: port 22 on the rig is open, and both `~/.ssh/id_ed25519_rig` and `id_ed25519_rig_agent` are
present. So L2, L3 and L7 are workstation lanes, not cloud lanes, and the queue should stop
offering them. L2 needs no VM at all — it is a browser timing claim, and the workstation is the
timing rig every other number came from. Marked accordingly below; **a cloud agent should treat the
queue as empty** and say so rather than reaching for them.

The original diagnosis stands and is worth keeping: those three rows are `ready` in the sense that
their briefs are complete, and unworkable in the
sense that the only machine they can run on is not addressable from here. **What is needed:** either
the agent key placed in the cloud environment *and* egress to port 22 opened, or those lanes run
from the workstation. Nothing in this queue is a container lane any more — the four that were
(L4, L5, L6, L11) are done or, for L11, proposed with its measurement complete.
