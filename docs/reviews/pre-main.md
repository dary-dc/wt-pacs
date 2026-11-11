# Pre-main review: `main...claude/demo-fixes-0`

Row PRE-MAIN-REVIEW of the 2026-11-10 queue, for MAIN-REVIEW. The diff is what PR 250 lands on main:
`origin/main...36d286cd`, 306 files, +31 697 −1 061; the product paths (`server/`, `common/`, `client/transport`,
`client/decode`, `client/view`, `client/viewer`, `deploy/`) are 64 of them, +6 772 −449. The reviewer wrote none of
the demo work. Findings only; nothing is fixed here. Lines are in the demo tip's files. Severity: **blocker** (main
should not take it as is), **should-fix**, **nit**.

## 1. Server, `common/`, `deploy/`

No blocker found. Checked and clean: the endpoint built by hand (`server.rs` `build_endpoint`, `bind_udp`: the same
calls as wtransport's builder, the same binds, `h3` first in ALPN), ALPN routing of the raw-QUIC `wt-pacs/1` session,
`closed_by_peer` over quinn's error types, the per-frame `finish()` then `stopped()`, `dev-server.py`'s exact pair
(loopback only, two fixed paths, no traversal), lab levers behind `lab-levers` (default features `uring` only),
`check_fod_len` moved to `common/fod` unchanged, `web-files_test.sh` in the gate, `comment_budget.sh` ok.

| # | severity | where | finding | smallest fix |
| --- | --- | --- | --- | --- |
| S1 | should-fix | `deploy/nginx/wt-pacs.conf.template:46-56`, `deploy/README.md` §Run it | The image cannot serve an optimal-quality series: `client/viewer/viewer.js:36-48` fetches the exact series' `/series/<id>/metadata` and `/wt/<id>/dev-transport.json`, which nginx answers 404 (`location / { return 404; }`), and the page stops with "error: refused: … answered 404". `dev-server.py` gained `--exact-*` for this; the deploy has nothing. | Say in `deploy/README.md` that the image serves HTJ2K series only, an OQ series needing its exact pair. |
| S2 | should-fix | `server/src/transport/wire.rs:9-28`, `link.rs:185-192`, `server.rs:418` | A `QuicStream<S>` trait with four impls (one the identity on `quinn::RecvStream`) and `impl Trait` parameters, to save `.quic_stream_mut()` at about five call sites, most in tests; `docs/native/README.md` §8.3 names concrete quinn streams. CLAUDE.md §Code: no speculative abstraction. | Concrete `&mut quinn::RecvStream` / `SendStream` parameters; delete the trait. |
| S3 | nit | `server/src/transport/server.rs:111` | `accept()` returning `None` returns `Err("the QUIC endpoint stopped")` and skips `endpoint.close`/`wait_idle`; `docs/native/README.md:404` says a `None` ends the loop. Unreachable today. | `None => break`, or correct the doc. |
| S4 | nit | `server/src/transport/server.rs:68,125` | `STOPPING` is a wtransport `VarInt` converted at run time with a `?` that cannot fail. | `const STOPPING: quinn::VarInt = quinn::VarInt::from_u32(0x100)`. |
| S5 | nit | `deploy/web-files.sh:10,14` | `viewer/store.js` listed twice; line 14 about 150 columns. | Drop it from line 14. |
| S6 | nit | `common/fod/src/lib.rs:74` | The moved test `fod_len_zero_and_huge_are_refused_before_allocation` states no claim. | A one-line doc comment. |
| S7 | nit | `common/fod/src/lib.rs:1` | Module doc says "on the WebTransport bidirectional control stream"; it also serves raw QUIC now. | "on the session's bidirectional control stream". |

## 4. Off the default path: what main would take and could leave it

`CLAUDE.md` and the queue's decided approaches: lab code stays on its line branch while used; main stays deployable.
PR 250 lands, beside the product:

| what | size | on main today | why it is off the default path | where it could go |
| --- | --- | --- | --- | --- |
| `client/native/` (raw-QUIC client, wgpu painter, window) | +3 303, new | no | not served by the image nor used by the page; a workspace member, so `deploy/Containerfile` now copies it to build with `--locked` (`docs/lines/native.md` §State now) | its own line PR after the native decisions of `docs/native/README.md` §7, or kept with the Containerfile copy |
| `lab/target-review/` | +1 015, new | no | its README calls itself "throwaway probes … indicative only, not claims" | an archive tag |
| `lab/opfs-cache/`, `lab/opfs-arms/`, `lab/frame-clock/`, `lab/paint-read/`, `lab/recv-loop/`, `lab/native-fill/` | +1 376, +750, +672, +388, +527, +397, new | no | harnesses of protocols in `docs/adr/frame-path.md`; only `lab/native-fill` is named by `scripts/gate.sh` | the line branch while used, then an archive tag; the verdicts stay in `docs/adr/frame-path.md` |
| `lab/av1/`, `lab/viewer/` | +3 498, +1 168 | yes (grown) | the AV1 study's and viewer's measurement code | stays under `lab/`, as on main |
| `client/decode/wasm/built/` (dav1d, OpenJPH, XXH3 WASM, notices) | 3 binaries, ~880 KB, +1 481 notice lines | no | on the default path: the page loads them; listed here because committing builds reverses main's "built on the host" (`deploy/Containerfile` comment changed), and `gate.yml`'s `decoders` job is removed | keep, if the owner accepts committed builds pinned by `manifest.sha256`; the gate's rebuild here reproduced them byte for byte (§5) |
