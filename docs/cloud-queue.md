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

**Rows that wait.** `after N` becomes `ready` when row N is done; the agent that marks N done
flips it in the same commit.

**Code rows (D1–D4)** follow `docs/proposal-downloader.md` and push code to the agent's own
branch, never to this one; this branch gets only the queue update, with the branch name in the
row. If the design turns out wrong, stop and say why in `## Blocked` rather than building a
different shape.

**Answering a question rather than running a lane.** A row may be a question, not a lane. Answer it
in `## Answers` below, push, mark it done. Keep it short — the asker has no other channel.

**Asking for something.** If a lane is blocked on a decision only the workstation can make, add a
row to `## Blocked` saying what you need, push, and move to the next `ready` row. Do not wait.

## Queue

| # | what | brief | state |
| --- | --- | --- | --- |
| 8 | **L12** — the whole gate on this branch | lanes §L12 | **done** — gate green; the WASM arm is a decision, see §Blocked |
| 15 | **D1** — the downloader's capabilities, tested on today's path | proposal-downloader §S1 | **done** `7a21ab3` on `claude/downloader-s1-capabilities` — 3 rows not green, see below |
| 16 | **D2** — the downloader, beside today's path | proposal-downloader §S2 | ready |
| 17 | **D3** — fills pushed, both clients | proposal-downloader §S3 | after 16 |
| 18 | **D4** — validation and metrics | proposal-downloader §S4 | after 17 |
| 9 | **L13** — what a thread hop costs a frame | lanes §L13 | **done** `3cd29fd` — `docs/thread-hops.md` |
| 10 | **L14** — what retained frames cost in memory | lanes §L14 | **done** `dfbd4e8` — `docs/decode/README.md` §Retention |
| 11 | **L15** — how long an idle browser session survives | lanes §L15 | ready |
| 12 | **L16** — whether an ask can overtake a running fill | lanes §L16 | ready |
| 13 | **L17** — a faster decoder, byte for byte | lanes §L17 | ready |
| 14 | **L18** — what the BYOB read path allocates | lanes §L18 | ready |
| 5 | **L2** — the BYOB frame-0 cost | lanes §L2 | **part done on the workstation** 2026-09-15: reader acquisition eliminated; module warm-up untested |
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

**The redesign is queued** (2026-09-16) as D1–D4: `docs/proposal-downloader.md`, approved for
investigation. It replaces the harness decode arm L11 proposed. D1 comes before any code, because
the proposal is adopted only if nothing today's path can do is lost. **Still held:** a bounded
fill window, the cache seam, paint.

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

*Confirmed verbatim 2026-09-16 (L12), and the hash above is stable — seeding
`wasm-opt-1ceaaea8b7b5f7e0` by hand first meant `build.sh` never attempted the download.* Two
prerequisites the recipe does not mention, both missing in a fresh container: `cargo install
wasm-pack` ≈ 2 min, and `rustup target add wasm32-unknown-unknown` ≈ 3 s. The pkg build itself is
then 1 m 41 s, most of it `wasm-pack` compiling its own `wasm-bindgen-cli`.

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

**The gate passes end to end on this branch** (2026-09-16, from L12). `GATE OK`, no step failed,
nothing needed fixing. **10.2 s warm, ≈2 m 33 s cold**, the cold figure almost entirely two builds:
the default-feature test build (40 s) and the `release` build the server absence check needs (75 s).
Every later row pushes here, so run `scripts/gate.sh` before pushing — it is cheap, and it is now
known to catch things: four deliberate breakages were caught, one of them undoing L4's fix and
taking the whole gate down with it. Per-step timings and the mutation table:
[`improvements/2026-09-16.md`](improvements/2026-09-16.md). Two caveats for rows 8–14: the gate
covers **one arm of two** unless the WASM pkg is built first (see §Blocked), and a fresh container
has no `node_modules` — `client/transport-ts/build.sh` runs `npm install` itself, 1.9 s.

**A copy costs far more than a hop** (2026-09-16, from L13). The relay through the receive worker
is ~0.1–0.2 ms while that worker is quiet; a *cloned* 8 MB frame costs the page's main thread
**1.34 s per 237-frame burst against 17 ms transferred**. Anything downstream that moves frames
between threads should list the buffer, and **L14** should read this first: its arrangement 1
(copied out to a plain ArrayBuffer) is this repo's default and the expensive arm here, so L14's
memory answer and this latency answer may point the same way or oppose each other — say which.

**Two cautions for any browser lane here** (from L13). `performance.now()` is **5 µs** under
cross-origin isolation, so a one-tick difference is quantisation, not a finding — this nearly
produced two wrong answers in L13. And each context has its own `performance.timeOrigin` (48.8 ms
apart here), so only `timeOrigin + now()` compares across threads. **L18** counts allocations
rather than time and is not exposed to either, but **L14** and **L15** are.

**Headless Chromium works in this container, with two fixes** (2026-09-16, from L13).
`npm install -g playwright` (1.9 s) then `NODE_PATH="$(npm root -g)"`; its pinned build (1243) is
not the one installed (1194), so pass
`executablePath=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` — `lab/thread-hops/run.mjs`
reads it from `CHROME_PATH`. `server/dev-server.py` already sends COOP/COEP, so
`crossOriginIsolated` is true and `SharedArrayBuffer` works. Chromium reaches for
`www.google.com` on start-up and the proxy denies it; harmless, silenced with
`--disable-background-networking`. This clears the way for **L14**, **L15** and **L18**.

**Keeping frames in the decoder's heap is worse than copying them out** (2026-09-16, from L14),
which is the reverse of what `docs/decode/README.md` assumed, and the wrong expectation is
corrected there. 108 MB against 517 for 87 × 768 KB; 217 against 1081 for 237 × 512 KB; 939
against 2042 for 64 × 8 MB. Two reasons, neither the pixels: a retained decoder holds its
codestream as well as its pixels, and **a WASM heap never shrinks**, so it keeps its high-water
mark and every transient along with it. This is the memory half of L13's latency answer and they
agree: **copy the pixels out, transfer the buffer, do not hand out a heap view.**

**L8's 4 MB floor is right only if the pixels leave the heap** (from L14). Copying out, it
reproduces the ladder exactly (4.0 MB at 512×512, 24.6 MB at 2048×2048). Retaining in it, it is
the *worst* build measured — 4.6–5.1× what it holds, against the package's 1.0–1.2×. **L17** tunes
that build and should not change the floor without saying which of the two it is optimising.

**`measureUserAgentSpecificMemory()` works headless and costs 10–16 s a call unless you ask
otherwise** (from L14). `--enable-blink-features=ForceEagerMeasureMemory` takes it to ~15 ms with
no loss of accuracy (checked: ±256 MB in a worker, and it still collects before counting). It
counts WASM heaps, plain `ArrayBuffer`s and `SharedArrayBuffer`s on one scale, in workers, with
per-realm attribution — so **L18** can use it for its heap high-water rather than only `--trace-gc`.
Also: the source build exports no `Module.HEAPU8`; use a `typed_memory_view`'s buffer instead,
which measures either build identically.

**D1 is done and three capability rows are not green** (2026-09-16), on
`claude/downloader-s1-capabilities`. The conformance suite goes 34 → **58 checks, both arms**, with
four clauses added and mutation-checked: both stream modes, `stats`, an ask long after the dial,
and a re-dial after closure. §Capabilities' middle column is filled there. What is not green, all
of it pre-existing rather than the downloader's doing:

* **refusals** — a browser page (`client/harness/refusals.html`), no gate test, so the row rests on
  a manual step;
* **an ask during a fill** — proven on the server, nowhere on the client. **L16** measures what it
  costs and could leave the client assertion behind it;
* **16-bit signed** — see §Blocked.

Also fixed there, found by one of the mutants: `transferable` awaited its frames raw, so a
shared-mode regression **took the whole suite down at `FRAME_TIMEOUT_MS` with nothing counted**
instead of reporting. Every frame wait is bounded now. Worth knowing for **D3**, which changes how
a fill's frames are delivered and will lean on exactly these clauses.

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
timing rig every other number came from. Marked accordingly in the queue; a
cloud agent skips them.

The original diagnosis stands and is worth keeping: those three rows are `ready` in the sense that
their briefs are complete, and unworkable in the
sense that the only machine they can run on is not addressable from here. **What is needed:** either
the agent key placed in the cloud environment *and* egress to port 22 opened, or those lanes run
from the workstation. Nothing in this queue is a container lane any more — the four that were
(L4, L5, L6, L11) are done or, for L11, proposed with its measurement complete. Rows 8–14, queued
2026-09-16, are container lanes again.

**Should the gate hard-require the WASM arm?** (2026-09-16, from L12). `scripts/gate.sh` passes
and prints `GATE OK` with the WASM client unchecked, because both client steps test that arm only
if `client/transport-wasm/pkg/` already exists and the gate never builds it. Conformance is
**17/17 over one implementation** instead of 34/34 over two; the worker-safe check reads one
artifact instead of two — and the WASM clock is the bug that check was written for (`3396c28`).
Evidence and both outputs: [`improvements/2026-09-16.md` §2](improvements/2026-09-16.md).

**What is needed — a decision, because it is contributor-facing, not a local fix.** Building the
pkg costs 1 m 41 s here, against a 2½-minute cold gate and 10 s warm, and makes `wasm-pack`,
`wasm-opt` and the `wasm32-unknown-unknown` target hard prerequisites the README does not yet name
(T6). Three ways, cheapest first:

* leave it, and have the gate say loudly at the end that it ran at half strength;
* fail the gate when `pkg/` is absent, so the arm is skipped only by deleting it deliberately;
* build the pkg in the gate, and pay it on every cold run.

A cloud agent can implement any of the three in minutes once the workstation picks one.

**No signed fixture can be made with the encoder in this tree** (2026-09-16, from D1), so the
capability row "16-bit signed with sign extension" cannot be tested at all — and signed 16-bit is
ordinary medical data, so this is a real hole rather than a formality. `lab/scripts/gen_htj2k_fixtures.sh`
has no signed mode, and `ojph_compress -signed true` over its raw reader does not survive its own
`ojph_expand`: every negative sample saturates to the bottom of the range, at 12- and 16-bit alike,
with in-range data. So there is no ground truth, and **D1 makes no claim about how either decoder
handles signed data**.

What is measurable without ground truth, and is worth someone's attention: **the package build and
`lab/decode-bench/wasm` disagree on the same signed codestream** — the package saturates every
negative sample to 32767, the source build does not. `parity.mjs`'s byte-identical result therefore
covers unsigned data only, which qualifies **L8**'s parity claim and bears on **L17**, which tunes
that build against it.

**What is needed:** a signed HTJ2K fixture from a source other than this encoder path — another
encoder, or a known-good file with its expected samples — plus a decision on whether the product
serves signed data at all. Until then the row stays red and `parity.mjs` should say what it covers.
