# recv-loop

Does a WebTransport receive loop keep the fill's rate when it shares one dedicated worker's thread with a disk cine
(OPFS reads, XXH3 checks, uploads, paints) or a window drag? The question, the engines' sources, the predictions and
the pre-registered rule are in [`docs/adr/frame-path.md`](../../docs/adr/frame-path.md) §The receive loop beside the
paint (2026-10-29). Nothing here is a result until that protocol runs; its runs are a separate queue row.

```bash
cargo build --release -p series-server -p pack-series
client/transport/ts/build.sh                     # dist/session.js, the receive loop under test
client/decode/wasm/fetch_xxh3.sh                 # the frame check's XXH3
node lab/recv-loop/run.mjs make DIR              # 800 × 250 KB of random bytes, packed, their SHA-256s, a certificate
NODE_PATH=$(npm root -g) taskset -c 1-2 node lab/recv-loop/run.mjs run DIR --rounds 12 --out rows.jsonl
NODE_PATH=$(npm root -g) node lab/recv-loop/run.mjs summary rows.jsonl   # the table, then aa_rule.py, then the rule
```

`--browser firefox` runs Gecko (Playwright's Firefox, or `FIREFOX_PATH`); `--cells` and `--arms` take comma lists.
*Corrected 2026-10-29 (independent review):* `run.mjs` does not read `FIREFOX_PATH`; only Playwright's own Firefox
build runs.
`--angle` is Chromium's ANGLE backend: `swiftshader` (software, the default) or the GPU host's, e.g. `gl` or `vulkan`;
the row's `renderer` shows which ran.

**Arms.** `split`: the receive loop in a worker of its own beside the view worker, the target's shape. `split2`: the
same again, the A/A. `merged`: the receive loop in the view worker, the independent design's shape. Each visit is a
fresh browser with a disk-backed profile (an incognito context keeps OPFS in memory), its own server and relay.
The order over the three is a Williams square (`lab/order.mjs`), period 6 rounds.

**Loads.** `cine`: 30 frames/s on the worker's `requestAnimationFrame`, each step one synchronous task: a
`FileSystemSyncAccessHandle.read` of a 2560 × 3328 16-bit frame (17 MB, written at start, so warm), XXH3 against
its digest, `texSubImage2D`, a draw. `drag`: a draw a tick with a changed uniform, no upload, as the paint module's
window change. The load runs 1 s before the fill and stops at its last frame.

**Cells.** Loopback (the host's ceiling, printed and outside the rule), and 103 Mbit/s at 46 and 92 ms, 18 Mbit/s
at 92 ms through `lab/scripts/link_impair.py` (1 000-packet queue), each with both loads. A fill of 250 KB frames,
200 at 103 Mbit/s, 60 at 18, 800 on loopback, opened in the session URL.

**Per visit:** the last frame from the dial, inter-arrival p99 at the script, the cine's frames per second and its
step lateness p99, the share of the worker's time the load held, the host's CPU.

**Checks, each mutated** (`--mutant`; the row fails its check and counts for nothing):

| check | holds when | mutant | caught |
| --- | --- | --- | --- |
| every frame exact: SHA-256 against the series' | always | `corrupt`: one bit of frame 0 flipped | `1 of 800 frames not exact` |
| merged is one thread: no arrival inside a load task (0.5 ms in from each edge) | `merged` | `leak`: the merged worker hands the receive loop to a nested worker | `236 arrivals inside a busy interval` |
| split is two threads: some arrival inside a load task | `split`, `split2`, load ≥ 20 % of the thread, ≥ 50 arrivals | `fold`: the split arm's receive loop sent to the view worker | `no arrival inside 52 busy intervals` |

**Saturation guard.** A visit is `VOID` when the host's CPU passed 90 % or the relay's send p99 was over 1 ms
(`--self-timing`); a round of a cell is dropped for all three arms when the split arm's cine ran under 27 frames/s,
the view thread saturated on its own. Loopback cells are the browser's receive ceiling
([`docs/rig-limits.md`](../../docs/rig-limits.md) §1), and nothing past it is claimed.

**What ran here** (2026-10-29, headless Chromium 153, software GL, 4 cores): one smoke round of `loop-cine`, one
visit of `103/46-drag`, and each mutant once. They show the harness runs; no number from them is a result.
No Firefox or WebKit binary is in this container. Software GL is not a GPU: the protocol needs a host whose split
cine holds 30 frames/s.

*Independent review, 2026-10-29* (Chromium 153, software GL, 4 cores): each mutant on one round of `loop-cine` again
failed its check as the table says (`leak` 797 arrivals, `fold` 0 in 228 and 135 intervals, `corrupt` 1 of 800 in
every arm), the unmutated round passed; one round of `103/46-drag` came back `VOID` on both guards. *Corrected:*
`summary` printed "the downloader may merge" on rows that left no shaped cell; it now prints "not decided".
