# MERGE-BASELINE: today's tips, measured before any merge

Row MERGE-BASELINE of `docs/queue-merge-2026-11-15.md`. Started 2026-11-15T12:48Z. Host: one 4-core cloud
container, no GPU, headless Chromium (playwright 1.63.0 preinstalled, not README's 1.56.1). Fixtures: the repository's
committed ones for the gate; `dbts_a1` alone (of the three timed DBT volumes) for `demo-check.mjs`.

## Static measures (read with git, no checkout)

Commands: `docs/queue/MERGE-BASELINE/measure.sh REF` (the gate run: `tip.sh BRANCH` beside it) — non-blank lines of tracked files ending .rs .ts .js .mjs .cjs .sh .py .cpp .cc .c .h
.hpp .go .wgsl .html .css, with dist/, built/, pkg/, node_modules/ and package-lock.json excluded; docs/ counts .md lines.
URL parameters: `q.get("…")`/`q.has("…")` (and params/searchParams) in client/ outside native/, contract/, tests and
check pages; head.js's lab gate list is not counted as product. Features: `[features]` keys of the non-lab workspace
members, `default` excluded. Server levers: `LabLevers`' fields.

### `claude/unified-client` at `e5b20cba8d`

| path | non-blank code lines |
| --- | ---: |
| server/ | 6977 |
| client/ without client/native/ | 15709 |
| client/native/ | 3005 |
| ingest/ | 1976 |
| deploy/ | 305 |
| scripts/ | 1666 |
| lab/ | 62303 |
| docs/ (all .md lines, blank excluded) | 33674 |

* URL parameters the product's client reads (3): fill overlay view 
* URL parameters lab/viewer/ reads, behind head.js's lab gate (17): after busy check cine deadline fill hash metadata mutate opts origin post settle trace view writer wt 
* Cargo features of the product crates, default excluded (10):server:telemetry server:lab-frame-cache server:lab-levers server:lab-classify server:uring server:cert-compression client/native:decode client/native:paint client/native:window client/transport/wasm:console_error
* Server lab levers, LabLevers' fields under lab-levers (6): force_pool_reads hold_sessions stall_after_bytes segmentation_offload send_window_follows_cwnd reply_repeated_initial 

### `claude/unified-codecs` at `9c050c073b`

| path | non-blank code lines |
| --- | ---: |
| server/ | 6764 |
| client/ without client/native/ | 11496 |
| client/native/ | 0 |
| ingest/ | 1688 |
| deploy/ | 270 |
| scripts/ | 1347 |
| lab/ | 62741 |
| docs/ (all .md lines, blank excluded) | 28666 |

* URL parameters the product's client reads (3): check deadline fill 
* URL parameters lab/viewer/ reads, behind head.js's lab gate (6): hash metadata opts origin post wt 
* Cargo features of the product crates, default excluded (7):server:telemetry server:lab-frame-cache server:lab-levers server:lab-classify server:uring server:cert-compression client/transport/wasm:console_error
* Server lab levers, LabLevers' fields under lab-levers (4): force_pool_reads hold_sessions stall_after_bytes segmentation_offload 

### `claude/unified-server` at `b9abdc290f`

| path | non-blank code lines |
| --- | ---: |
| server/ | 6959 |
| client/ without client/native/ | 11229 |
| client/native/ | 0 |
| ingest/ | 1673 |
| deploy/ | 270 |
| scripts/ | 1349 |
| lab/ | 61349 |
| docs/ (all .md lines, blank excluded) | 27759 |

* URL parameters the product's client reads (3): check deadline fill 
* URL parameters lab/viewer/ reads, behind head.js's lab gate (6): hash metadata opts origin post wt 
* Cargo features of the product crates, default excluded (7):server:telemetry server:lab-frame-cache server:lab-levers server:lab-classify server:uring server:cert-compression client/transport/wasm:console_error
* Server lab levers, LabLevers' fields under lab-levers (5): force_pool_reads hold_sessions stall_after_bytes segmentation_offload advise_tile_names 

### `claude/unified-pacs` at `7afeb9cac2`

| path | non-blank code lines |
| --- | ---: |
| server/ | 7324 |
| client/ without client/native/ | 11278 |
| client/native/ | 0 |
| ingest/ | 4868 |
| deploy/ | 270 |
| scripts/ | 1355 |
| lab/ | 74859 |
| docs/ (all .md lines, blank excluded) | 36422 |

* URL parameters the product's client reads (3): check deadline fill 
* URL parameters lab/viewer/ reads, behind head.js's lab gate (6): hash metadata opts origin post wt 
* Cargo features of the product crates, default excluded (8):server:telemetry server:lab-frame-cache server:lab-levers server:lab-classify server:uring server:cert-compression carrier:quic client/transport/wasm:console_error
* Server lab levers, LabLevers' fields under lab-levers (4): force_pool_reads hold_sessions stall_after_bytes segmentation_offload 

### `claude/line-hygiene` at `8d5112fd74`

| path | non-blank code lines |
| --- | ---: |
| server/ | 6919 |
| client/ without client/native/ | 11240 |
| client/native/ | 0 |
| ingest/ | 1672 |
| deploy/ | 430 |
| scripts/ | 1369 |
| lab/ | 60803 |
| docs/ (all .md lines, blank excluded) | 27616 |

* URL parameters the product's client reads (3): check deadline fill 
* URL parameters lab/viewer/ reads, behind head.js's lab gate (6): hash metadata opts origin post wt 
* Cargo features of the product crates, default excluded (7):server:telemetry server:lab-frame-cache server:lab-levers server:lab-classify server:uring server:cert-compression client/transport/wasm:console_error
* Server lab levers, LabLevers' fields under lab-levers (5): force_pool_reads hold_sessions stall_after_bytes segmentation_offload send_window_follows_cwnd 
