# MERGE-ALL-PLAN: every line into one unified branch, the plan (findings only)

Row MERGE-ALL-PLAN of `docs/queue-client-2026-11-14.md` (amendments 8 and 13). Read from `origin` at 23:15 UTC on
2026-11-14; test merges in a detached local worktree, **nothing merged or pushed but this file**. Every count here is
re-derivable with §6's commands; they change with every push.

## Summary for the owner's approval

The proposed shape: each line's branches merge `--no-ff` into that line's unified branch, oldest base first; then the
line branches merge into **one** branch, proposed name **`claude/unified`**, started from `claude/unified-client` (it
already holds `main`, the demo tip and `av1-unified-mainbase`); then the preparation for `main` as rows of their own.

| stage | merges | with conflicts | conflicting files | hunks |
| --- | --- | --- | --- | --- |
| A1 codecs line → `claude/unified-codecs` | 30 | 18 | 31 | 91 |
| A2 server line → `claude/unified-server` | 8 | 6 | 26 | 56 |
| A3 PACS line → `claude/unified-pacs` | 0 | — | — | — |
| A4 client line (client, native, devices, coordination docs) → `claude/unified-client` | 63 | 47 | 197 | 332 |
| B1 `unified-codecs` (after A1) → `claude/unified` | 1 | 1 | 11 | 21 |
| B2 `unified-server` (after A2) → `claude/unified` | 1 | 1 | 31 | 63 |
| B3 `unified-pacs` → `claude/unified` | 1 | 1 | 7 | 25 |
| B4 `line-hygiene` → `claude/unified` | 1 | 1 | 29 | 46 |
| B5 `line-viewer` (parked) | — | — | — | not tested: call M5 |

Most A-stage conflicts are the line docs (`docs/lines/*.md`) and index files; the code conflicts are few and named in
§3–§4. **After B the default build does not compile** under the provisional resolution used to keep the test going
(four errors in `series-server`, from the server and PACS lines' `server.rs`: §4); with A alone, `series-server`
compiles. So B2 and B3 need a real resolution written by a session, reviewed by another.

The owner's calls (§7): **M1** the pre-`mainbase` AV1 lineage (14 branches; `claude/av1` alone conflicts in 240 files,
and 160 `client/conformance/av1` files are named nowhere on the tip); **M2** the core's lab runs of 10-30 to 11-04
(rows the 11-02 fold left out); **M3** the one-queue product change of 10-16; **M4** nine small branches whose text was
rewritten since; **M5** the viewer line; **M6** proposals in product paths (PRs 368, 370, 372, 376, 378, 390, 309,
265): merging one adopts it; **M7** the work ledger; **M8** the name `claude/unified`; **M9** `hw-probe`, in progress.

## 1. Scope and method

* 334 remote branches. **155 are carried** (ancestors of `main` or of a `claude/unified-*` tip): main 7,
  unified-client 70, unified-pacs 55, unified-server 11, unified-codecs 3, several 9. **179 are not.** Of those, 52 are
  contained by another uncarried branch and come in with it (named in §2's "Carries"); **127 tips** are judged in §2.
* "Commits not on the tip" is `git cherry` against the line's unified tip (patch-unique commits, merges excluded);
  "added files the tip lacks" counts files the branch adds that have no path on `unified-client`'s tip: the plainest
  sign of work not carried.
* Line by subject; target by base: a branch merges into the unified branch it is built on. Every tip here is built on
  `unified-client`'s lineage (or on `av1-unified-mainbase`, which both `unified-client` and `unified-codecs` hold), so
  three branches with server or PACS subjects built on the demo tip (`demo-network`, `hostnet-theory`, `ingest-oq`)
  follow `unified-client` (a first pass with them in the server line dragged 362–414 client commits each).
* Test merges: per line, cumulative, `git merge --no-ff`, oldest merge base first. A conflict is recorded (files,
  hunks, kinds) and then **resolved provisionally as the unified side** so the next step can be tested; that is not the
  proposed resolution, which §3's last column states. The `history` and `superseded` branches are not in the run
  (call M1; with them, A1 gains 240 + 28 conflicting files).
* Fixtures and limits: one read of `origin`; PR numbers from `refs/pull/*/head` matched to branch tips by commit (a PR
  whose head moved on shows no number) and the open set from the PR list; no gate run (one `cargo build -p
  series-server` per stage, §5); nothing judged from a branch's content beyond its commits, file lists, line docs and
  the PR titles. Relevance lines are one reading each; a call that is a judgment is in §7.

## 2. Inventory: the 127 tips, by line

Verdicts: **merge** (relevant work not carried); **patch** (carried by patch-equivalent commits); **superseded** (named
what); **history** (carried in content, history not joined: M1); **no** (not relevant, why); **owner** (a call, §7).

#### codecs (35)

| branch | PR | last commit | commits not on the tip (patch-unique) | added files the tip lacks | verdict | why |
| --- | --- | --- | --- | --- | --- | --- |
| `av1-unified` | (35 closed) | 2026-10-11 | 1336 | 6/1004 | superseded | `av1-unified-mainbase` is its re-rooting on `main` (1 070 of 1 332 files identical; row results present); joining the old history is call M1. Carries `av1-unified-pre-main`. |
| `av1` | — | 2026-10-12 | 1110 | 462/671 | history | the AV1 queue's own lineage from 09-10: 462 of its 671 added files have no path on the tip; most moved in the lab's reorganisation (`lab/av1/svcshape` is `lab/av1/delivery/scalable/shape`), but `client/conformance/av1` (160 files) is named nowhere on the tip; call M1. Carries `av1-pre-main`. |
| `wip-dockerread` | — | 2026-10-13 | 1441 | 7/1239 | superseded | row 195 on the pre-mainbase work branch; its protocol is on the tip (call M1). |
| `wip-213-INTERSLICE` | — | 2026-10-14 | 1444 | 7/1246 | superseded | INTERSLICE measured (bytes ×0.965); result on the tip (7 files) (call M1). |
| `video-containers-research-ed5fg2` | (42 closed) | 2026-10-16 | 4 | 17/17 | merge | `docs/video-containers/` (17 files) absent from the tip; tag `archive/42-video-containers` holds an older form. |
| `av1-mainbase` | — | 2026-10-17 | 1392 | 467/676 | history | the AV1 queue's lineage to 10-17 (rows 261–271, merged there as #82–#101): 467 of 676 added files have no path on the tip, as for `av1`; call M1. |
| `av1-visually-lossless` | #291 | 2026-11-02 | 1 | 1/1 | merge | PR 291, `docs/av1/visually-lossless.md` absent. |
| `av1-lcevc-lossy` | #292 | 2026-11-02 | 1 | 0/0 | owner | PR 292, LCEVC not worth building: edits to three AV1 docs, no new file; call M4. |
| `us-data-search` | #313 | 2026-11-04 | 3 | 0/0 | merge | PR 313, the ultrasound data search in `docs/FIXTURES.md` (2 commits, no file identical). |
| `av1-grey-path` | #308 | 2026-11-04 | 8 | 16/16 | merge | PR 308, grey-path protocol run, 16 files absent. |
| `av1-top-first` | #310 | 2026-11-04 | 12 | 21/21 | merge | PR 310, TOPFIRST measured, 21 files absent. |
| `av1-paint-depth` | #309 | 2026-11-04 | 31 | 36/36 | merge | PR 309, paint depth behind a flag (`client/paint` touched: a cleaning question, call M6). |
| `av1-lossy-pixel-work` | #307 | 2026-11-04 | 46 | 29/29 | merge | PR 307, PIXELWORK, 29 files absent. Carries `av1-residual-apart`. |
| `av1-top10-why` | #304 | 2026-11-04 | 23 | 42/42 | merge | PR 304, why the top 10 bits cost more, 42 files absent. |
| `av1-preview-depth` | #312 | 2026-11-04 | 49 | 68/68 | merge | PR 312, PREVIEWDEPTH measured, 68 files absent. |
| `av1-quality-profiles` | #290 | 2026-11-04 | 135 | 73/73 | merge | PR 290, the quality profiles, 73 files absent (base of several study branches). |
| `av1-profile-carriers` | #306 | 2026-11-05 | 174 | 72/72 | merge | PR 306, CARRIERS, 72 files absent. |
| `av1-split-preview-b` | #311 | 2026-11-05 | 102 | 88/88 | merge | PR 311, split preview B measured. |
| `htj2k-progressive` | #295 | 2026-11-05 | 33 | 166/166 | merge | PR 295, HTJ2K quality layers measured, 166 files absent. |
| `av1-webcodecs-profiles` | #318 | 2026-11-07 | 1 | 1/1 | merge | PR 318, `docs/av1/webcodecs-profiles.md` absent (also carried by `browser-decoding`). |
| `av1-preview-noise` | #316 | 2026-11-07 | 229 | 104/104 | merge | PR 316, preview noise; contains `snr-preview`, `profile-carriers` work. Carries `av1-snr-preview`. |
| `av1-residual-exact` | #315 | 2026-11-07 | 7 | 16/16 | merge | PR 315, RESIDEXACT verdict. |
| `av1-vl-metrics` | #325 | 2026-11-09 | 71 | 79/79 | merge | PR 325, `vl-metrics.md`. |
| `av1-window-q` | #323 | 2026-11-09 | 73 | 81/81 | merge | PR 323, WINDOWQ. |
| `av1-audit-quality` | #329 | 2026-11-10 | 2 | 1/1 | merge | PR 329, `docs/av1/audit-quality.md`. |
| `av1-noise-ratio-line` | #335 | 2026-11-10 | 2 | 0/0 | merge | PR 335, one line-doc edit (codecs). |
| `demo-e2e-line` | #347 | 2026-11-10 | 1 | 0/0 | merge | PR 347, one line-doc edit (optimal quality), based on PR 340. |
| `av1-audit-decode` | #334 | 2026-11-10 | 2 | 1/1 | merge | PR 334, `docs/av1/audit-decode.md`. |
| `browser-decoding` | #339 | 2026-11-10 | 16 | 2/2 | merge | PR 339, `docs/decode/browser.md`. |
| `av1-encoder-settings` | #331 | 2026-11-10 | 4 | 1/1 | merge | PR 331, `docs/av1/encoder-settings.md`. |
| `av1-groups-settings` | #352 | 2026-11-10 | 101 | 111/112 | merge | PR 352, the groups settings amendment (contains PR 326 `av1-groups`). Carries `av1-groups`, `av1-quality-metrics`. |
| `av1-noise-ratio` | #332 | 2026-11-10 | 72 | 90/90 | merge | PR 332, noise ratio (contains PR 317 `noise-point`). Carries `av1-noise-point`. |
| `av1-svc-preview` | #283 | 2026-11-11 | 89 | 35/35 | merge | PR 283, scalable preview as a tool. |
| `audit-measure` | #373 | 2026-11-12 | 68 | 20/20 | merge | PR 373, audit protocols measured (contains PR 357 `av1-corrections`). Carries `av1-corrections`. |
| `htj2k-tiles` | #324 | 2026-11-12 | 123 | 31/31 | merge | PR 324, HTJ2K levels and regions. |

#### server (15)

| branch | PR | last commit | commits not on the tip (patch-unique) | added files the tip lacks | verdict | why |
| --- | --- | --- | --- | --- | --- | --- |
| `ccr-10b47d42-tr6zpv` | #37 | 2026-10-14 | 1424 | 6/1191 | superseded | row 181 IWDEEP on the pre-mainbase branch; IWDEEP's results are on the tip (9 files) (call M1). |
| `wip-210-ASKTHENFILLMEASURE` | (38 closed) | 2026-10-14 | 1445 | 9/1241 | superseded | row 210 measured, not adopted; result in `docs/transport/link-conditions.md` on the tip (call M1). |
| `wip-212-CCMEASURE` | — | 2026-10-14 | 1446 | 8/1246 | superseded | row 212 CLASSIFY measured, not default; result on the tip (call M1). |
| `wip-211-ASKFIRSTCAPMEASURE` | — | 2026-10-14 | 1440 | 7/1242 | superseded | row 211 measured; result on the tip (call M1). |
| `wip-208-DOCKERCLOUD` | — | 2026-10-14 | 1453 | 7/1258 | superseded | disk access in a cloud container (row 208); on the tip (call M1). |
| `project-thread-9jumbi` | #39 | 2026-10-14 | 1 | 0/0 | no | PR 39, asks first under a 6 MiB window as default: measured and not adopted (row 211). |
| `project-thread-9jumbi-212` | #40 | 2026-10-14 | 1 | 0/0 | no | PR 40, `cubic-classify` as default: not adopted (row 212; `cubic-restart` stays, O9). |
| `wip-276-ONEQUEUEPRODUCT` | #96 | 2026-10-16 | 2 | 0/0 | owner | PR 96, one queue in the product: 2 commits, no file identical on the tip; call M3. |
| `wip-253-ONEQUEUEMEASURE` | (92 closed) | 2026-10-16 | 4 | 3/3 | owner | one-queue measurement rows (`lab/ask-ahead/onequeue.py`, rows) absent from the tip; call M3. Carries `wip-252-ONEQUEUEBUILD`. |
| `deploy-dry-run` | #129 | 2026-10-21 | 11 | 3/3 | merge | PR 129: `deploy/build-arm64.sh`, `client/viewer/page.sh`, `scripts/grey_series.sh` absent from the tip. Carries `arm64-server-build`, `deploy-readme-host-nginx`, `page-without-transport-file`, `smoke-not-a-default`. |
| `readmin-cut-stream` | #136 | 2026-10-22 | 2 | 0/0 | owner | PR 136, a readMin naming fix in three docs; files since rewritten; call M4 (small docs, may be carried by edit). |
| `d4-workstation-results` | #130 | 2026-10-22 | 2 | 1/1 | merge | PR 130, `lab/scripts/payload_guard.sh` (a timing guard) absent from the tip. |
| `scroll-policies` | #203 | 2026-10-28 | 10 | 10/10 | merge | PR 203, SCROLLPOLICY reviewed: `lab/ask-ahead/askstream*` absent from the tip. Carries `ask-during-fill-measure`, `design-p2-ask-during-fill`. |
| `beeper-ebpf-explore` | — | 2026-10-29 | 2 | 0/0 | owner | kTLS/sendfile and the WebSocket fallback, two docs edits; transport is a separate session's subject (O5); call M4. |
| `rootless-podman-and-selinux` | — | 2026-11-09 | 1 | 0/0 | owner | one commit to `deploy/README.md`, `README.md`, the decoder build; call M4. |

#### hygiene (1)

| branch | PR | last commit | commits not on the tip (patch-unique) | added files the tip lacks | verdict | why |
| --- | --- | --- | --- | --- | --- | --- |
| `line-hygiene` | #256 | 2026-10-30 | 56 | 32/32 | merge | PR 256, the hygiene line branch: 56 commits not on any unified branch (tests in `common/`, `client/viewer/page.sh`). Carries `client-audit-r5`, `client-simplify-r5`, `design-simplification-sweep`, `queue-status-232-236`, `server-audit-r5`, `server-licence-notices`, `server-simplify-r5`, `simplification-u9-u12-audit`, `test-race-asyncfd`, `test-separation`. |

#### client (37)

| branch | PR | last commit | commits not on the tip (patch-unique) | added files the tip lacks | verdict | why |
| --- | --- | --- | --- | --- | --- | --- |
| `onerror` | — | 2026-10-03 | 0 | 0/0 | patch | its one commit is patch-equivalent to one on the tip (`git cherry`). |
| `wip-214-DISPLAYTAGS` | — | 2026-10-14 | 1441 | 7/1241 | superseded | `docs/display.md` row 214 on the pre-mainbase branch; the tip names DISPLAYTAGS once, the "corrupted transfers" count is absent (call M1). |
| `wip-219-VIEWERASKS` | — | 2026-10-14 | 0 | 0/0 | patch | both commits patch-equivalent on the tip. |
| `wip-226-GATEGAPS` | — | 2026-10-14 | 0 | 0/1 | patch | both commits patch-equivalent on the tip. |
| `askjump-measure` | #138 | 2026-10-22 | 3 | 3/4 | merge | PR 138, ASKJUMP rows and script absent from the tip (lab rows). |
| `telemetry-production-design` | #143 | 2026-10-24 | 2 | 1/1 | merge | PR 143, `docs/adr/telemetry-in-production.md`; read beside `telemetry-client` (PR 370), which carries a later form. |
| `opfs-cache-measure` | #204 | 2026-10-28 | 2 | 0/0 | owner | PR 204: a merge and a docs edit to `frame-path.md`, rewritten since; call M4. Carries `opfs-cache-build`, `opfs-multigb`. |
| `cache-policy` | #207 | 2026-10-28 | 2 | 0/0 | owner | PR 207: frame-path's keep-on-device section, ACR sections corrected; may predate the tip's text; call M4. |
| `ask-patterns-map` | #224 | 2026-10-28 | 2 | 0/0 | owner | PR 224: the asking patterns mapped onto the wire (glossary, ADR); call M4. Carries `ask-patterns-survey`. |
| `coldrtt-hint` | #208 | 2026-10-28 | 4 | 1/1 | merge | PR 208, COLDRTT rows absent from the tip. |
| `core-exp2` | #265 | 2026-10-30 | 24 | 4/16 | merge | PR 265, experiment 2 (k = 8 adopted by the rule): wait-ahead rows absent; 12 of 33 files identical. |
| `cine-no-skip` | #251 | 2026-10-30 | 9 | 0/0 | owner | PR 251, cine sweeps pinned; based on `viewer-requirement-fixes` (carried); call M4. Carries `viewer-requirement-fixes`. |
| `core-asking-plan` | #298 | 2026-11-02 | 2 | 1/1 | merge | PR 298, `docs/adr/asking-policy.md` absent from the tip. |
| `core-clock` | — | 2026-11-03 | 294 | 89/115 | owner | the frame clock's Chromium run, no verdict; item 11's removal waits for the owner (coordination Open 7); call M2. |
| `opfs-theory` | — | 2026-11-03 | 247 | 91/111 | merge | frame-path's OPFS arm parameters as inequalities; carries the 10-30 fold (call M2). |
| `core-m5b` | #301 | 2026-11-03 | 33 | 7/7 | merge | PR 301, M5 under the amended bar: rows absent from the tip. |
| `core-start2` | #294 | 2026-11-03 | 374 | 93/121 | merge | PR 294, frame-path §7 the start, both engines; rows absent; carries the 10-30 fold (call M2). |
| `core-busy2` | #296 | 2026-11-03 | 461 | 96/124 | merge | PR 296, frame-path §7 the busy page, B′ wins; contains `core-fold-2026-10-30`, `core-s7`, `frame-memory-m5-run` (call M2). Carries `core-decoders`, `core-exp1`, `core-fold-2026-10-30`, `core-m5`, `core-native`, `core-perf`, `core-review`, `core-s7`, `decoders-committed`, `frame-memory-m5-run`, `paint-read`, `serene-rubin-wakfg7`, `view-start`, `vw-exp-1-review`, `worker-clock-build`. |
| `core-s7-fixed` | — | 2026-11-03 | 392 | 98/126 | merge | frame-path §7 again with both fixes, Chromium (call M2). |
| `core-onepass` | #303 | 2026-11-04 | 1 | 0/0 | no | PR 303, onePass ported to core; coordination says `av1-unified-mainbase` merges in place of #303, and the tip has it. |
| `opfs-c-shared` | — | 2026-11-04 | 273 | 115/135 | merge | C-shared and A-left on Chromium; contains `opfs-arms-run` (PR 285) (call M2). Carries `opfs-arms-run`. |
| `client-architecture-division-rfri34` | — | 2026-11-06 | 1 | 0/0 | owner | the client's four subsystems (docs/viewer, glossary, CLAUDE.md edit); superseded in part by `docs/client/` (PR 384); call M4. |
| `oq-integrity-build` | #368 | 2026-11-11 | 42 | 7/7 | merge | PR 368, the integrity proposal (I1–I3); a proposal, decided by the owner (O14). |
| `telemetry-client` | #370 | 2026-11-11 | 28 | 15/15 | merge | PR 370, the load report, off by default (O17). |
| `demo-network` | #372 | 2026-11-11 | 5 | 2/2 | merge | PR 372, `scripts/demo-network.py` and its test (a server subject on the demo tip, so it follows `unified-client`). |
| `hidden-page-decode` | #376 | 2026-11-12 | 8 | 1/1 | merge | PR 376, the late decode deadline fix (D3). |
| `ingest-oq` | — | 2026-11-12 | 2 | 1/1 | merge | `docs/reviews/ingest-oq.md` (a pacs subject on the demo tip, so it follows `unified-client`). |
| `hostnet-theory` | — | 2026-11-12 | 3 | 1/1 | merge | `docs/transport/network-mode.md` (a server subject on the demo tip, so it follows `unified-client`). |
| `lossless-under-loss` | #378 | 2026-11-12 | 10 | 5/5 | merge | PR 378, a lost exact ask asked again (D2; review found it re-asks every rejection: fix first). |
| `docs-client` | #384 | 2026-11-14 | 53 | 58/58 | merge | PR 384, the client's documentation home; base of the 11-14 rows. |
| `link-targets` | #386 | 2026-11-14 | 8 | 17/17 | merge | PR 386, into `docs-client`. |
| `hw-decode` | #387 | 2026-11-14 | 12 | 16/16 | merge | PR 387, into `docs-client`. |
| `cache-plan` | #385 | 2026-11-14 | 12 | 17/17 | merge | PR 385, into `docs-client`. |
| `depth8` | #389 | 2026-11-14 | 13 | 20/20 | merge | PR 389, into `docs-client`. |
| `report-plan` | #388 | 2026-11-14 | 12 | 18/18 | merge | PR 388, into `docs-client`. |
| `transport-design` | #391 | 2026-11-14 | 54 | 58/58 | merge | PR 391, into `docs-client` (contains it). |
| `oq-ingest` | #321 #390 | 2026-11-14 | 7 | 1/1 | merge | PR 390 into `unified-client` (PR 321 the older target). |

#### native (3)

| branch | PR | last commit | commits not on the tip (patch-unique) | added files the tip lacks | verdict | why |
| --- | --- | --- | --- | --- | --- | --- |
| `native-step1-check` | #211 | 2026-10-28 | 1 | 3/3 | merge | PR 211, native step-1 rows and `cold_fill.rs` absent from the tip. |
| `native-parity` | #277 | 2026-10-30 | 233 | 78/98 | merge | PR 277, `client/native/src/{load,look,resume}.rs` absent from the tip; carries the 10-30 fold (call M2). |
| `native-metrics` | #278 | 2026-10-30 | 256 | 79/99 | merge | PR 278, native metrics; contains `native-parity`'s base and the 10-30 fold (call M2). |

#### devices (6)

| branch | PR | last commit | commits not on the tip (patch-unique) | added files the tip lacks | verdict | why |
| --- | --- | --- | --- | --- | --- | --- |
| `phone-run` | — | 2026-11-11 | 0 | 0/14 | patch | merge commits only; its content arrived through `phone-protocol` and the demo tip. |
| `phone-protocol` | — | 2026-11-11 | 4 | 0/0 | merge | PR 359, `docs/devices.md` §7 notes; 4 commits not on the tip. |
| `phone-devtools` | — | 2026-11-11 | 10 | 12/12 | merge | `lab/phone/devtools.py`; base of `hidden-page-decode-beacon`. |
| `fill-split` | — | 2026-11-12 | 26 | 40/40 | merge | `docs/phone-rows/` and `lab/phone/fill.py` (D5). Carries `link-calibration`, `phone-rows`, `phone-tools`. |
| `hidden-page-decode-beacon` | #377 | 2026-11-12 | 17 | 12/12 | merge | PR 377, visibility in the beacon (contains PR 369 `phone-tools`). |
| `hw-probe` | — | 2026-11-14 | 10 | 22/22 | merge | `lab/devices/` probe, in progress (merge only once HW-PROBE-PAGE is done). |

#### coordination (28)

| branch | PR | last commit | commits not on the tip (patch-unique) | added files the tip lacks | verdict | why |
| --- | --- | --- | --- | --- | --- | --- |
| `wip-215-CLEANAUDIT` | — | 2026-10-14 | 1442 | 7/1241 | superseded | `docs/merge-readiness.md` of 10-14, on the pre-mainbase branch; the tip has the file (call M1). |
| `next-ideas-cdydy8` | — | 2026-10-17 | 2 | 1/1 | no | `docs/next/ideas.md`, a 10-17 note; its one rule ("lab-only code stays in the review project") is superseded by the 11-04 rule (coordination §Decisions). |
| `project-thread-9uugfm` | — | 2026-10-21 | 26 | 17/17 | no | session handoff notes under `handoff/` (10-17 to 10-22); line state lives in `docs/lines/` now (11-11 decision). |
| `day-summary-2026-10-27` | #205 | 2026-10-27 | 1 | 0/0 | no | PR 205, titled "not to merge"; an empty commit. |
| `merge-order-2026-10-28` | #217 | 2026-10-28 | 2 | 1/1 | no | PR 217, a merge order of 10-28; superseded by `merge-plan` and this report. |
| `probe-sched-20261029-gh-yes` | — | 2026-10-29 | 1 | 0/0 | no | an empty probe commit ("a created session can push"). |
| `merge-order-2026-10-29` | #257 | 2026-10-30 | 1 | 1/1 | no | PR 257, the blockers of 10-29; superseded as above. |
| `repo-inventory` | — | 2026-11-09 | 1 | 1/1 | no | `docs/inventory-2026-11-09.md`, temporary by its own terms (removed once the owner has decided). |
| `plan` | #338 | 2026-11-10 | 2 | 1/1 | merge | PR 338, `docs/lines/plan.md`, cited by coordination §State now. |
| `reviews-2026-11-10` | — | 2026-11-10 | 7 | 1/1 | merge | a dated brief cited by DOCS-SWEEP (Part 1). |
| `demo-simplify` | — | 2026-11-11 | 1 | 1/1 | merge | `docs/lines/proposals.md` §Simplify (also on `proposals`). |
| `fable-simplify` | #366 | 2026-11-11 | 2 | 1/1 | merge | PR 366, `docs/proposals/simplify-fable.md`. |
| `demo-pre-main-review` | — | 2026-11-11 | 4 | 1/1 | merge | `docs/reviews/pre-main.md`. |
| `merge-plan` | — | 2026-11-11 | 3 | 1/1 | merge | `docs/reviews/merge-plan.md`, the two merge words' plan. |
| `slice-touch` | — | 2026-11-11 | 1 | 1/1 | merge | `docs/reviews/slice-touch.md`. |
| `dataset-hub` | — | 2026-11-11 | 1 | 1/1 | merge | `docs/reviews/dataset-hub.md`. |
| `demo-review-2` | — | 2026-11-11 | 6 | 1/1 | merge | `docs/reviews/review-2.md`. |
| `demo-understand` | — | 2026-11-11 | 6 | 3/3 | merge | `docs/reviews/understand/` (defaults, names, clean). |
| `dav1d-lazy` | — | 2026-11-11 | 84 | 24/24 | merge | `lab/proposals/` and P6; also on `proposals`. |
| `oq-integrity` | — | 2026-11-11 | 84 | 24/24 | merge | `docs/lines/proposals.md` §Integrity; also on `proposals`. |
| `direction` | — | 2026-11-12 | 8 | 0/0 | merge | the line docs rewritten for two weeks (DOCS-SWEEP K3); docs-client carries them by edit. |
| `fable-design` | #383 | 2026-11-12 | 2 | 1/1 | merge | PR 383, `docs/proposals/design-fable.md`. |
| `reviews-2026-11-11` | — | 2026-11-12 | 1 | 1/1 | merge | the Wednesday brief, cited by DOCS-SWEEP. |
| `lab-off-main` | — | 2026-11-12 | 1 | 1/1 | merge | `docs/reviews/lab-off-main.md`. |
| `lines-ready` | — | 2026-11-12 | 4 | 1/1 | merge | `docs/reviews/lines-ready.md`. |
| `reviews-2026-11-13` | — | 2026-11-13 | 1 | 1/1 | merge | the Friday brief. |
| `proposals` | #358 | 2026-11-13 | 178 | 66/66 | merge | PR 358, the proposals consolidated (contains `dav1d-lazy`, `oq-integrity`). |
| `work-ledger` | — | 2026-11-14 | 783 | 138/138 | no | the queue ledger: status files and queues, not product or documentation of record; call M7. |

#### viewer (2)

| branch | PR | last commit | commits not on the tip (patch-unique) | added files the tip lacks | verdict | why |
| --- | --- | --- | --- | --- | --- | --- |
| `viewer-spike` | #214 | 2026-10-28 | 2 | 20/20 | owner | PR 214, the viewer line's spike; the viewer line is parked (call M5). |
| `viewer-seam2` | #300 | 2026-11-03 | 22 | 36/36 | owner | PR 300, the seam on the real core; viewer line parked (call M5). Carries `line-viewer`, `viewer-a-step1`, `viewer-requirements`, `viewer-seam`. |

## 3. Stage A: each line into its unified branch, test merges

Order within a line: oldest merge base first, then oldest tip (a branch's dependents after it). One correction to the
run's order: `docs-client` (PR 384) goes **before** the seven 11-14 branches built on it (`link-targets`, `hw-decode`,
`cache-plan`, `depth8`, `report-plan`, `transport-design`, `hw-probe`); the run merged it after them, so its row shows
the one conflict left by the provisional resolution. `hw-probe` waits for HW-PROBE-PAGE (M9).

#### codecs -> unified-codecs

| # | merge | PR | conflicting files | hunks | kinds | resolution the later decisions imply |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `video-containers-research-ed5fg2` | (42 closed) | 2: `.gitignore`, `lab/README.md` | 2 | UU:2 | index or list files: union |
| 2 | `av1-visually-lossless` | #291 | 0 | 0 | — | clean |
| 3 | `av1-top10-why` | #304 | 0 | 0 | — | clean |
| 4 | `av1-preview-depth` | #312 | 0 | 0 | — | clean |
| 5 | `av1-quality-profiles` | #290 | 0 | 0 | — | clean |
| 6 | `av1-split-preview-b` | #311 | 0 | 0 | — | clean |
| 7 | `av1-profile-carriers` | #306 | 2: `client/decode/av1-webcodecs.js`, `docs/av1/README.md` | 3 | UU:2 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; index or list files: union |
| 8 | `av1-preview-noise` | #316 | 0 | 0 | — | clean |
| 9 | `av1-vl-metrics` | #325 | 1: `docs/av1/README.md` | 2 | UU:1 | index or list files: union |
| 10 | `av1-window-q` | #323 | 1: `docs/av1/README.md` | 1 | UU:1 | index or list files: union |
| 11 | `av1-noise-ratio` | #332 | 1: `lab/av1/metrics/README.md` | 1 | UU:1 | docs and lab: the later text, the branch's result added beside it |
| 12 | `av1-groups-settings` | #352 | 1: `docs/lines/codecs.md` | 3 | AA:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 13 | `av1-svc-preview` | #283 | 1: `docs/av1/README.md` | 1 | UU:1 | index or list files: union |
| 14 | `av1-paint-depth` | #309 | 1: `docs/glossary.md` | 1 | UU:1 | glossary: union of rows, one name per concept |
| 15 | `av1-lossy-pixel-work` | #307 | 0 | 0 | — | clean |
| 16 | `av1-lcevc-lossy` | #292 | 0 | 0 | — | clean |
| 17 | `htj2k-progressive` | #295 | 6: `client/decode/av1-webcodecs.js`, `lab/av1/delivery/scalable/tool/decoder.js`, `lab/av1/delivery/scalable/tool/make_frames.py`, `lab/av1/delivery/scalable/tool/shapes.py` and 2 more | 30 | AA:3 UU:3 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; docs and lab: the later text, the branch's result added beside it |
| 18 | `av1-grey-path` | #308 | 0 | 0 | — | clean |
| 19 | `us-data-search` | #313 | 2: `docs/FIXTURES.md`, `lab/av1/data.json` | 5 | UU:2 | docs and lab: the later text, the branch's result added beside it |
| 20 | `av1-top-first` | #310 | 0 | 0 | — | clean |
| 21 | `av1-webcodecs-profiles` | #318 | 0 | 0 | — | clean |
| 22 | `av1-residual-exact` | #315 | 0 | 0 | — | clean |
| 23 | `av1-audit-quality` | #329 | 2: `docs/av1/README.md`, `docs/lines/codecs.md` | 4 | UU:2 | index or list files: union; line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 24 | `av1-encoder-settings` | #331 | 2: `docs/lines/codecs.md`, `docs/lines/optimal-quality.md` | 3 | UU:2 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 25 | `av1-audit-decode` | #334 | 2: `docs/lines/README.md`, `docs/lines/codecs.md` | 4 | UU:2 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 26 | `av1-noise-ratio-line` | #335 | 1: `docs/lines/codecs.md` | 4 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 27 | `browser-decoding` | #339 | 2: `docs/av1/webcodecs-profiles.md`, `docs/lines/codecs.md` | 18 | AA:1 UU:1 | docs and lab: the later text, the branch's result added beside it; line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 28 | `audit-measure` | #373 | 2: `docs/av1/README.md`, `docs/lines/codecs.md` | 4 | UU:2 | index or list files: union; line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 29 | `htj2k-tiles` | #324 | 1: `docs/lines/codecs.md` | 2 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 30 | `demo-e2e-line` | #347 | 1: `docs/lines/optimal-quality.md` | 3 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |

#### server -> unified-server

| # | merge | PR | conflicting files | hunks | kinds | resolution the later decisions imply |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `wip-276-ONEQUEUEPRODUCT` | #96 | 9: `client/contract/clauses.ts`, `client/transport/ts/frame-session.ts`, `client/transport/ts/test/run.ts`, `client/transport/wasm/src/lib.rs` and 5 more | 16 | UU:9 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; docs and lab: the later text, the branch's result added beside it |
| 2 | `wip-253-ONEQUEUEMEASURE` | (92 closed) | 3: `client/transport/downloader.js`, `client/transport/downloader.test.mjs`, `server/src/transport/planner.rs` | 10 | UU:3 | code: the tip's later form, the branch's change re-applied only where its own row adopted it |
| 3 | `d4-workstation-results` | #130 | 1: `lab/scripts/workstation_run.sh` | 1 | UU:1 | docs and lab: the later text, the branch's result added beside it |
| 4 | `scroll-policies` | #203 | 11: `client/transport/downloader.js`, `client/transport/downloader.test.mjs`, `lab/ask-ahead/README.md`, `lab/ask-ahead/cells.py` and 7 more | 27 | UU:11 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; docs and lab: the later text, the branch's result added beside it |
| 5 | `deploy-dry-run` | #129 | 0 | 0 | — | clean |
| 6 | `readmin-cut-stream` | #136 | 0 | 0 | — | clean |
| 7 | `beeper-ebpf-explore` | — | 1: `docs/levers.md` | 1 | UU:1 | docs and lab: the later text, the branch's result added beside it |
| 8 | `rootless-podman-and-selinux` | — | 1: `deploy/README.md` | 1 | UU:1 | code: the tip's later form, the branch's change re-applied only where its own row adopted it |

#### pacs -> unified-pacs

| # | merge | PR | conflicting files | hunks | kinds | resolution the later decisions imply |
| --- | --- | --- | --- | --- | --- | --- |

#### client -> unified-client

| # | merge | PR | conflicting files | hunks | kinds | resolution the later decisions imply |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `onerror` | — | 2: `client/conformance/dispatch-rig.ts`, `client/downloader/downloader.js` | 0 | DU:2 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; deleted on one side (a rename or a cleaning): stays deleted |
| 2 | `wip-219-VIEWERASKS` | — | 10: `client/README.md`, `client/transport/downloader.js`, `client/transport/downloader.test.mjs`, `client/viewer/check-page.js` and 6 more | 23 | DU:1 UU:9 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; deleted on one side (a rename or a cleaning): stays deleted; docs and lab: the later text, the branch's result added beside it |
| 3 | `wip-226-GATEGAPS` | — | 6: `README.md`, `client/contract/dispatch-rig.ts`, `client/scripts/check_telemetry_absent.sh`, `ingest/from-dicom/end_to_end_test.py` and 2 more | 12 | AA:1 UU:5 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; docs and lab: the later text, the branch's result added beside it |
| 4 | `askjump-measure` | #138 | 2: `client/decode/decoder.test.mjs`, `client/transport/downloader.test.mjs` | 4 | AA:1 UU:1 | code: the tip's later form, the branch's change re-applied only where its own row adopted it |
| 5 | `telemetry-production-design` | #143 | 0 | 0 | — | clean |
| 6 | `coldrtt-hint` | #208 | 4: `client/decode/av1.js`, `client/viewer/viewer.js`, `ingest/coded-frames/ingest.py`, `lab/av1/tools/ingest_coded.py` | 4 | UU:4 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; docs and lab: the later text, the branch's result added beside it |
| 7 | `cine-no-skip` | #251 | 6: `client/README.md`, `client/viewer/check-page.js`, `client/viewer/check.mjs`, `client/viewer/run_check.sh` and 2 more | 11 | DU:1 UU:5 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; deleted on one side (a rename or a cleaning): stays deleted |
| 8 | `ask-patterns-map` | #224 | 0 | 0 | — | clean |
| 9 | `cache-policy` | #207 | 4: `docs/adr/README.md`, `docs/adr/frame-path-sources.txt`, `docs/adr/frame-path.md`, `docs/native/README.md` | 4 | UU:4 | docs and lab: the later text, the branch's result added beside it; index or list files: union |
| 10 | `opfs-cache-measure` | #204 | 2: `docs/ARCHITECTURE.md`, `docs/adr/frame-path.md` | 5 | UU:2 | docs and lab: the later text, the branch's result added beside it |
| 11 | `native-step1-check` | #211 | 0 | 0 | — | clean |
| 12 | `core-exp2` | #265 | 9: `CLAUDE.md`, `README.md`, `client/transport/downloader.js`, `client/transport/downloader.test.mjs` and 5 more | 14 | AA:2 UU:7 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; docs and lab: the later text, the branch's result added beside it |
| 13 | `native-parity` | #277 | 27: `.gitignore`, `README.md`, `client/native/src/clock.rs`, `client/native/src/view.rs` and 23 more | 64 | AA:2 DU:6 UU:19 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; deleted on one side (a rename or a cleaning): stays deleted; docs and lab: the later text, the branch's result added beside it; glossary: union of rows, one name per concept; index or list files: union |
| 14 | `native-metrics` | #278 | 3: `.gitignore`, `lab/native-fill/browser.mjs`, `lab/native-fill/run.py` | 1 | DU:2 UU:1 | deleted on one side (a rename or a cleaning): stays deleted; docs and lab: the later text, the branch's result added beside it; index or list files: union |
| 15 | `core-start2` | #294 | 16: `client/paint/painter.js`, `client/transport/consumer.js`, `client/transport/downloader.js`, `client/transport/downloader.test.mjs` and 12 more | 41 | UU:16 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; docs and lab: the later text, the branch's result added beside it; glossary: union of rows, one name per concept; index or list files: union |
| 16 | `core-busy2` | #296 | 6: `client/view/view-worker.js`, `client/view/view.js`, `client/viewer/viewer.js`, `docs/adr/frame-path.md` and 2 more | 15 | UU:6 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; docs and lab: the later text, the branch's result added beside it |
| 17 | `opfs-theory` | — | 1: `docs/adr/frame-path.md` | 2 | UU:1 | docs and lab: the later text, the branch's result added beside it |
| 18 | `core-s7-fixed` | — | 7: `client/view/view-worker.js`, `client/view/view.js`, `client/viewer/viewer.js`, `docs/adr/frame-path.md` and 3 more | 17 | UU:7 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; docs and lab: the later text, the branch's result added beside it |
| 19 | `core-clock` | — | 1: `docs/adr/frame-path.md` | 1 | UU:1 | docs and lab: the later text, the branch's result added beside it |
| 20 | `opfs-c-shared` | — | 8: `docs/adr/frame-path.md`, `lab/opfs-arms/README.md`, `lab/opfs-arms/feeder.js`, `lab/opfs-arms/page.js` and 4 more | 2 | DU:7 UU:1 | deleted on one side (a rename or a cleaning): stays deleted; docs and lab: the later text, the branch's result added beside it |
| 21 | `client-architecture-division-rfri34` | — | 0 | 0 | — | clean |
| 22 | `core-asking-plan` | #298 | 1: `docs/adr/README.md` | 1 | UU:1 | index or list files: union |
| 23 | `core-m5b` | #301 | 7: `lab/opfs-cache/README.md`, `lab/opfs-cache/arms-decoder.js`, `lab/opfs-cache/arms-view.js`, `lab/opfs-cache/arms.js` and 3 more | 1 | DU:6 UU:1 | deleted on one side (a rename or a cleaning): stays deleted; docs and lab: the later text, the branch's result added beside it |
| 24 | `plan` | #338 | 0 | 0 | — | clean |
| 25 | `reviews-2026-11-10` | — | 0 | 0 | — | clean |
| 26 | `oq-integrity` | — | 0 | 0 | — | clean |
| 27 | `dav1d-lazy` | — | 1: `docs/lines/proposals.md` | 2 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 28 | `fable-simplify` | #366 | 0 | 0 | — | clean |
| 29 | `reviews-2026-11-11` | — | 0 | 0 | — | clean |
| 30 | `fable-design` | #383 | 0 | 0 | — | clean |
| 31 | `reviews-2026-11-13` | — | 0 | 0 | — | clean |
| 32 | `proposals` | #358 | 1: `docs/lines/proposals.md` | 2 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 33 | `demo-simplify` | — | 2: `docs/lines/optimal-quality.md`, `docs/lines/proposals.md` | 2 | AA:1 UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 34 | `demo-understand` | — | 1: `docs/lines/optimal-quality.md` | 1 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 35 | `demo-pre-main-review` | — | 1: `docs/lines/coordination.md` | 1 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 36 | `slice-touch` | — | 1: `docs/lines/optimal-quality.md` | 1 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 37 | `demo-review-2` | — | 1: `docs/lines/optimal-quality.md` | 1 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 38 | `phone-run` | — | 1: `docs/lines/optimal-quality.md` | 2 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 39 | `phone-protocol` | — | 1: `docs/lines/optimal-quality.md` | 1 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 40 | `oq-integrity-build` | #368 | 8: `client/README.md`, `client/decode/decoder.js`, `client/view/controller.js`, `client/viewer/index.html` and 4 more | 16 | UU:8 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 41 | `dataset-hub` | — | 0 | 0 | — | clean |
| 42 | `phone-devtools` | — | 5: `client/view/controller.js`, `client/viewer/head.js`, `docs/lines/optimal-quality.md`, `lab/viewer/levers.js` and 1 more | 6 | UU:5 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; docs and lab: the later text, the branch's result added beside it; line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 43 | `telemetry-client` | #370 | 8: `client/viewer/viewer.js`, `deploy/web-files.sh`, `docs/adr/README.md`, `docs/adr/telemetry-in-production.md` and 4 more | 11 | AA:1 UU:7 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; docs and lab: the later text, the branch's result added beside it; index or list files: union; line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 44 | `merge-plan` | — | 1: `docs/lines/coordination.md` | 2 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 45 | `demo-network` | #372 | 3: `README.md`, `docs/devices.md`, `docs/lines/optimal-quality.md` | 3 | UU:3 | docs and lab: the later text, the branch's result added beside it; line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 46 | `hidden-page-decode-beacon` | #377 | 2: `lab/phone/beacon.js`, `lab/phone/beacon.test.mjs` | 2 | UU:2 | docs and lab: the later text, the branch's result added beside it |
| 47 | `fill-split` | — | 2: `docs/lines/optimal-quality.md`, `scripts/gate.sh` | 3 | UU:2 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 48 | `lines-ready` | — | 0 | 0 | — | clean |
| 49 | `ingest-oq` | — | 1: `docs/lines/optimal-quality.md` | 1 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 50 | `lab-off-main` | — | 0 | 0 | — | clean |
| 51 | `direction` | — | 6: `docs/lines/README.md`, `docs/lines/client.md`, `docs/lines/codecs.md`, `docs/lines/coordination.md` and 2 more | 13 | UU:6 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 52 | `hostnet-theory` | — | 0 | 0 | — | clean |
| 53 | `hidden-page-decode` | #376 | 1: `docs/lines/client.md` | 1 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 54 | `lossless-under-loss` | #378 | 3: `client/README.md`, `client/view/controller.js`, `client/view/controller.test.mjs` | 5 | UU:3 | code: the tip's later form, the branch's change re-applied only where its own row adopted it |
| 55 | `link-targets` | #386 | 7: `docs/adr/README.md`, `docs/adr/frame-path.md`, `docs/glossary.md`, `docs/lines/README.md` and 3 more | 11 | UU:7 | docs and lab: the later text, the branch's result added beside it; glossary: union of rows, one name per concept; index or list files: union; line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 56 | `hw-decode` | #387 | 1: `docs/lines/client.md` | 1 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 57 | `cache-plan` | #385 | 1: `docs/lines/client.md` | 1 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 58 | `report-plan` | #388 | 1: `docs/lines/client.md` | 1 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 59 | `depth8` | #389 | 2: `docs/lines/client.md`, `docs/lines/codecs.md` | 2 | UU:2 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 60 | `oq-ingest` | #321 #390 | 1: `docs/av1/payload-format.md` | 1 | UU:1 | docs and lab: the later text, the branch's result added beside it |
| 61 | `transport-design` | #391 | 11: `client/README.md`, `docs/WIRE.md`, `docs/adr/exactness-in-production.md`, `docs/adr/stride-is-bandwidth-conservation.md` and 7 more | 16 | UU:11 | code: the tip's later form, the branch's change re-applied only where its own row adopted it; docs and lab: the later text, the branch's result added beside it; glossary: union of rows, one name per concept; line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 62 | `docs-client` | #384 | 1: `docs/lines/README.md` | 1 | UU:1 | line docs: the tip's text (the work-state form of `docs/client/` PR 384), the branch's new lines carried by edit |
| 63 | `hw-probe` | — | 0 | 0 | — | clean |


