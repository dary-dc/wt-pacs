# Work queue: the client's documentation, restructured (2026-11-14 to 2026-11-18)

Started 2026-11-14 by the owner's word ("yes to the recommendations. Let's define this and then dispatch the cloud
work for this documentation restructuring"). Times are UTC. This file is separate from `docs/queue-2026-11-14.md`
(not started): its rows are not counted there, and that file's client documentation rows (CLIENT-README-CACHE and
its review) wait until DOCS-FIX is done, then follow the structure below.

## Why

The owner, 2026-11-14: the design is spread over a ~4,000-line ADR (`docs/adr/frame-path.md`: target, red team, an
independent design, experiments, reviews) and line docs that read as lists of PRs; "this is a bad documentation. It's
a patch over another. We need to define a structure and how to preserve it as decisions and results change." Ideas
and decisions also live on many branches, so a first round must find them. It need not be perfect in one round; it
must land at least on the client's unified branch, which carries the client, optimal-quality and native lines.

## The branch

`claude/docs-client`, created from `origin/claude/unified-client` `e5b20cba`. Every row of this file pushes there
(after `git pull --rebase`), except DOCS-SWEEP, which writes only to `claude/work-ledger`. DOCS-STRUCTURE opens one
draft PR, `claude/docs-client` into `claude/unified-client`; later rows add to it. Merging it is the owner's word.
Content from other branches is carried **by edit, citing its source (`branch:path` §section)**, never by `git merge`
or `git cherry-pick` (the two-week rule: no merges).

## The structure (the owner's yes, 2026-11-14)

Each subject has one home, `docs/<subject>/`. Round 1 does the client only: `docs/client/`.

```
docs/client/
  design.md      the current design only (below). Rewritten in place, never appended to; about three screens.
  design.html    the visual design (DOCS-PAGE)
  evidence/      one file per question researched or measured
docs/lines/<line>.md   the work only: goal in one line, in flight, PRs, owed runs, pointers. No design, no results.
```

* **`design.md`**, in this order: *What it is* (one diagram, the components and who owns what); *Rules* (the
  invariants, one line each); *Decided* (a table: the choice, the date, whose, a link to its evidence); *Open* (each
  question: the options, what theory predicts for each, what decides it, the evidence so far with its scope).
* **`evidence/<question>.md`**: the sources or the pre-registered protocol (dated, by whom), the results with their
  fixtures and where the host saturates, the verdict with its scope, a link to the raw rows. A rerun adds a dated
  section; a retraction is corrected in place (`docs/adr/disk-access.md` §2 is the model). Theory and measured are
  labelled.
* **Keeping it true**: a result lands in its evidence file and, in the same commit, changes the one line of
  `design.md` it moves and the page's box if one changes. A decision moves its question from *Open* to *Decided*.
  Queue-row, campaign and lever names (FILL-SPLIT, I1, P6, …) stay in the work ledger and never appear in `docs/`
  (`CLAUDE.md` §Names); an evidence file is named by its question.
* **Where it is written down**: `CLAUDE.md` §Docs, extended by DOCS-STRUCTURE with the bullets above in that file's
  style (a rule lives once; other files point to it).

## The product statement (the owner's framing, 2026-11-14)

At the top of `docs/ARCHITECTURE.md`, and pointed to (not restated) from `README.md`, `client/README.md`,
`docs/lines/README.md` and each client-side line doc. Its substance, which the words may tighten but not change:

> For cine-like series (one consecutive dimension; breast first), every reader sees the series' optimal-quality AV1
> view, and a frame comes whole from its exact HTJ2K series, bit for bit, when the reader asks for Lossless. This is
> the official approach agreed with the team as the main candidate; it is not yet a final product decision. HTJ2K
> alone is served in any case (it is the exact series) and is also a measurement arm; the optimal-quality view alone
> is a measurement arm only. What series that are not cine-like get is not stated yet.

## The owner's decisions of 2026-11-14 (record them in `docs/client/design.md` §Decided)

1. The documentation structure above, and the product statement's framing.
2. **Exactness failures are a safety report, not telemetry**: always on, never sampled, not gated by the telemetry
   rate; no pixels and no patient data; the same endpoint and record format as the load report. On a mismatch the
   frame is blocked (the second decode first, `docs/adr/exactness-in-production.md` §4), the reader is told in that
   frame's view, and the report is sent at once. The sampled load report alone follows the rate (still 0 by default).
3. **The cache: survey the options before designing further.** OPFS was chosen 2026-10-10 without a recorded
   comparison; row CACHE-OPTIONS surveys the alternatives; if OPFS comes out best its design continues, if not the
   cache gets research of its own.
4. **The delivery comparison, theory first, measured as calibration**: arm A the optimal-quality view only; arm B
   HTJ2K lossless only; C1 the approach itself (the optimal-quality fill, then an exact frame on request: an
   on-demand latency); C2 the optimal-quality fill, then the whole exact series ("load OQ, once done load lossless"),
   measured, not summed. Per load: wire time, decode floor, rest, the decoder route actually taken, bytes; phone CPU per
   process; server egress and CPU. Rendering and everything else fixed, arms interleaved. Links: the calibrated home
   Wi-Fi, then a sweep toward cellular and congested Wi-Fi with random loss (each profile labelled measured or
   assumed, with its source), to find where each arm's regime changes; back to the phone at those points. The data
   is kept in the repository, one table per link profile. This round only **records** it as an *Open* item with its
   theory (fill ≈ max(bytes × 8 ÷ bandwidth, frames × decode per frame ÷ decoders) + rest) and what decides it;
   no row here writes its protocol or runs it.
5. Transport (HTJ2K alone against TCP-based stacks, WebSocket included) is a separate session's subject; not here.

## Rows

| row | not before | needs | output |
| --- | --- | --- | --- |
| DOCS-SWEEP | 11-14 17:00 | — | `claude/work-ledger:docs/queue/DOCS-SWEEP-inventory.md` |
| DOCS-STRUCTURE | 11-14 17:00 | — | `claude/docs-client`, the draft PR |
| CACHE-OPTIONS | 11-14 17:00 | — | `claude/docs-client:docs/client/evidence/cache-options.md` |
| DOCS-FOLD | 11-14 21:00 | DOCS-SWEEP and DOCS-STRUCTURE done | `claude/docs-client` |
| DOCS-PAGE | 11-15 08:00 | DOCS-FOLD and CACHE-OPTIONS done | `claude/docs-client:docs/client/design.html` |
| DOCS-REVIEW | 11-15 14:00 | DOCS-PAGE done | findings in the PR body (a section "Review") |
| DOCS-FIX | 11-16 08:00 | DOCS-REVIEW done | `claude/docs-client` |

A session that wrote any of DOCS-STRUCTURE, DOCS-FOLD or DOCS-PAGE does not take DOCS-REVIEW.

### DOCS-SWEEP (findings only; read, never edit `docs/` anywhere)

Find every client-side idea, decision and result that lives off `claude/unified-client`. Client side: the client
(transport client, decode, view, store, paint, cache, telemetry, the safety report), optimal quality's client side,
the native client, the phone runs.

* Scope: every remote branch that is not an ancestor of `origin/claude/unified-client`; for each, `git diff
  $(git merge-base origin/claude/unified-client <b>) <b> -- docs README.md client/README.md CLAUDE.md`; skip it if
  empty. Also the owner's decisions in `claude/work-ledger:docs/queue-2026-11-10.md`, `docs/queue-2026-11-14.md`,
  `docs/queue-close-2026-11-13.md` and the briefs `claude/reviews-2026-11-11`, `claude/reviews-2026-11-13`, and
  `claude/direction`'s seven line docs (newer than the unified branch's).
* One row per item: what it says (one line), kind (owner decision · measured finding · theory · proposal · superseded
  or retracted), source (`branch:path` §section, commit), status against the unified branch (present · partly ·
  absent · contradicts), and its home in the structure above (`design.md` §Decided/§Open, or `evidence/<question>.md`).
  Owner decisions first, then contradictions, then the rest. Keep superseded items, marked, with what superseded them.
* A second list: **doc corrections**, each a missing or ambiguous statement, the doc, and what is wrong. Start from
  these five, verified: the phone fill-split's conclusion omits that the product asks WebCodecs for
  `prefer-software` (so every phone AV1 decode was software); `docs/decode/hardware.md` predates optimal quality and
  is not re-read against its needs (lossy view, 10 bits for the window table, the reconstruction digest);
  no record compares cache options; the exactness failure report is gated by the telemetry rate; the client line
  doc's "no difference shown" for the views where the phone did measure (inconclusive by its rule, not unmeasured).
  Also check whether the page still *marks* a mismatched frame (`exactness-in-production.md` §Blocked) on the tip.
* If the inventory runs long, push it in parts as it grows (owner decisions first). Nothing else is written.

### DOCS-STRUCTURE

On `claude/docs-client`:

1. `CLAUDE.md` §Docs: the structure and its keeping rules, in that file's style, within its comment-free prose.
2. The product statement at the top of `docs/ARCHITECTURE.md`; the pointers to it in the files named above; correct
   any sentence in them that contradicts it, in place.
3. `docs/client/design.md` from `docs/adr/frame-path.md` (§Target, its §Review and the independent design's
   conclusions, §The core, assembled), `client/README.md` (§The viewer, §Optimal quality, exact on request),
   `docs/lines/client.md` and `claude/direction:docs/lines/client.md` (newer: carry its §3 and §4 by edit), with
   the 2026-11-14 decisions above.
4. Split `docs/adr/frame-path.md` into `docs/client/evidence/*.md`, one file per question, moving the text
   (reworded only where a sentence names a queue row or campaign). **Lose nothing**: before the commit, list every
   heading and every measured number of the old file and show where each now lives (that list goes in the PR body,
   not in the tree). Leave `docs/adr/frame-path.md` as a short pointer to `docs/client/`; move `docs/adr/frame-path-sources.txt` beside the evidence it serves. Fix every link to it in the
   tree (`scripts/check_links.py` must pass). Other client ADRs
   (`exactness-in-production.md`; `telemetry-in-production.md` is on `claude/telemetry-client` only) stay where they are, linked from
   `design.md`; converting them is a later round.
5. `docs/lines/client.md`, `optimal-quality.md`, `native.md`: work state only, as the structure says, carrying
   `claude/direction`'s newer state by edit; design and results move to `design.md` or evidence, or are pointed to.
6. Open the draft PR (title "docs/client: one home for the client's design, evidence and work state"); its body:
   the question (the structure), what moved where, the loss list, what this round does not do.

### CACHE-OPTIONS (theory only; sources quoted verbatim; nothing measured)

Write `docs/client/evidence/cache-options.md`. The question: **where should the client keep frames across a session
and across visits, on a phone over lossy wireless?** Options at least: OPFS (sync access handles in a dedicated
worker; the async `createWritable`), IndexedDB, Cache Storage, the Storage Buckets API, memory only (the baseline);
and the File System Access API's user-picked directory, named only to say where it applies. For each, per engine
(Chrome on Android first, then Safari on iOS, Firefox, desktop Chromium), from the specs and engine sources:
storing decoded samples held in a `SharedArrayBuffer` with or without a copy; writing off the view's thread; read to
paint latency; quota, eviction granularity and `persist()`; durability and torn writes; several tabs and locks.
Then the trade-off the phone run reopens: decoded samples (about 17 MB a DBT frame at 2560 × 3328; no decode on
reopen, which a phone fill showed to be its bound at about 135 ms a software AV1 frame) against coded bytes (the
optimal-quality series ~0.07–0.22 of the exact series' bytes; a decode on every reopen, which the owner's
2026-10-10 rule excludes), with flash write cost and quota on a phone. Read `docs/adr/frame-path.md` §4 and §6 and
the cache sections first and do not repeat what they already source; cite them. End with an options table, what
theory predicts, what would decide it, and a recommendation labelled as a leaning. Fixtures and their limits stated.

### DOCS-FOLD

Fold DOCS-SWEEP's inventory into the structure: every item *absent*, *partly* or *contradicts* goes to its home
(owner decisions into §Decided with their dates; findings into evidence; proposals into §Open with what decides
them); a contradiction is resolved only where a later owner decision settles it, otherwise it is listed in §Open as
a contradiction for the owner. Apply the doc-corrections list in place, each in the doc that owns it (that may be
outside `docs/client/`; edit it on `claude/docs-client`). Link CACHE-OPTIONS' file from `design.md` §Open once it is
pushed. Record in the PR body what was folded and what was left, with why.

### DOCS-PAGE

`docs/client/design.html`: one self-contained page (no external script, style or font; light and dark by
`prefers-color-scheme`), the client as boxes in lanes (page, view worker, downloader worker, decoders, browser and
platform, server) and arrows for the messages. Clicking a box or an arrow opens a side panel: what it does; the state
it holds; its costs as rows (value, condition, source link); its open questions, each linking to `design.md` §Open.
A legend marks each box as *built on the tip*, *built behind a lab flag* or *proposed, not built*, and a second,
smaller diagram for the delivery approach (optimal-quality fill, exact frame on request). Every number on the page
links to the evidence file it comes from; the page holds no claim `design.md` or the evidence does not. Under 80 KB.
If the repository's link check does not read `.html`, extend it by the smallest change that checks the page's
relative links, with a test that fails on a broken one (mutated). `design.md` links the page in its first lines.

### DOCS-REVIEW (a session that wrote none of the above)

On the PR: the loss list holds (pick 20 headings and 20 numbers of the old `frame-path.md` and of the old line docs
at random and find each); the structure is followed (design.md has no history, line docs no design, evidence files
named by question, no row names under `docs/`); the product statement's framing is the owner's; the 2026-11-14
decisions are recorded as written here; every link resolves; the page agrees with `design.md`, box by box; the
gate's docs steps pass (`scripts/gate.sh --quick --no-browser` at least, naming every skip). Findings go in the PR
body's "Review" section, each with a file and what to change; a trade-off is marked for the owner.

### DOCS-FIX

Apply the review's findings that are not marked for the owner; list the rest in the PR body for the owner. Gate as
the review ran it. Then update `docs/lines/client.md` with this round's state and what a next round should fold
(the other subjects: codecs, transport, server, metadata; the other client ADRs).

## Procedure, rules

Each firing follows `docs/queue-2026-11-14.md` §The worker's procedure, §No work lost and §Standing rules, applied to
**this file's rows only**, with three changes: step 3 counts this file's running rows (at most three at once); step
4 ignores the 22:00–06:00 restriction; and the queue closes 2026-11-18 23:59. Status files are
`docs/queue/<ROW>.md` on `claude/work-ledger`, the same schema. Docs only: no product code changes, except
DOCS-PAGE's link-check extension.
