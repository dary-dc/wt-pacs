# Cloud queue

**Closed 2026-10-02 at `6e9c126`; reopened 2026-10-03 for row 112 alone.** Every finding lives in the doc that owns its subject (the index is
`README.md` §Docs). The rows' briefs and cells are in the history before the commit that closed the
queue: `git show 6e9c126:docs/cloud-queue.md`.

## Protocol

Kept so the queue can reopen. The queue lives on the branch that carries every lab improvement.

1. `git fetch && git rebase` onto that branch — the queue changes while you work.
2. Take the **topmost row marked `ready`**; the table is in priority order, not number order.
3. Edit it to `claimed` with the date, commit that alone and push. **The claim commit is the lock**: if
   the push is rejected someone took it first, so rebase and take the next one.
4. Do the lane and push it. Set the row to `done` with the commit hash after the rebase that pushed
   it, plus anything that changes another row. `after N` rows become `ready` in the commit that marks
   N done. Stop when no row is `ready`.

Answer a question in the doc that owns the subject, and mark the row done with one line saying where.
A lane blocked on a decision only the owner can make adds a line under §Open owner decisions and moves
on.

**What a row may not change** (the owner, 2026-09-18): the final image is bit-exact, always, and the
comparison's content and encode settings are fixed. A lever may change *when* bytes arrive or *what is
shown first*, as long as every frame ends bit-exact; a row that would change the content, or moves no
figure the comparison reports, is not queued.

**A commit message holds the change and nothing else** — no attribution or trailers. **This
repository is public**: never name another implementation or any part of its stack, in code, docs,
file names, branch names or commit messages.

## Queue

| # | what | state |
| --- | --- | --- |
| 112 | **DEPLOY** — make `deploy/` build and run, and prove it (§Row 112) | **claimed** 2026-10-03 |
| 59 | **A1b** — the handover on a device: does a session survive Wi-Fi → cellular, and how long is the freeze ([`ARCHITECTURE.md`](ARCHITECTURE.md) §What this means for the stack choice) | **waiting on a device** — no container can take it |
| 40 | **E1** — the ingest format | **held** by the owner (§What a row may not change) |

### Row 112

Opened 2026-10-03 by the owner's ruling: keep `deploy/` and make it work. The nginx template is verified
(`deploy/check_equivalence.sh --local`); the image and the compose file have never been built, and a review
found them broken. Fix, then **build both targets and start them once** before claiming they work; if no
container runtime is available in your environment, say "not built" in the row and in `deploy/README.md`
rather than claiming it.

* **The image build** (`deploy/Containerfile:9-17`): `patched/`, `patches/` and `scripts/patch_crate.sh`
  are not copied, so the `[patch.crates-io]` build fails. Copy them. Add a `.containerignore` (`target/`,
  `**/node_modules`, `lab/fixtures`, `.local`, `.git`) — today the context ships `target/` and
  `node_modules`. On a fresh clone the web image has no built client bundles: build them in the image or
  say what must be built first.
* **compose** (`deploy/compose.yml:10,12`, `Containerfile:23`): `--study` gets a study name, but the server
  wants a `.sbnd` path; the cert defaults are relative paths that exist nowhere in the image; `--websocket`
  is missing; the WebSocket is TCP on 4433, not 4434. Pass `--study /fixtures/$S/$S.sbnd --cert-pem
  /certs/cert.pem --key-pem /certs/key.pem --websocket`, mount the dev cert directory read-only at `/certs`,
  publish UDP and TCP 4433.
* **`check_equivalence.sh`** (`:54`, README `:8`): the script runs the image tagged `:check`, the README builds
  `:latest` — take `IMAGE=${IMAGE:-localhost/wt-pacs-web:latest}`. It also "skips" a named PEM that does not
  exist and passes (`:15-16,27,31,63`): return 1 when `--cert` or `CERT_PEM` was given explicitly, and mutate it.
* **The WASM telemetry alias** (`deploy/README.md:53`, `deploy/nginx/wt-pacs.conf.template:61`): the
  `pkg-telemetry` build is being removed from the client; drop the alias and its mentions here.

Done means: `check_equivalence.sh --local` passes; `--cert /nope.pem` exits 1; both targets build; `compose
up` starts both, the server prints `wt_url=`, the page loads, and TCP 4433 answers; `deploy/README.md`
runs as written from a fresh clone. Touch only `deploy/` and a new `.containerignore` — other trees are
being changed at the same time on the workstation.

## Finished

One line a batch; what each found is in the doc named.

* **Rows 1–14** (2026-09-14 to 16): the gate, thread hops, retained memory, idle sessions, an ask overtaking a fill, a faster decoder, the WASM BYOB path (retired) — `decode/README.md`, `ARCHITECTURE.md`, `transport/adr-idle-sessions.md`, `WIRE.md` §An ask during a fill.
* **Rows 15–26** (2026-09-16 to 18): the downloader, its capabilities, the conformance suite's downloader arm, a signed fixture — `ARCHITECTURE.md`, `CLIENTS.md` §The conformance suite, `FIXTURES.md`.
* **Rows 27–29**: a prefix draws a smaller image; a study nobody has read; the UDP-fallback proposal — `decode/README.md`, `disk-access/adr.md`, `ARCHITECTURE.md` §The TCP fallback.
* **Rows 30–58** (2026-09-18 to 22): the QUIC bump, the session-open levers, detection and resumption, the impaired link and the radio's shapes, the first ask, slow-start exit, after a blink, WebKit's dial, the production handshake, the static plane, the decoder passes — `transport/transport-conclusions.md` §3, `ARCHITECTURE.md`, `decode/README.md`, `rig-limits.md` §3.
* **Rows 60–81** (2026-09-23 to 25): a closed client's worker, early messages, detection by the bytes, the decode tail, the warm-up, the hand-off to the page, the TCP fallback, stream shape under loss, the range in the pack, quinn's withheld ACK — `ARCHITECTURE.md`, `WIRE.md`, `CLIENTS.md`, `adr-stream-shape.md`, `decode/README.md`, `transport/transport-conclusions.md` §1 and §5, `transport/upstream-*.md`.
* **Row 82** (2026-09-26, `0752e5d`): the docs folded to the ones that own their subjects.
* **Rows 83–85**: the decoder — the range skipped for 8-bit colour, `-fwasm-exceptions` (not adopted), the warm-up's size — `decode/README.md`.
* **Rows 86, 91, 92, 95, 99, 100, 107, 110, 111**: the relay as a phone link (traces, CoDel, fq_codel, the TUN plane, the idle penalty) and the controllers on it — `transport/transport-conclusions.md` §1, `rig-limits.md` §3.
* **Rows 87, 88, 93, 98, 104, 109**: the page open — encodings, HTTP/2, the dial before the config, file order, the push in a browser, the worker graph's boot — `ARCHITECTURE.md` §The session open, `lab/page-open/README.md`.
* **Rows 89, 90**: the SETTINGS-early patch on both server entry points; a balanced arm order — `transport/upstream-wtransport-settings.md`, `rig-limits.md` §6.
* **Rows 94, 101**: `readMin` — `CLIENTS.md` §Reading a frame whole.
* **Rows 96, 97, 102, 103, 108**: the controller knobs — the window through a silence, the ask's tax, the deep-buffer fill, the restart sized (now the default), the ask's loss slope — `transport/transport-conclusions.md` §3 and §5.
* **Rows 105, 106**: recycling before WebKit's 16 MB stall, and the opening ask on the WebSocket upgrade (now the default) — `ARCHITECTURE.md` §Recycling before the stall, `lab/tcp-fallback/README.md`.
* **The 2026-09-10 lanes' nulls**: `git show 0752e5d^:docs/improvements/ledger.md` §10. Retired campaigns and their drivers: tag `archive/transport-lab-2026-09`.

## When the queue runs dry: an identification sweep

A procedure, not a finding; it **identifies** levers and does not measure, build or fix. Run it when
the queue is empty, the target changes, or a constraint is lifted (re-run only the areas that
constraint had closed).

1. **Split the clock from raw runs** per goal (a fill's time to all frames; one frame asked on an idle
   session). A stage that is 5 % of the clock cannot be the answer.
2. **List what the rig's regime hides**: loopback hides every round trip, loss, slow start, buffer depth
   and outages; a desktop hides compile time, cores and memory; a warm profile hides first visits; one
   browser hides the others. Each hidden dimension is a search area.
3. **Inventory what is documented** per area — the verdicts and the regimes they were reached in. A
   verdict from a regime that does not apply to the target is a lead, not an exclusion.
4. **One read-only investigator per area**, in parallel, each opening from a code fact already verified
   (file:line), reading library source rather than docs, with arithmetic for the size on the target, a
   novelty check against the docs, and a "looked at and dropped" list; at most five candidates, each
   with mechanism, evidence, size, cost elsewhere, and the measurement that decides it and who can run it.
5. **Reconcile** conflicting reports by asking which cell the older result actually measured.
6. **Screen against the goal before ranking**: a candidate stays only if it moves a figure the
   comparison reports, on its content, bit-exact (§What a row may not change).
7. **Rank by effect on the target**, keep the dropped lists, record corrections owed to existing docs,
   and queue rows with the split between container, shaped-link VM, workstation and device.

Launch fresh investigators in two waves, highest expected effect first: a usage limit then costs the
tail, not the head.

## Open owner decisions

* **The keep-alive pair** (20 s keep-alive, 60 s idle timeout): measured, battery unmeasured —
  [`transport/adr-idle-sessions.md`](transport/adr-idle-sessions.md), status proposed.
* **`readMin` at 16 KB by default**: frame 0 ties (RMD4, 24 rounds at 4×); the cost is re-dials below
  ~44 kbit/s, and a cut queued before the read goes unnamed, a defect to fix first —
  [`CLIENTS.md`](CLIENTS.md) §Reading a frame whole.
* **The controller beyond `cubic-restart`**: BBR stays opt-in until the target's loss mix is known; the
  candidate build is v3's loss bound — [`transport/transport-conclusions.md`](transport/transport-conclusions.md) §1 BB3.
* **The page shape and its deployment**: the transport URL inlined, the page carrying the worker graph,
  HTTP/2 in nginx, the preloads on the downloader page — [`ARCHITECTURE.md`](ARCHITECTURE.md) §The session open.
* **Coalescing decoded frames across decoders**: design the merge point or drop it, for ~10 ms of a
  throttled fill's main thread — [`ARCHITECTURE.md`](ARCHITECTURE.md) §The hand-off.
* **The GSO cap**, 24 or 45 — [`transport/transport-conclusions.md`](transport/transport-conclusions.md) §4.
* **Our own decoder build**, which brings the range in the pack — [`decode/README.md`](decode/README.md) §What adopting it costs.
* **`recycleAtBytes` on WebKit**, and its detection rule — [`ARCHITECTURE.md`](ARCHITECTURE.md) §Recycling before the stall.
* **The upstream filings** — [`transport/upstream-quinn-ack.md`](transport/upstream-quinn-ack.md),
  [`transport/upstream-wtransport-settings.md`](transport/upstream-wtransport-settings.md); cut each once filed.
* **Signed data in the product**: whether it serves signed samples at all. The decoders and the parity
  run cover signed 12- and 16-bit ([`decode/README.md`](decode/README.md) §Ground truth).
