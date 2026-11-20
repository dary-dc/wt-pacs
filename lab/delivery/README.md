# delivery: the delivery comparison's cloud rig

The build of [`docs/client/evidence/delivery-comparison.md`](../../docs/client/evidence/delivery-comparison.md) §10
(DELIVERY-BUILD), for the protocol as pre-registered: arms A, A′, B, C1, C2 through the relay's TUN plane, the model's
predictions from the host's own K1–K3, and the judge of §6–§8. Nothing here is a result: the counted rows are
DELIVERY-RUN's.

| file | what |
| --- | --- |
| `plan.mjs` | §1–§3: the five forms (relay arguments, prefixes, K3's two prefixes), the arms' levers (`decoders=2`; C1 `press=lossless&pressAfter=1000`; C2 `exactFill=1`), a cell's loads in §2's order (a Williams row of the arms a round, run for each volume, the volumes rotated by one a round) |
| `predict.mjs` | §4.1's model (wire, decode floor, fill, regime, C1's slow start from 12 000 B, C2's span) and `predictions.json` from `inputs.json`, with its XXH3-64 by the product's hasher |
| `inputs.mjs` | §4.2: K1 (each frame's coded bytes), K2 (the bench's median per-frame decode), K3 (the line through two prefixes' medians) as `inputs.json` |
| `run.mjs` | the driver: one cell's loads, or K2's bench loads (`--bench`), each a fresh relay, both series' servers and the page server in the relay's server namespace, a fresh browser; raw rows as they land, the page's beacon records in each row |
| `judge.mjs` | §6–§8: each load's `VOID` reasons and the stop; per (cell, volume, arm, clock) the ratio's median, rounds in band, holds or misses and its side, regime misses, strict and round-paired past 25 % `VOID`; `UNBALANCED`; §7's input for `lab/scripts/aa_rule.py` |
| `series.sh` | the arms' series as `scripts/demo-series.sh` codes them (each set's HTJ2K and its Q 8 G 8 view), frames kept for K1, and the prefixes |
| `prefix.py` | a series' first N frames as a series of its own (`<id>-p<N>`), the view's naming its exact series' prefix |
| `k3.sh` | K3: `claude/transport-arms` `9fad9d9b`'s `run.mjs`, its WT-TS arm alone, on `dbts_b1` HTJ2K at each form's two prefixes, four visits each, interleaved, in a worktree at that commit |

## Run

Needs, past `README.md` §Prerequisites: `iproute2` (`apt-get install -y iproute2`; the cloud image lacks `ip`),
`/dev/net/tun`, `unshare`, `nsenter`, `taskset`; Playwright's full Chromium (`channel: "chromium"`); `ingest/tools.sh`'s
build; `target/release/series-server` and `pack-series`.

```bash
lab/delivery/series.sh S                                           # K1's series and the prefixes
node lab/delivery/run.mjs --bench --series S                       # K2: rows/K2.jsonl
lab/delivery/k3.sh S lab/delivery/rows                             # K3: rows/K3-<CELL>.jsonl
node lab/delivery/inputs.mjs S lab/delivery/rows/K2.jsonl lab/delivery/inputs.json --k3 CLEAN=lab/delivery/rows/K3-CLEAN.jsonl …
node lab/delivery/predict.mjs lab/delivery/inputs.json lab/delivery/predictions.json   # commit and push before any counted row
node lab/delivery/run.mjs --cell CLEAN --series S --predictions lab/delivery/predictions.json --pilot   # 2 rounds, not counted
node lab/delivery/run.mjs --cell CLEAN --series S --predictions lab/delivery/predictions.json [--pilot-medians FILE]
node lab/delivery/judge.mjs lab/delivery/predictions.json lab/delivery/rows/CLEAN.jsonl
python3 lab/scripts/aa_rule.py lab/delivery/rows/CLEAN.aa.json --bar 0.05
```

A cell is 150 loads; one cell a job, each under 2 h (§6). The driver re-runs itself under `unshare -rn` and pins the
relay to core 0, the servers to core 1, itself and so the browser to cores 2–3. **The run stops** on a load whose page
failed (a frame not exact, C1 painted without its exact frame, C2 not filling every exact frame); **`VOID`** (kept, with
why): a crash or no verdict, the page's timers stopped, the relay's guard p99 over 1 ms, core 0 or 1 over 95 %, past 3×
the pilot's median (`--pilot-medians`, `{"CELL/VOLUME/ARM": ms}`), more than 2 decoders read back from the frames' own
decode spans. The pilot also refuses when the relay's loss pooled over its loads is not within 3× of the form's.

## What the build found, for the run's amendment (§11)

None of these is in the protocol's text; each changes how the rig runs, none what it measures.

* **The page is served from the server's namespace**, at `10.77.0.2`, beside both series' servers: the viewer's
  `connect-src` (`server/dev-server.py`'s policy) allows only loopback and the page's own host, so a page on loopback
  cannot dial the relay's far side. The page and its scripts therefore cross the relay before the dial; the fill's clock
  starts at the dial (§5), so they cost no clock.
* **That origin is marked secure** by Chromium's `--unsafely-treat-insecure-origin-as-secure` for the two page
  origins (WebTransport and `crypto.randomUUID` need a secure context); Playwright's headless shell ignores the switch,
  so the browser is its full Chromium build (`channel: "chromium"`, 153.0.8010.12 here), printed in every row.
* **`navigator.hardwareConcurrency` reads 2** under `taskset -c 2,3`, so the downloader's default
  `min(3, hardwareConcurrency)` is already 2 here: the `decoders` lever's absence would not show in a read-back, and
  §10's "the decoders lever ignored" mutant is checked as a lever that asks 3 (`--mutate decoders-3`).
* **C1's exact frame is frame 0**: the viewer opens on it and a C1 load never steps (`client/view/controller.js`).
* **C2's second downloader dials at its issue** (`lab/devices/bench.js` `exactFill`), so its span keeps the form's
  whole start (`exactDialed: false`).
* **K1's bytes are each frame's coded bytes** (the frame files `ingest_coded.py` writes), without the bundle's entry
  framing.
* **The relay** is the tree's `lab/scripts/link_impair.py`, which differs from `9fad9d9b`'s only by the control
  port's `window` command, unused here.

## Checks, and their mutants (§10)

See `docs/reviews/delivery.md` once reviewed; the mutants each check was run against are listed in the build's Result
(`claude/work-ledger:docs/queue/DELIVERY-BUILD.md`).

## Limits

One 4-core container, headless Chromium (full build), software decode, the userspace TUN relay at ≤ 90 Mbit, no radio.
The build was smoke-tested on the synthetic pair of `lab/devices/round_headless.sh` (64 × 48, 20 frames) and on the
three timed volumes only where its Result says so.
