# COMPLEXITY-AUDIT: what the merges added to `claude/unified`

Row COMPLEXITY-AUDIT of `docs/queue-merge-2026-11-15.md` (read and measure; no edit of `claude/unified`). Audited
`claude/unified` at `ff2bc154` (draft PR 402) against `MERGE-BASELINE-report.md`'s five tips. Started 2026-11-16T02:41Z.
Every command and raw output is in `docs/queue/COMPLEXITY-AUDIT/`. Host: one 4-core cloud container; nothing timed.
Fixtures: none beyond the repository's; one study DB built from the receiver's own schema (below).

## The ranked list

Kind: **fix** (a defect, a failing test first), **mechanical** (the plan's §6 items 1, 2, 4, 5, 6 — UNIFIED-CLEAN may do
it), **removal** (the owner's yes), **proposal** (structural: designed and reviewed before it is built, `CLAUDE.md`).
"Merges added" says whether the item is new on `claude/unified` or was already on a line tip.

| # | item | merges added? | proposed cleaning (one commit each) | kind |
| ---: | --- | --- | --- | --- |
| 1 | **Two study-DB schemas, and the verifier cannot read the receiver's.** `ingest/receiver/src/study_db.rs` writes `xxh3 TEXT` (16 hex) plus a `series` column and an `audit` table; `common/study-db` (used only by `tools/pacs-verify` and its tests) writes `xxh3 INTEGER` and is, by `tools/pacs-verify/README.md`, "the one place the receiver and this tool share". The receiver does not depend on it. Run: a `study.db` in the receiver's schema, one row, read by `pacs-verify` → `FAIL … groups: series: Invalid column type Text at index: 2, name: xxh3` (`study-db-schemas.sh`, `.log`). No test joins the two. | no: identical on `unified-pacs` | a failing test (pacs-verify over a receiver-written study), then one schema: the receiver's table definitions and hash form in `common/study-db`, both crates on it; README corrected in place | fix (the PACS line's; its schema choice is a decision) |
| 2 | **The owner's first name in three public files**: `handoff/metadata-2026-10.md` (from `unified-pacs`; a session hand-off with notes about the owner), `docs/video-containers/README.md:228` (from `merge-a-codecs`), `docs/reviews/pre-main.md:89` (from `merge-a-client`, an author audit). Against the standing rule "no private names". Not on `unified-client` or `main`. | yes, two of three | replace the name by "the owner" in the two docs; `handoff/` (a top-level directory outside `docs/`, a dated hand-off of PR 113) removed or folded into `docs/ingest/` | mechanical (the two docs); removal (`handoff/`) |
| 3 | **A gate step that runs nothing**: `scripts/gate.sh:222` "lab: M5's rule on made-up rows…" has no `run` line since `13f1edb7` moved `lab/opfs-cache/summary_test.py` off (carried from `unified-client`, MERGE-B-FIX's note). The recap counts it as a passed step. | no: on `unified-client` | delete the step line | mechanical |
| 4 | **Two names of one concept in the glossary**: *lossy stream* and *quality profile* (`docs/glossary.md:56,60`) beside *optimal quality* / *optimal-quality series* (`:61`), each defined as a series' lossy AV1 frames at one Q and G. 17 lines outside the glossary use the older two (e.g. `docs/av1/README.md`, `docs/av1/profile-carriers.md`, `docs/av1/visually-lossless.md`); no product code does. (MERGE-B's note.) | yes (codecs' text beside client's) | one name, *optimal quality*; *quality profile*'s three roles kept only if a doc still decides on them, else marked historical in place | mechanical (§6 item 5) |
| 5 | **Two readers of the parser's group file**: `ingest/from-parser/src/group.rs` (`records`, a map of every top-level tag, `(u16,u16)` keys) and `ingest/receiver/src/group.rs` (`value`, one tag, `u32` key, every record walked). Both refuse a key of 0 or not a multiple of 8 and skip nested keys; they differ on a tag written twice: from-parser keeps the last, the receiver the first (read, not run). One format, `docs/ingest/contract.md` §Group files. | no: both on `unified-pacs` | one reader in a common crate, both callers on it, which duplicate wins decided and tested | proposal |
| 6 | **Lab levers in `Sessions` as field pairs**: `server/src/transport/server.rs` holds five lab-lever values (`advise_tile_names`, `stall`, `cwnd_ahead`, `fill_resumes`, `ask_stream`) each with a `cfg(feature)` / `cfg(not(feature))` pair; `cfg(not(feature = "lab-levers"))` arms in `server/src` 3 → 6, `cfg(feature = "lab-levers")` 20 → 25 against `unified-client`. Every lever is behind `lab-levers` (§6 item 4 holds; `check_lab_absent.sh` OK), but the default build compiles the fields and their branches as constants. `LabLevers` fields 6 → 9 (`advise_tile_names` from the server line; `fill_resumes_after_asks`, `ask_stream_priority` from `merge-a-server`, ported at B2). | yes (+3 levers, +3 pairs) | one `lab: LabLevers` field, `LabLevers::default()` the product's (all off), so each pair becomes one read | proposal (small; touches the lever tests) |
| 7 | **`lab/` grew to 104 334 non-blank code lines** (62 303 on `unified-client`; the union of the five tips' lab trees). The absence check passes (no lab crate or module in the images or the default build), but `main`'s rule is "`lab/` the harness only". | yes (union) | a list of `lab/` directories no gate step and no line doc's *Open* item reads, for the owner's yes, before the `main` preparation rows | removal |
| 8 | **`docs/` doubled**: 33 674 → 70 911 non-blank `.md` lines; new or grown: `docs/client/` (59 files, none on `unified-client`), `docs/av1/` 12 → 32, `docs/reviews/` 9 → 22, `docs/adr/` 15 → 25, `docs/ingest/` 4 → 13, `docs/video-containers/` 8, `docs/lines/` 8 → 11, 17 top-level files (11). Not read for contradictions file by file; items 1 and 4 are the two found. | yes (union) | the §6 item 5 reconciliation of `docs/lines/*.md`, plus a pass for two files owning one subject | mechanical (§6 item 5) |
| 9 | **Two HTTP/3 stacks**: `carrier` (the PCS upload receiver) on `h3`/`h3-quinn`/`hyper` behind `--features quic`, beside `series-server` on `wtransport`/`quinn`. Different jobs (resumable upload vs. WebTransport); one QUIC library underneath. Recorded, not a duplicate of one job. | no: on `unified-pacs` | none | — |

Checked and found clean: **dependencies** — `Cargo.lock` holds 447 packages, every one in some tip's lock (the union
less `rustix 1.1.5`, resolved away), no new crate; the one npm manifest (`client/transport/ts`) unchanged. **URL
parameters** the product client reads: 3 (`fill overlay view`), as `unified-client`. **Cargo features**: 11, the
client's 10 plus `carrier:quic`. **Environment variables** the product reads outside tests: as `unified-client`
(`WTPACS_READ_PATH`, `INGEST_BUILD`, the `LAB_FRAME_CACHE_*` three under `lab-frame-cache`). **Dead code**: the
default `cargo build` warns once (tokio's `AsyncFd::with_interest`, the baseline's); no `.rs` file undeclared; no
client, server, ingest, script or deploy file that nothing names. **Comment budget**: passes; of the 92 product files
a merge touched (against `unified-client`), the highest is `client/transport/ts/ws-session.ts` at 0.18, none over.
**Lab in product paths**: `scripts/check_lab_absent.sh` OK; every `LabLevers` field behind `lab-levers`.
**Licence notices** and **client bundles** (§6 items 1, 2): checked by the gate, green at `e2357b13` (MERGE-B-FIX-REVIEW).

Not looked for: two runners or two decoders of one job beyond the pairs above (`client/view/cache.js`'s three
writers and `client/native`'s decoder are each one line's design on `unified-client`, not a merge's); docs
contradictions beyond items 1 and 4.

## Product lines per module

Non-blank code lines (`modules.sh`, `modules.md`; vendored, built and `dist/` files excluded):

| module | unified | client | codecs | server | pacs | hygiene | where the difference comes from |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| server/src/transport | 4657 | 4212 | 4119 | 4163 | 4273 | 4203 | the four lines' changes, plus B2's ported levers and B3's raw-QUIC refusal (≈ 163 beyond the sum of the lines' deltas) |
| server/src/media | 2680 | 2139 | 2139 | 2284 | 2535 | 2149 | client's base + pacs (+396) + server (+145) |
| server/src/main | 157 | 142 | 127 | 133 | 137 | 46 | |
| ingest/receiver | 3195 | 0 | 0 | 0 | 3195 | 0 | PACS |
| ingest/from-parser | 1027 | 649 | 642 | 642 | 642 | 641 | PR 390, the optimal-quality ingest (M6), off by default |
| carrier (src, sender, tests, pcs) | 3440 | 0 | 0 | 0 | 3440 | 0 | PACS |
| common/from-disk, study-db | 152 | 0 | 0 | 0 | 152 | 0 | PACS |
| tools/pacs-verify | 670 | 0 | 0 | 0 | 670 | 0 | PACS |
| client/transport | 3395 | 3342 | 2866 | 2866 | 2879 | 2834 | |
| client/contract | 4583 | 4547 | 4546 | 4546 | 4582 | 4545 | |
| deploy | 423 | 305 | 270 | 270 | 270 | 430 | hygiene's arm64 build and notices |
| scripts | 1719 | 1666 | 1347 | 1349 | 1355 | 1369 | |

Every other module equals `unified-client`'s. The baseline's own measure (`measure.sh`, `measure-unified.txt`): server/
7978, client/ without native 15 798, client/native/ 3005, ingest/ 5549, deploy/ 423, scripts/ 1719, lab/ 104 334, docs/
70 911; the baseline counted neither `carrier/`, `common/` nor `tools/`, given above.

## For UNIFIED-CLEAN

Mechanical, each its own commit: item 3 (the empty step); item 2's two docs; item 4 (glossary, one name); item 8's
`docs/lines/` reconciliation. A failing check first where one exists: item 3 has none (a gate recap check that every
step runs at least one line would be one). Items 1, 5, 6 are proposals or a fix of the PACS line and wait for their
design; items 2's `handoff/` and 7 wait for the owner's yes.
