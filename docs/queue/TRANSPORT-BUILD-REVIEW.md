state: done
started: 2026-11-18T09:17Z
heartbeat: 2026-11-18T09:38Z
outputs: claude/transport-arms fa002825 (docs/reviews/transport-arms.md, docs/lines/codecs.md §Open 7), PR 403; claude/work-ledger 49428875 (TRANSPORT-BUILD-FIX and -FIX-REVIEW appended)
## Resume
Done. Reproduced in the container (apt-get install -y iproute2 iputils-ping; pip install numpy xxhash; cargo build
--release -p series-server --features lab-get; bash lab/transport-arms/fixture.sh): the Rust test and its two mutants,
CLEAN one round over seven arms (WT-WASM not built: wasm-pack), the five --mutate checks, FF with and without the
opening ask. Rows stayed in the scratchpad (one or two rounds, not results).
## Result
TRANSPORT-BUILD-REVIEW done: five blockers (docs/reviews/transport-arms.md §Verdict), so amendment 17's
TRANSPORT-BUILD-FIX and -FIX-REVIEW are appended and TRANSPORT-RUN waits on the re-review.
* B1: no arm uses the opening ask; at FF it costs WT-TS and WS one RTT (ff-56ms: 1102 against 1046 ms), which flips
  the FF prediction's direction for H2.
* B2: a failed frame check is voided if any VOID reason coincides (§5.2: never voided).
* B3: a crashed fetch-arm visit kills the driver (TypeError on row.protocols).
* B4: the H2 and WS arms run kernel BBR, not §5.1's Cubic; per-socket TCP_CONGESTION=cubic works in unshare -rn.
* B5: the two departures are in the README, not amended into stacks.md §5.
Held: the A/A copy is the same code; every metric ends at the downloader's last-byte stamp; all five mutants fire;
the absence check is green. Seven non-blocking items listed.
Fixtures: the build's synthetic 12-frame series, Chromium 157 headless, one 4-core container, the TUN relay.
Owner decisions: none.
