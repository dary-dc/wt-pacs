# Defaults

Every default the product ships, on `claude/unified` at `b059388b6` (2026-11-24): what runs when nobody sets anything.
Each row names its value, where it is set, and the measurement that chose it, or says **chosen by no measurement**
with the reason a document gives (or "no reason found"). This is the table `final-state.md` condition 3 asks for
(`claude/reviews-2026-11-28:docs/decisions/final-state.md` §5); its starting point was DEFAULTS-FIND's list
(`claude/demo-understand:docs/reviews/understand/defaults.md`, 2026-11-11, the demo tip), re-read against this tip.

**How it was made** (DEFAULTS-TABLE, 2026-11-24). Read from the code: every `file:line` checked with `grep -n` on the
tip; every justification is the cited document's sentence, quoted. Nothing was run or measured here. *Kind*:
**measured** (a measurement chose or confirmed this value), **theory** (derived, a standard's rule or an argument;
never swept), **owner** (the owner's decision, measured or not, as said), **none** (no measurement chose it).
Excluded: anything compiled only under a `lab-*` feature or read only on a host that serves `lab/`, the paused native
client (`client/native`), and the contract suite. A "none" row is the strongest claim here, that no document gives a
reason; one written in terms this search missed could exist.

**Fixtures and limits.** The measurements cited are each document's own, on its own fixtures and hosts (mostly the
19 DBT volumes of one dataset, three timed; 4-core cloud hosts without a GPU; a userspace relay or netem, not a radio).
The ultrasound fixtures are lossy-sourced (`docs/FIXTURES.md`), so no row below rests on an ultrasound measurement.

## Server: `series-server` flags

| default | value | set at | chosen by | kind |
| --- | --- | --- | --- | --- |
| `--port` | 4433 (UDP; TCP too with `--websocket`) | `server/src/transport/server.rs:36` | chosen by no measurement; no reason found | none |
| `--bind` | `[::]` dual-stack, else `0.0.0.0` | `server.rs:54`, fallback `:253–256` | chosen by no measurement; no reason found | none |
| `--cert-pem`, `--key-pem` | `server/dev-cert/{cert,key}.pem`, relative to the working directory | `server.rs:44`, `:46` | the dev certificate; the container always passes its own (`deploy/server-start.sh:22–23`) | none |
| `--stream-mode` | `shared` | `server.rs:49` | `docs/adr/stream-shape.md` §Decision: "**One shared uni stream per session is the default** (`--stream-mode shared`)." | measured |
| `--opening-ask` | on | `server.rs:58` | `docs/ARCHITECTURE.md` §The opening ask: "**On by default** since 2026-10-02 (a measured win with no cell against it)" | measured |
| `--websocket` | off | `server.rs:61` | `docs/WIRE.md` §The WebSocket mapping: "Off by default"; no measurement chose off | none |
| `--congestion` | `cubic-restart` | `server/src/transport/tuning.rs:17–18` | `docs/transport/transport-conclusions.md` §3 *The restart sized*: "**The restart keeps its whole win under loss and costs nothing without a blink**" | measured |
| `--send-window-bytes` | quinn's default | `tuning.rs:60–61` | `transport-conclusions.md` §3 *Flow-control windows*: "Windows stay at quinn's defaults." | measured |
| stream receive windows | quinn's default (not set in `server/`) | — | `docs/adr/transport-quic-stream-receive-window-defaults.md`: "**Ship and measure with quinn / wtransport stack defaults for stream flow control.**" | measured |
| `--max-idle-timeout-ms` | quinn's default (30 s by the ADR; quinn's source not read) | `tuning.rs:63–64` | `docs/adr/transport-idle-sessions.md` (proposed): "The current default is the library's 30 s, which is below the browser's own and leaves no margin." It proposes 60 s, not accepted | none |
| `--keep-alive-interval-ms` | off | `tuning.rs:67–68` | the same ADR: "Keep-alive is built and **off by default**; nothing changes until this ADR is accepted." | none |
| `--initial-window-bytes` | quinn's 12 000 | `tuning.rs:73–74` | `docs/transport/link-conditions.md`: "*proposed, opt-in* since row 191 (the owner, 2026-10-13): the default is quinn's 12 000." 38 400 measured better; the owner kept 12 000 | owner |
| `--initial-rtt-ms` | quinn's 333 ms | `tuning.rs:77–78` | `transport-conclusions.md` §3 *The first timeout, at 1 % loss*: "**Not changed**: the right number is the target's round trip, which this rig cannot stand in for" | none |

`--series`/`--root` are required, one of the two. Lab-only (`lab-levers`), not shipped: `--force-pool-reads`,
`--hold-sessions`, `--stall-after-bytes`, `--segmentation-offload`, `--send-window-follows-cwnd`,
`--reply-repeated-initial`, `--stream-mode per-frame-asks-first`, `--advise-tile-names`, `--fill-resumes-after-asks`,
`--ask-stream-priority`; `--congestion cubic-classify` (`lab-classify`); `LAB_FRAME_CACHE_*` (`lab-frame-cache`).

## Server: environment, build and constants

| default | value | set at | chosen by | kind |
| --- | --- | --- | --- | --- |
| `WTPACS_READ_PATH` | `auto` (`pool` the kill switch) | `server/src/media/read_path.rs:34–35`, `:42` | `docs/adr/disk-access.md` §5: the ring-on-miss reader "beats every pool variant **RESOLVED on wall *and* CPU** at 16 KiB cold" | measured |
| `uring` feature | on | `server/Cargo.toml:16` | `deploy/README.md`: "**The owner took it on 2026-10-14**" (row 208) | measured |
| `cert-compression` feature | off | `server/Cargo.toml:30` | `ARCHITECTURE.md`: "**It stays off by default**: five crates and +1.29 MiB on the binary, for what ECDSA gets with none." | measured |
| log filter | `series_server=info` added to `RUST_LOG` | `server/src/main.rs:15` | no reason found | none |
| `TILE_SLOTS` (reads at once, ring depth) | 4 | `read_path.rs:26` | `disk-access.md`: "Depth 2 → 4 was +37 % on the sandbox host"; 4 → 8 not swept, and "unmeasured on a throttled link" | measured (2 against 4 only) |
| `FILL_WINDOW` | 4 MiB of `WILLNEED` past the named frame | `read_path.rs:28` | `disk-access.md` §9 *the fill window stays 4 MiB*: "**Verdict: not adopted.**" (the 2 × frame arm) | measured |
| io_uring setup | `COOP_TASKRUN`, no SQPOLL, no registered buffers | `server/src/media/uring_reader.rs:34` | `disk-access.md` §9 *Finding 9*: "**Verdict: closed; `COOP_TASKRUN` stays.**" | measured |
| `POOL_CAP` | 64 frame buffers a process | `server/src/media/frame_pool.rs:10` | stated in `transport-conclusions.md`; nothing chose 64 | none |
| `ASKS_AHEAD` | 8 asks planned | `server/src/transport/planner.rs:7` | described in `docs/adr/frame-framing-and-loop-shape.md`; no reason found for 8 | none |
| `SILENCE_RTTS` (the restart) | 4 round trips | `server/src/transport/restart.rs:15` | the code's reason, two probe timeouts at quinn's RTT variance; the controller is measured, this threshold was not swept | theory |
| `bbr-bound`'s constants (opt-in) | loss 0.02, β 0.7, headroom 0.85, 10 rounds, 4 packets | `server/src/transport/loss_bound.rs:12–19` | BBRv3's values (`transport-conclusions.md` §1) | theory |
| shutdown drain | 250 ms | `server.rs:132` | `deploy/README.md`: "the bound stays at 250 ms" (row 270, 500 → 250) | measured |
| per-frame finish grace | 2 s | `server/src/transport/link.rs:137` | stated in `docs/WIRE.md`; no reason found | none |
| connection migration | on | `server.rs:262` | `ARCHITECTURE.md`: "at 40 ms the session survived **16 of 16**" | measured |
| WebSocket chunk | 64 KiB a message | `server/src/transport/websocket.rs:34` | `WIRE.md`: "the grain at which a browser, which hands a message over only whole, sees a frame's bytes move" | theory |
| WebSocket handshake bound | 10 s | `websocket.rs:37` | no document; the code's reason only | none |
| WebSocket TCP keepalive | 20 s idle, 5 s interval, 4 probes | `websocket.rs:40–43` | `WIRE.md` §The WebSocket mapping; "the kernel's expiry is not observed" | theory |
| WebSocket accept retry | 100 ms | `websocket.rs:46` | `WIRE.md` (row 272): a pause against none; only 100 ms tried | measured (pause against none) |
| WebSocket `TCP_NODELAY` | on | `websocket.rs:123` | stated in `WIRE.md`; no measurement | none |
| quinn GSO cap (crate patch) | 24 segments | `patches/quinn-0.11.11-mtu-gso.patch:25` | `docs/levers.md`: "**adopted, 24** (the default build since 2026-10-14, row 192)" | measured |

Wire limits, not tunables: `MAX_FOD_LEN` 64 KiB (`common/fod/src/lib.rs:33`; `WIRE.md`: "A client's longest message
is 56 B"), `MAX_FRAME_LEN` 64 MiB (`common/frame-envelope/src/lib.rs:8–9`, no reason found), `MAX_CODED_UID` 44
(`server/src/media/series_tree.rs:15`, a 64-character UID coded two per three).

## Deploy

| default | value | set at | chosen by | kind |
| --- | --- | --- | --- | --- |
| flags the start script passes | `--series`, `--cert-pem`, `--key-pem` only: every transport default above holds | `deploy/server-start.sh:22–23` | `deploy/README.md`: "`server-start.sh` passes no `--websocket`" | — |
| certificate | ECDSA P-256, 10 days, localhost and 127.0.0.1, unless `/supplied` holds one | `server-start.sh:10–16` | `deploy/README.md`: "A certificate pinned by hash (`serverCertificateHashes`) must be valid for at most 14 days." | theory (the standard's rule) |
| `RESTART_AFTER` | `9d` | `deploy/compose.yml:17`, `:43` | restarted "before the browser refuses the old one" (`deploy/README.md`) | theory |
| `CLIENT` | `ts` | `compose.yml:18`, `:44` | `docs/levers.md`: "both clients: fill 120 against 125 ms … held (TS the default)" | measured (a tie) |
| `SERIES`, `STUDIES` | `us_cine_smoke`, `../fixtures/us_cine_smoke` read-only | `compose.yml:15`, `:20` | the smoke fixture; no reason found | none |
| `WT_URL`, `EXACT_WT_URL`, `EXACT_SERIES` | `https://127.0.0.1:4433/`, `…:4434/`, empty | `compose.yml:16`, `:41–42` | no reason found | none |
| `PUBLISH_ADDR` | `127.0.0.1` | `compose.yml:23–24`, `:49–50`, `:66–67` | no reason found | none |
| `TLS_PORT`, `TLS_DIR` | 443, `./no-tls` (HTTP on 8765 only) | `compose.yml:64`, `:67` | no reason found | none |
| `MEMLOCK` | 64 MiB | `compose.yml:12`, `:38` | `deploy/README.md`: "64 MiB: ~7 500 rings at 8.7 KiB, for this uid"; raising it "Not measured here" | theory |
| `NOFILE` | 65535 | `compose.yml:13`, `:39` | `deploy/README.md`: "≥ sessions that miss + sockets" | theory |
| seccomp profile | `seccomp-uring.json` | `compose.yml:10`, `:36` | `deploy/README.md`: "**The owner took it on 2026-10-14**" | measured |
| healthchecks | 2 s interval, 2 s timeout, 15 retries | `compose.yml:26–29`, `:71–74` | no reason found | none |
| image user | uid 10001, non-root | `deploy/Containerfile:57` | `deploy/README.md`: "The server needs no capability (non-root, port 4433)." | none |
| nginx listen | 8765; 443 with HTTP/2 when `/tls` holds a certificate | `deploy/nginx/wt-pacs.conf.template:13–14` | no reason found | none |
| COOP, COEP, CORP | same-origin, require-corp, same-origin | `wt-pacs.conf.template:23–25` | `deploy/README.md`: "Cross-origin isolation is what gives the page `SharedArrayBuffer`." | theory |
| CSP | `default-src 'self'`, `script-src 'self' 'unsafe-eval'`, `connect-src 'self' ${WT_ORIGINS}` | `wt-pacs.conf.template:28` | `deploy/README.md`: "`'unsafe-eval'` is the decoders' glue" | none (a security rule) |
| `Cache-Control` | `no-cache` on HTML and JSON | `wt-pacs.conf.template:6–10`, `:26` | the template's reason, not read stale from a heuristic cache | none |
| gzip | on, level 6, at least 1024 B | `wt-pacs.conf.template:38–43` | `lab/page-open/README.md`: "**Verdict: 2.9× fewer bytes and no round trip**"; level 6 chosen by no measurement | measured (on against off) |

`server/dev-server.py`, a developer aid: port 8765 (`:95`), `--bind` 127.0.0.1 with an unspecified address refused
(`:96`, `:107–108`), `--series us_cine_smoke` (`:98`), `--revalidate` off (`:103`); no reason measured for any.

## Ingest: the exact series (HTJ2K)

| default | value | set at | chosen by | kind |
| --- | --- | --- | --- | --- |
| codec for `--codec auto` | HTJ2K | `ingest/from-dicom/from_dicom.py:24`, `:38`, `:44` | `docs/FIXTURES.md` §From DICOM: "`auto` is HTJ2K: the per-series codec rule (queue row TOTAL4) adopted AV1 for no series" | measured |
| decompositions | 5 | `ingest/from-parser/encode.cpp:29`; `ingest/coded-frames/ingest.py:26` | `docs/decode/README.md` §Encoder settings (HTJ2KENC, 35 settings, 9 series): "No setting is 0.5 % under the served profile on any series but the 256² PET, where 3 decompositions save 0.9 %" | measured |
| code block | 64 × 64 | `encode.cpp:30`; `ingest.py:26` | the same sweep | measured |
| progression | RPCL | `encode.cpp:31`; `ingest.py:26` | bytes: "LRCP's bytes equal RPCL's on every cell"; order: `docs/av1/encoder-settings.md` §7, "a prefix of a frame is an exact smaller picture" | measured (a tie) and theory |
| precincts, layers | none, one layer | OpenJPH's defaults in `encode.cpp` | HTJ2KENC: "precincts of 128² cost 0.05–0.07 %, of 256² 0–0.02 %" | measured |
| tiles | one | `encode.cpp:26–27` | chosen by no measurement; `docs/av1/README.md`: "tiles delayed, not closed" | none |
| colour transform | RCT on three components | `encode.cpp:32` | no reason found beyond matching `ojph_compress` | none |
| reversible 5/3 | on | `encode.cpp:33`; `ingest.py:26` | forced by lossless | theory |
| SIZ depth | the series' BitsStored | `encode.cpp:24`; `ingest.py:243` | HTJ2KENC: a 16-bit SIZ gives "1.0000–1.0017 of the bytes and no decode change" | measured |
| frame digest | XXH3-64 | `ingest/from-parser/src/main.rs:159`; `ingest.py:350` | `docs/levers.md`: "SHA-256 → XXH3-64 \| row 136: hashing 16–41 % of HTJ2K CPU" | measured |
| `--jobs` | 4 | `ingest/from-parser/src/main.rs:23`; `from_dicom.py:40` | `docs/levers.md`: "row 52: 4 workers 3.5–3.9×"; 4 against other counts not measured | measured (a speed-up at 4) |
| pins | libaom 3.15.1, dav1d 1.5.4, OpenJPH 0.31.0 | `ingest/tools.sh:11–16` | `docs/av1/README.md` (VERSIONS): "libaom's head … writes the same bytes as 3.15.1 … Nothing adopted, no pin changed." | measured |

Lossless AV1 (`from_dicom.py --codec av1`, never chosen by `auto`): its presets by modality, split, container depth,
4:0:0 grey, G = 1, one thread and screen tools are each measured (`docs/av1/payload-format.md`, `docs/av1/README.md`,
`docs/av1/encoder-settings.md` POCGAP; `docs/FIXTURES.md` for the presets: "the fastest, … within 2 % of the
slowest's bytes").

## Ingest: the view (`--optimal-quality`, lossy AV1)

| default | value | set at | chosen by | kind |
| --- | --- | --- | --- | --- |
| the path | off | `ingest/from-parser/src/main.rs:27–29` | `docs/av1/payload-format.md`: "In the product ingest, experimental … off by default" | owner |
| Q, the flag bare | 8 | `ingest/from-parser/src/optimal.rs:9` | `docs/client/evidence/which-quality-is-visually-lossless.md`: "Q 8 is a candidate, not visually lossless … The noise rule picks Q 8 for two of the six timed (series, G) cells" | measured, as a candidate (interim) |
| G (group, keyframe distance) | 8 | `optimal.rs:10`, used at `main.rs:31` | **chosen by no measurement**: `payload-format.md`, "no G is measured per modality yet, so G is the caller's"; `docs/lines/codecs.md`, "No G is decided for DBT." | none |
| speed | `--good --cpu-used=6` | `optimal.rs:84` | `encoder-settings.md`: "no reason recorded for the lossy view" (chosen on lossless bytes) | none |
| passes, tune, denoise | 1, `psnr`, 0 | `optimal.rs:84–85` | `encoder-settings.md`: "no reason recorded" / "none recorded" (libaom's own defaults) | none |
| rate control | quantizer held at Q, delta-q and AQ off | `optimal.rs:84–85` | `encoder-settings.md`: "every main-arm `--q-hist` entry at Q" on 700 cells | measured |
| lookahead, alt-ref | 0, off | `optimal.rs:88` | `encoder-settings.md`: "every temporal unit one shown frame, decoded in display order"; marked open there | theory |
| chroma | coded 4:0:0 | `optimal.rs:66`, `:75`, `:86` | `encoder-settings.md`: +0.20–0.23 % bytes for 4:2:0, measured lossless only | measured (lossless) |
| bit depth | 8 at ≤ 8 bits, else 10; above 10 always the depth cut | `optimal.rs:13`, `:35–44` | `docs/av1/README.md`, the owner 2026-11-10: "D ≤ 10 at its own depth, the depth cut only for D > 10" | owner |

## Ingest: the receiver and the bundle

| default | value | set at | chosen by | kind |
| --- | --- | --- | --- | --- |
| serving tree | `<root>/<Study>/<Series>.sbnd`, `study.db` | `ingest/receiver/src/lib.rs:250–251`, `:390` | `docs/adr/pacs-receiver.md`: "a placeholder for #152's layout, which is Open" | none |
| header cap | 4 KiB | `ingest/receiver/src/package.rs:14` | stated in `pacs-receiver.md`; no reason found | none |
| group cap | 64 MiB | `package.rs:15` | stated in `pacs-receiver.md`; no reason found | none |
| metadata cap | 1 GiB | `package.rs:17` | `pacs-receiver.md`: "a placeholder until the largest series is measured" | none |
| study database | WAL, `synchronous=FULL` | `ingest/receiver/src/study_db.rs:65–66` | `pacs-receiver.md`: "the rows change together or not at all" | theory |
| codec when the metadata names none | HTJ2K | `lib.rs:474` | no reason found | none |
| frame alignment | none, frames back to back | `common/series-bundle/src/writer.rs:51–56` | `docs/disk-layout/README.md`: "nothing pads a frame to a sector or a page" | none |
| writer buffer | 8 KiB | `writer.rs:37` | `disk-layout/README.md`: "(b) is a tie. `pack-series` keeps its 8 KiB `BufWriter`." | measured (a tie) |
| `fsync` | none | `writer.rs:32–35` | `disk-layout/README.md`: "There is still no `fsync`" | none |

The receiver has no port or AE title: it takes two directories (`ingest/receiver/src/main.rs:8`).

## Client

*Filled from the client survey; see below.*

## What this table finds

**Open.** The `none` rows are condition 3's work. Those a page already owns: G 8 (`ingest-optimal-quality` §7), Q 8
(`visually-lossless` item 5), the idle timeout and keep-alive (`transport-idle-sessions`, proposed). The rest have no
owner. The two ingests differ on the view above 10 bits (`ingest.py` codes 12 bits at profile 2; the product's
`optimal.rs` cuts or refuses), as `docs/lines/optimal-quality.md` already says.
