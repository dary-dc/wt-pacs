# The transport comparison's build, reviewed

TRANSPORT-BUILD-REVIEW, 2026-11-18, by a session that wrote none of `stacks.md` §1–§5 or the build. Reviewed:
`claude/transport-arms` `25170159..88c91643` (draft PR 403) against
`claude/transport-design` `c74d4bea:docs/transport/evidence/stacks.md` §5. The brief: each arm as §5.1 defines it; the
A/A copy the same code; each metric's clock ending at the frame's last byte (§5.3); every mutant fails its check; the
absence check green.

**Fixtures and limits.** One 4-core cloud container (Linux 6.18, no GPU), headless Chromium 157.0.8103.78 (Playwright),
the userspace TUN relay at ≤ 90 Mbit; the build's synthetic series (`fixture.sh`: 12 HTJ2K frames, 2048², ~6.5 MB
each, three times `dbts_b1`'s), not `dbts_b1`. WT-WASM was not rebuilt here (it needs `wasm-pack`), so the seven other
arms were run. Every reproduction below is one or two rounds: it checks that the code does what it says, and
measures nothing.

## Verdict

**Five blockers.** TRANSPORT-RUN waits on TRANSPORT-BUILD-FIX and its re-review (amendment 17).

| # | blocker | where |
| --- | --- | --- |
| B1 | No arm uses the opening ask. §5.1 holds WT-TS to "the default build: … opening ask" and WS to "the opening ask in the upgrade's URL"; the page calls `client.fill()` after `DownloaderClient.connect()` returns, so at the dial the downloader has nothing wanted (`nextRun()` is `null`) and every WT and WS fill pays one more round trip than the default build | `lab/transport-arms/page.js` |
| B2 | A failed frame check is voided when any `VOID` reason coincides with it. §5.2: "one failure stops the run and is reported, never voided"; `judge()` stops only `if (!row.void && row.exact !== owed)` | `run.mjs` `judge` |
| B3 | A crashed visit on a fetch arm kills the driver instead of recording `VOID crash`: `row.protocols` is unset on a crash, and `judge()` reads `row.protocols.length` | `run.mjs` `judge` |
| B4 | The H2 and WS arms run the kernel's **BBR**, not §5.1's "kernel `cubic`". Both namespaces read `tcp_congestion_control = bbr`; the sysctl cannot be written in this container (`I/O error`, as root and in `unshare -rn`), but a socket can: `setsockopt(TCP_CONGESTION, "cubic")` succeeds inside `unshare -rn`. §5.3's LTE and LOSS predictions are Cubic's ("Cubic's 0.1 % bound", "Cubic at 1 %") | `server/src/transport/lab_get.rs`, the WebSocket listener |
| B5 | The build's two departures from §5's text (a second quinn endpoint for HTTP/3; an ask's t₀ at the page's call) are in the README only. §5: "an amendment goes in before any counted row if the host forces one"; neither is yet in `stacks.md` §5 | `claude/transport-design` `stacks.md` §5 |

### B1, measured

FF, two rounds of WT-TS, WS and H2-fill, the series above. Medians in ms; "opening" is `page.js` passing `fill: filled`
to `connect` instead of calling `client.fill()` after it (a local edit, not pushed).

| form | WT-TS as built | WT-TS opening | WS as built | WS opening | H2-fill (either) |
| --- | --- | --- | --- | --- | --- |
| ff-20ms | 767 | 752 | 770 | 742 | 746 |
| ff-38ms | 977 | 939 | 935 | 890 | 893 |
| ff-56ms | 1102 | 1046 | 1107 | 1044 | 1047 |

As built, H2-fill reads ×0.91–0.97 of WT-TS where §5.3 predicts H2 ×1.03–1.12: the arms, not the stacks, decide it.
Every fill cell's t₀ (the dial) carries the same extra round trip for WT and WS.

**Fix:** pass the cell's frames to `connect` (`fill`), so the opening ask rides the dial as in the default build; the
fetch carrier then GETs at `connect` too, as it already does for an opening fill. A test: a visit's first `stream_frames`
rides the session URL for WT-TS and WS.

## Each point of the brief

* **The arms (§5.1).** WT-TS, WT-TS′ and WT-WASM load the downloader's own modules; WS dials `wss://` on the QUIC
  port's number; the fetch arms are `fetch-session.ts` behind the same seam, K = 6, frame and fill shapes, the ask's
  abort and re-GET. Reproduced at CLEAN: every arm 12/12 exact, `nextHopProtocol` h3 or h2 as asked. H2-frame opens
  six TCP connections on a cold visit (the relay's tally: one carries 81.8 MB, five carry their handshake, ~1 KB each),
  because a fresh profile does not yet know the origin speaks h2; the data rides one connection as §5.1 asks. Holds,
  but for B1 and B4.
* **The A/A copy.** `WT-TS'` is the same module and URL as WT-TS, in the same Williams square; `aa.json` puts it as
  `aa` and WT-TS as `ref`, the shape `lab/scripts/aa_rule.py` reads. Holds.
* **The clock (§5.3).** Every metric ends at `stamps.lastByte`, stamped in the downloader's `arrived()` when the
  frame's last envelope byte is in, before it is queued for a decoder: the decode is out, the check is still made.
  t₀ is `boot.dial`, the worker's stamp before `connect`, the same for every arm (fill and first frame); an ask's t₀ is
  the page's call (B5). Holds.
* **The mutants (§5.6).** Each fired here as the README says: `wrong-protocol` → `VOID spoke h2, not h3`;
  `drop-frame` → `STOP: 11 of 12 frames exact`, exit 3 (after the 120 s visit limit); `relay-no-loss` →
  `PILOT REFUSES: relay loss 0.000 %, asked 1 %`, exit 3 (unmutated, the same visit passed); `fixed-order` →
  `UNBALANCED: WT-TS WS H2-fill` (unmutated, none); `cpu-wrong-pid` → `CPU ZERO`. The GET path's Rust test passes, and
  fails with the drop filter removed and with the envelope head left out (both mutants killed).
* **The absence check.** `scripts/check_lab_absent.sh`: "OK: no lab crate, source or module in the images or the
  default build". Holds.

## Not blocking; for the fix row or the run

1. `CPU ZERO` also fires unmutated on a one-frame visit of a TCP arm (FF, WS and H2-fill: 0 ticks of the server in
   ~1 s), so it does not tell a wrong pid from a short visit. Check the pid's command line instead, or flag zero only
   in the cells CPU reads (CLEAN).
2. A cell cut and resumed restarts its rounds at 0 and writes `aa.json` from the second invocation's rows only; the
   summary should be read from the `--out` file, with `--from-round`, so a stalled TRANSPORT-RUN can resume a cell.
3. §5.2 asks the browser's switches printed per run; rows carry its version only.
4. The pilot writes no `--pilot-medians` file; the 3× rule needs one built by hand from the pilot's rows.
5. `fixture.sh` is committed `100644`; the README runs it directly (`Permission denied`).
6. The GET path's Rust test covers HTTP/2 only; HTTP/3 is covered by the driver's visits alone.
7. For TRANSPORT-RUN: this host's Chromium is 157.0.8103.78, neither of §5.2's tags, so the four window constants are
   re-read at its tag before the pilot; the busiest core reached 0.85 on the H3 arms at CLEAN (the bar is 0.95); the
   relay's guard voided 1 of 24 FF visits in each of three runs (p99 over 1 ms on a short visit).

## Owner decisions

None: B4's fix (a socket option under the lab feature) and B5's amendment stay inside §5's design.

## Re-review

TRANSPORT-BUILD-FIX-REVIEW, 2026-11-18, by a session that wrote neither the build, its review nor the fix. Reviewed:
`claude/transport-arms` `fa002825..65c6dd6c` and `claude/transport-design` `0464fc8c`. Each blocker's fix was reverted
or made a no-op here, its check seen to fail, then restored.

**Fixtures and limits.** One 4-core cloud container (Linux 6.18, kernel default `bbr`, no GPU, no Docker), headless
Chromium 157.0.8103.78; the build's synthetic series (`fixture.sh`, 12 HTJ2K frames, 2048²), not `dbts_b1`. The driver
runs below are one round of FF over WT-TS, WS and H2-fill with `--idle-ms 1000`: they check what stops the run and
measure nothing.

### Verdict

**No blocker open.** TRANSPORT-RUN may start.

| # | reverted | its check |
| --- | --- | --- |
| B1 | `--mutate no-opening` (the page fills after `connect`, the old path) | `STOP: frame 0 asked after the dial, not by the opening ask`, exit 3. Unmutated: every visit exact, each frame's ask before `dial`; `connect`'s fill reaches the transport through the downloader's `openSession(opening)` |
| B2 | the frame check moved back under `!row.void` (one line), and the pre-fix `judge` of `fa002825:run.mjs` | `judge.test.mjs`: `FAIL a failed check under a late relay gave null` |
| B3 | the crash test after the protocol test (one line), and the pre-fix `judge` | `FAIL a crash gave threw Cannot read properties of undefined (reading 'length')` |
| B4 | `--mutate default-congestion`; and `set_congestion` made `Ok(())` | `STOP: the server's TCP ran bbr, not cubic`, exit 3; the Rust test `an_accepted_socket_takes_the_named_controller` fails (`left: "bbr"`, `right: "reno"`). Unmutated: `cubic` read on every WS and H2-fill visit |
| B5 | — (a document) | `stacks.md` §5.7, dated 2026-11-18, both departures and the socket-level `cubic`; no counted row exists before it |

The pre-fix `judge` fails seven of the new test's checks, B1–B4's included. **Nothing else changed:** the diff touches
the five blockers, minors 1, 3 and 5 (CPU ZERO in CLEAN only, the browser's switches in each row, `fixture.sh`
executable), `scripts/gate.sh`'s one line for the test, and `websocket.rs`'s one call, under `cfg(feature = "lab-get")`.
`scripts/gate.sh` green up to the decoders' rebuild, which needs Docker (skipped, as for the fix); after it, by hand:
both telemetry absence checks, `scripts/check_lab_absent.sh` ("OK: no lab crate, source or module in the images or the
default build") and the comment budget, all green.

### Not blocking

1. `judge`'s exemption of `aa`'s last frame from the opening rule has no test: with `"aa"` removed the test still
   passes. A broken exemption would stop the AA cell on its first WT or WS visit (loud, not silent); one case like
   `ad`'s closes it.
2. `tcpCongestion` reads the controller as the token just before `wscale` at the start of `ss -tin`'s info line. This
   host's `ss` prints it so; one that prints `ts sack` first would read nothing and stop the run (safe, not silent).
3. In these single rounds H2-fill reads ×0.98–1.00 of WT-TS at FF (the review's as-built ×0.91–0.97). One round,
   no claim: the run decides it.

### Owner decisions

None.
