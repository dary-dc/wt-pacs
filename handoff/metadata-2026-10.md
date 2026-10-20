# Handoff: metadata from the study store (2026-10-20)

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

## Cloud work scheduled 2026-10-20 (one-shot, each in a fresh session; draft PRs into `claude/metadata-turso`)

| Scheduled task | Branch | Fires | Delivers |
| --- | --- | --- | --- |
| Metadata format survey | `claude/metadata-format-survey` | 01:40 UTC | `metadata-draft.md` §2: candidates from primary sources, a recommended truth + page-view pair, a runner-up, the confirming benchmark described |
| PACS metadata builder design | `claude/pacs-receiver-design` | 01:41 UTC | a new section in `docs/ingest/design.md`: the receiver/builder as its own process |
| Page-open metadata and codec path | `claude/page-open-metadata` | 01:42 UTC | `metadata-draft.md` §1: each path's round trips, a recommendation |

Each sends a push notification with its result and PR link. Their PRs are the owner's to review; this branch merges
nothing on its own. When they land, update this file: what each recommended, and what the owner decided.

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
