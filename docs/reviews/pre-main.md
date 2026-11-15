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

## 2. `client/transport`, `client/decode`

No blocker on the default page view (`view=page`, `client/viewer/viewer.js:20`). Checked and clean: the AV1 route
(`av1.js:46-82`: WebCodecs first; dav1d only after a refused probe, no `VideoDecoder`, a failed load or a failed
decode; the refusal carried to the frame, `decoder.js:93-108`; asserted call by call in `av1.test.mjs`), the digest
taken over the bytes handed on, the 9-bit rule of `av1-frame.js:63-64` against `ingest.py` `wide()`, `merge()`
checked over 288 cells, the depth cut decoding at 10 bits on the WebCodecs path against native dav1d's SHAs, the
default transport path (`heldAcks` off; `serveWant` and `fail` inert with an empty order), `wasm/built/` holding
exactly the ten files `build/manifest.sha256` names with matching hashes, and `dist/session.js` equal to its pin.

| # | severity | where | finding | smallest fix |
| --- | --- | --- | --- | --- |
| T1 | should-fix | `client/transport/downloader.js:69-75` (with `:266-268`, `:369`, `:450-451`) | `fail()` now calls `serveWant()`, and runs inside the give-up loops. When `resume()` runs out of re-dials with no session, the owed asks reach 0 and `addToFill` creates new `wire` records for the order's unsent frames after the `[...records]` snapshot: they are never failed and wait silently; in the `onError` loop the first `fail` can move the rest of `wanted` into `ended`, re-asked one by one instead of failed. The want path only (`?view=worker`). | `order.clear()` before the give-up loops, or fail by snapshot and call `serveWant()` once after. |
| T2 | should-fix | `client/decode/decoder.js:83` | Under the lab lever `writer: "decoders"`, `cache.kept` holds each exact frame's pixels until a `write` arrives, and three paths never send one (`consumer.js:101` generation mismatch, `store.js:49` duplicate `put`, `store.js:112` already present); the promise of `consumer.js:115` never settles if the decoder is replaced, so `store.js:57` never acks and `replace()` downloads again. | Drop kept frames on a generation change; resolve `#writes` with `false` in `#end` and on a port replaced. |
| T3 | should-fix | `client/decode/av1.js:13` | A 516-character one-line doc comment, which is how `av1.js` stays at 0.17 under the 0.18 budget; it documents `onePass`, on by default, which ties two unrelated behaviours (the split frame merged in one pass, `av1.js:61`; the `mono_chrome` chroma check skipped, `av1-webcodecs.js:153`). Its `false` branches, and `reuseCopyBuffer` (off, lab only), are kept for measurement only. | The config's description to `docs/` with a one-line pointer; drop `onePass: false` or split it into two named levers. |
| T4 | nit | `client/transport/downloader.js:222` | The second copy of a frame in hand (a head crossed on the run and its ask) is now dropped, which fixes main's double decode (covered by "dispatched … once"), but its buffer never returns to the ring (no leak: `take()` allocates). Default path. | `session?.releaseWireBuffer(frame.bytes.buffer)` before the return. |
| T5 | nit | `client/decode/frame-buffer.js`, `decoder.js:83-84` | Lab levers `pixels: "transfer"` with `writer: "decoders"`: the kept pixels are detached when written, so a 0-byte entry fails its digest on read. | Refuse the combination, or copy before the transfer. |
| T6 | nit | `client/decode/depth-cut.browser.mjs:73` | `/undecodable/` matches every WebCodecs error (`av1-webcodecs.js:118` prefixes all), so "refused, the refusal named" passes for any failure; the second frame never asserts WebCodecs was not tried again. | Log WebCodecs calls as `av1.test.mjs` does; match the specific reason. |
| T7 | nit | `client/decode/av1-webcodecs.js:3` | "Only ≤ 10 bits, where it is exact" is stale: an OQ frame over 10 bits is now tried here first. | Correct the line. |
| T8 | nit | `README.md:16` | Says `fetch_openjph.sh` fetches the HTJ2K decoder the page runs; the page loads the committed `wasm/built/openjph` (`wasm-glue.js` `built()`); `vendor/` serves the contract glues only. | Correct the line. |
| T9 | nit, not new | `client/decode/av1.js:60` | When the top picture rejects, `Promise.all` leaves the low picture in flight, and the next payload's low call can share its stream's `got`/`wake`/`finally` and close the newer frame. | `Promise.allSettled`, or await the low before the fallback. |

## 3. `client/view`, `client/viewer`

No blocker. Checked and clean: the label rule (`controller.js:179-185`: Lossless needs `e.frame === f` and
`f.info.exact === true`, `e.frame` set only on a passed check; every race traced — a step mid-ask, `showLossy`
mid-ask, a step mid-paint, a stale reply — fails safe, at worst *optimal* over an exact frame), `l`'s retry after a
failed check (test at `controller.test.mjs:446`), `checkPair` requiring xxh3-64 digests, the exact frame painted
without the cut, page–worker message failures said once and fatal, no polling or timers on the default page, comment
budget within limit.

| # | severity | where | finding | smallest fix |
| --- | --- | --- | --- | --- |
| V1 | should-fix | `client/viewer/viewer.js:83-84`, `index.html:31` | On the default page every optimal-quality frame shows a grey **unchecked** badge top left beside *Optimal quality* top right, and the status line counts "unchecked N": OQ metadata has no `digests` (`lab/av1/tools/ingest_coded.py:60-65` writes them only when not lossy), so `decoder.js:45` returns `exact: "unchecked"`. README §Demo names only the label and status line; `demo-check.mjs` never reads `#mark`. Checked by reading. | On a lossy series leave the mark off for `"unchecked"` (the label carries it), or document the badge. |
| V2 | should-fix | `client/viewer/head.js:5`, `lab/viewer/levers.js:23`, `check-page.js` | `cine` was added to the lab list, so `?check=1&cine=1` (`check.mjs:84`, `run_check.sh --cine`) now loads `lab/viewer/levers.js`, where `cine` means seconds of lab cine, while `check-page.js` reads it as "run the cine check"; on the web image, which serves no `lab/`, `check.mjs --url … --cine` is refused. `client/README.md` still lists `?cine=` as the page's own. One name, two concepts. | Rename the lab lever (`cineSeconds`) and take `cine` out of `head.js`. |
| V3 | should-fix | `client/view/check.js:180`, `view-worker.js:382`, `deploy/web-files.sh:14` | `hold()` builds synthetic frames with `exact: true` and feeds `controller.take`; any page code reaches it through the worker's generic `check` RPC (`lab/frame-clock/page.js:38` does), and the image ships `view/check.js`, `view/clock.js`, `viewer/check-page.js`. | Move `hold` and the lab-only clock under `lab/`. |
| V4 | should-fix | `client/viewer/viewer.js:331`; `view.js`, `view-worker.js` | Lab levers in product code: `q.get("mutate")` on the page; `lab.settle`, `opts.viewWorkerFirst`/`glAfterDial`/`pageDials`/`holdEveryOther`/`waitAhead`, `boot` stamps through `fillAround`, `play`/`tick`/`cine`. Inert with no parameters (`lab` is `{opts:{}}`). CLEAN-FIND owns the sweep. | At least `mutate` into `levers()` as `flip`. |
| V5 | should-fix | `client/viewer/pair.js:31` | `framesSha256` is compared only when both carry it: an exact series whose metadata lacks it (stale, hand-made) passes, and frames of another source with equal count, size, depth and sign can be labelled Lossless. The demo's metadata carries it on both sides (`fetch_data.py:163`), so the demo is safe today. | Refuse when the OQ series has it and the exact series' differs or is missing; add that case to `pair.test.mjs` (only the OQ-lacks-it case is tested, line 28). |
| V6 | should-fix | `client/view/controller.js:233`, `view.js:43`, `view-worker.js:376` | `valueAt` exists on four layers with no caller outside tests; `web-files.sh` ships `paint/reference.js` partly for it. | Remove until a probe needs it. |
| V7 | nit | `client/viewer/viewer.js:266` | Any key is swallowed while the **lossless** (or cine) button has focus: after a click, arrows, `l`, Home do nothing. | Skip only `" "`/`Enter` there, or `blur()` after the click. |
| V8 | nit | `client/viewer/viewer.js:211` | The button decides by `qualityEl.className`: stepping off an exact frame to one not yet arrived leaves `lossless`, so a press calls `lossy()`, which does nothing. | Branch on `shown.quality`. |
| V9 | nit | `client/viewer/viewer.js:36-49` | The exact series' metadata and transport are fetched before the main dial (a round trip before the first picture) and a 404 is fatal (see S1), while `connectExact` failures degrade. | Fetch in parallel; keep `checkPair` refusals fatal, let a fetch failure hide the button. |
| V10 | nit | `client/viewer/demo-check.mjs:111` | Waits on `/^Lossless/`, which also matches "Lossless check failed…", so `losslessMs` can time a failure (the labels check still catches it). It is a rehearsal tool that starts servers; not shipped. | `=== "Lossless"`; move it to `scripts/` or `lab/`. |
| V11 | nit | `client/view/controller.test.mjs` | "a scroll through a group after a jump" with G = 1 runs no steps and cannot fail. | Drop the G = 1 case or assert a step. |
| V12 | nit | `client/view/view-worker.js:313`, `cache.js:206`, `frame-file.js` | The per-file cache keys on the WebTransport URL and its digest covers only samples, so the trailer's width/height/bits/min/max are trusted. Only under the lab lever `?writer=`, never for an OQ series; the packed store worker compares the whole digest list (`viewer/store.js:59`). | Key on the series' digests, or hash the trailer. |
| V13 | nit | `client/viewer/viewer.js:322` | Under `?check=1` the page view's close leaves the exact downloader open (the worker closes both, `view-worker.js:383`). | Close both. |
| V14 | nit | `docs/glossary.md:35,50` | "client cache" and "cache" define one concept twice. | One entry. |

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

**Commit metadata.** In `origin/main..36d286cd`, 93 of 311 commits are authored `Claude <noreply@anthropic.com>`
and 9 `darian`, and 57 messages carry a `Co-Authored-By` trailer, against `CLAUDE.md` §Agents. History is not
rewritten here (no force-push); whether PR 250 lands squashed is the owner's.

## 5. The gate on the demo tip

`scripts/gate.sh` in full on `36d286cd`, in a fresh 4-core cloud container without a GPU, 2026-11-11: **GATE OK in
649 s**, rc 0, tree clean after. Built first: `client/decode/wasm/build/build.sh` (rc 0, 5 min), `ingest/tools.sh`
(libaom 3.15.1, dav1d 1.5.4, OpenJPH 0.31.0), the WASM and TypeScript clients, `fetch_openjph.sh`, `fetch_xxh3.sh`,
the ingest venv (`PYTHON=.venv/bin/python`), dockerd and meson 1.9.1 as `README.md` §Prerequisites says. The
decoders rebuilt from their pins are the committed bytes. Skipped by name: the native painter and window checks (no
Mesa lavapipe, Xvfb, xdotool), the viewer's cross-codec arm and Firefox (no DICOM bundles, no GL display), and the
web host's equivalence check (no nginx), so S1's nginx paths are not exercised here. CI runs those.

Setup nit: the gate refuses at the first missing prerequisite, so a fresh container meets them one run at a time
(wasm-pack, then the decoder vendor); the cloud paragraph of §Prerequisites could say "every command above, then".
