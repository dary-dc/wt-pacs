# Handoff: metadata from the study store (2026-10-20, 03:40 UTC)

For a session continuing this design. Branch `claude/metadata-turso`, draft PR #113 into
`claude/av1-unified-mainbase` (the owner merges; never merge). The owner, Darian, is learning: plain words, simple
diagrams, the mechanism kept; explain before asking. Read `CLAUDE.md` first. Kept current by the session that owns the
PR; the date above is its last update.

## Where everything lives

| What | Where |
| --- | --- |
| The design, its options and what is decided | `docs/ingest/metadata-draft.md` (a draft; folded into the owning docs and removed once agreed) |
| The parser's outputs, run and recorded at `f36230b` | `docs/ingest/contract.md` §The parser at `f36230b` |
| Where the study store is built (corrected in place) | `docs/ingest/design.md` §5 |
| The four stores timed on the page's read | `lab/metadata-store` (bench); numbers in `metadata-draft.md` §2 |
| The owner's general direction (do not re-ask) | `handoff/targets-2026-10.md` on branch `claude/project-thread-9uugfm` |

## Decided by the owner (do not reopen)

* **2026-10-19.** Metadata and pixels live on the same host: no network database. That rules out the libSQL server,
  Turso Cloud and libSQL's remote and replica modes.
* **2026-10-19.** The client loads only what it needs: the metadata the page uses now, and only the decoder of the
  series' codec. More is sent as features need it.
* **2026-10-19.** The parser's 2026-10-11 contract stays until a stable version is published (maybe the `.mxf` one).
  The ingest does not follow the parser's drift.
* **2026-10-19.** The PACS checks everything that arrives. When a series or study is complete is the PCS's question.
* **2026-10-19.** nginx is not a proxy in front of the WebTransport server, and is not made one for the metadata.
* **2026-10-20.** The study store is built **and updated at the PACS**, because metadata will be updated after it
  arrives. Its creation, updates, table design and files are ours. The PCS sends the parser's groups.
* **2026-10-20.** Updates are infrequent; the shape (the attributes the client needs) will change.
* **2026-10-20.** Investigate the best format before extending the benchmark.
* **Direction, 2026-10-20.** Separate two jobs: the *truth* (every attribute, kept once, addressable) and a small
  *page view* derived from it (for example one entry per series with the page's values), rebuilt when either changes.
* **Earlier, and still standing:** one database per study (2026-10-11); the catalog's engine is deferred (2026-10-11).

## Open, the owner's to decide

1. The storage format of the truth and of the page view (`metadata-draft.md` §2). The survey below informs it.
2. How the page gets the metadata and the codec (§1). Two sub-questions: should a worklist know the codec at all,
   and should the codec be written in two places (the `.sbnd` header and the metadata) or read only from the file?
3. The embedded engine, if SQLite stays (§3).
4. The PACS receiver and builder process: its units, checks, disk layout, updates while the server reads, recovery,
   running it on another machine. The design run below informs it.

## What was measured (one thread, warm cache; `metadata-draft.md` §2)

Page read for 2 000 images, median: key file 0.65 ms, SQLite row per image with copied columns 2.6 ms, SQLite row per
attribute 12.6 ms, the parser's files 30 ms. Seeking within an image lost to scanning it (an image group has 45
attributes). Updates were not measured.

## The investigations (2026-10-20)

Three were scheduled as one-shot cloud tasks (fresh sessions, 01:40–01:42 UTC). Each ran 5–13 minutes and delivered
nothing to the repository: those sessions start with no repository attached and no GitHub tools, so they could not
push a branch or open a PR. Their transcripts are in the owner's session list (titles "⚡ Metadata format survey",
"⚡ PACS metadata builder design", "⚡ Page-open metadata and codec path"). **A scheduled task for this repository must
be given the repository as a source, or its work has to run elsewhere.**

They were re-run at 03:20 UTC as background agents of the session that owns PR #113. Each works in its own worktree
and commits; that session pushes the branch and opens a draft PR into `claude/metadata-turso`.

| Investigation | Branch | Delivers |
| --- | --- | --- |
| Metadata format survey | `claude/metadata-format-survey` | `metadata-draft.md` §2: candidates from primary sources, a recommended truth + page-view pair, a runner-up, the confirming benchmark described |
| PACS metadata builder design | `claude/pacs-receiver-design` | a new section in `docs/ingest/design.md`: the receiver/builder as its own process |
| Page-open metadata and codec path | `claude/page-open-metadata` | `metadata-draft.md` §1: each path's round trips, a recommendation |

Results, as they land (what each recommended; the owner's decision when taken):

* **Page-open path:** draft PR #118 (`claude/page-open-metadata`). Recommended: **A1**, the PACS builder writes each
  series' page view (codec, frame count, display values) as a file nginx serves; the page preloads only that codec's
  decoder. It is the only path whose cost is measured (PORD: no round trip of its own, +7 / +29 ms at 120 KB), and it
  changes neither client nor the wire. Runner-up: **B**, the series sent inside the session, the codec in the page's
  address. Caution: A1 puts a derived file beside the `.sbnd`, which `target.md` ruled out for metadata; the owner's
  call. Undecided.
* **Format survey:** draft PR #120 (`claude/metadata-format-survey`), a subsection of `metadata-draft.md` §2.
  Recommended: **T1 + V1 in the study's one SQLite file**: the truth as one row per parser group (the received bytes
  and their BLAKE3, never overwritten; a correction is a new row), the page view as one row per series holding the
  page's document. A page open is one key lookup; an update commits the group and its series' view together.
  Runner-up: T2 (one row per attribute, DECK's design) with the same view. Engines: redb runner-up (multi-process
  experimental), fjall and sled out. Uses "generation", which #119 renames "revision": align when merging. Undecided.
* **PACS builder design:** draft PR #119 (`claude/pacs-receiver-design`), a new `design.md` §12 (its sources move to
  §13). Recommended: one program beside the server that receives, checks (structure, every frame's coded hash, the
  parser's BLAKE3 per group, UIDs and frame count) and builds; it keeps every accepted input in the study's
  `inputs/`, rebuilds the store whole into a new directory, and swaps a `CURRENT` file by rename. New invariant: the
  page sends its series' digest at session open and the server refuses a mismatch, so a late instance never mixes
  display values. Thirteen decisions listed in §12.10. It renames "generation" to "revision" across the ingest docs
  (the glossary already uses "generation" for a request). Undecided.

## The pair's benchmark (2026-10-21)

Run on the owner's request through the orchestrator: draft PR #126 (`claude/metadata-pair-bench`, stacked on #120).
Pre-registered, then measured; its result and this handoff's full entry are on that branch. In short, at 2 000
instances: page open 18–29 µs held, one update about 10 ms (mostly the page row's rebuild), no mixed read in 253 949.
No decision is folded in.

## Next, once the runs report

* Fold the owner's choices into the owning docs (`design.md`, `target.md`, `CLIENTS.md`) and remove
  `metadata-draft.md`.
* The benchmark of the recommended pair, if he asks for it: the page read **and** one update, at 4, 200 and 2 000
  images.
* Then the code: the PACS builder, then the server's read and the page's fetch. Fixtures, the dev host and the gate
  move off the JSON file (§5 of the draft).

## Findings for the parser's author (recorded in `contract.md`, not acted on)

RGB frame files are short; the CDA name test reads the wrong byte; `dicm2decksqlite` does not build;
`ESIPFserialized` does not link; `KVserialized` writes no end byte; three of the four group hashes cover a length
taken before the UTF-8 conversion.
