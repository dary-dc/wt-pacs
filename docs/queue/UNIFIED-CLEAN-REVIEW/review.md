## Clean review (UNIFIED-CLEAN-REVIEW, 2026-11-16)

A session that wrote none of UNIFIED-CLEAN, MERGE-B or MERGE-B-FIX reviewed `claude/unified` at `1aaa075f`
(`ff2bc154..1aaa075f`, seven commits; 8 files, +31 −16: `scripts/gate.sh` and seven docs). Logs in
`claude/work-ledger:docs/queue/UNIFIED-CLEAN-REVIEW/`.

### Each commit does one thing (read against its message and its source)

| commit | verdict |
| --- | --- |
| `5f853f89` | one thing. The step had had no `run` line since `13f1edb7` removed `lab/opfs-cache/summary_test.py` with the harness (the file is absent on the tip); `line-hygiene`'s gate has no such step. Nothing that ran is lost |
| `bd0863f1` | one thing. `git grep -i` for the first name outside `handoff/` now finds nothing; `handoff/metadata-2026-10.md` keeps it (the owner's yes, as the commit says) |
| `7805fb9e` | one thing; docs only. Every link resolves (`lab/av1/profiles`, `docs/av1/README.md` §Open questions, whose item "Role-based quality profiles" the new text cites) |
| `08f10482` | one thing; docs only. The index's dates match each line doc's head. **Finding (minor, not a blocker):** the new paragraph says §Simplify is folded into `docs/client/evidence/` and that R1 is cited from the index only. Neither holds: no file in `docs/client/evidence/` cites §Simplify (it is cited from `docs/reviews-2026-11-13.md`'s table, S1–S8), and R1 (*Tiles at equal quality*) is cited by `optimal-quality-reconstruction-digest.md:76` and `decode-speed-of-the-optimal-quality-picture.md:13`. Proposed correction, one line: "P1–P3, P5, P6, I1 (as §Integrity) and Round 2's R1–R5 are folded into `../client/evidence/`, each citing its section; §Simplify is tracked in `../reviews-2026-11-13.md`; P4 (as R4), I2 and I3 are cited from here only" |
| `8af63c6e` | one thing: `line-hygiene`'s step, its text exactly (line 82–83 there) |
| `ce06e946` | one thing: `line-hygiene`'s unfiltered line exactly (line 197 there); the step's title changed to say so |
| `1aaa075f` | the line doc only |

Nothing behavioural changed: the product (`server/`, `client/`, `ingest/`, `deploy/`) is untouched; only the gate's
steps changed, each as its commit says.

### The two restored gate checks, mutated by this review (its own mutants, not the writer's; `mut.log`)

* **A**, `server.rs:171`: the window ahead of cwnd 2× → 200× the largest frame. The gate's old filtered line
  (`-- held stalled lab_lever with_fill_resumes with_an_ask_stream`) passes; the restored unfiltered line fails
  `an_ask_during_a_fill_waits_behind_no_more_than_the_send_window` (159 passed, 1 failed). `--list` shows that this
  is the one `lab-levers` test outside the old filter (168 under the feature, 161 without it, 12 filtered).
* **B**, `deploy/THIRD_PARTY_NOTICES:379`: one letter of one licence text changed. `server_notices.py --check` fails
  (exit 1); unmutated it passes (164 crates, 120 distinct texts).

### For the owner: the preparation rows for `main` (plan §8 item 4), as they stand on `claude/unified`

Each row is from the 11-10 queue, done on the demo path before the unification. What is still open on the one branch:

1. **Simplification**: FABLE-SIMPLIFY's P3–P9 (the page free of lab and check; one way to ask; one view; one start
   order; one cache writer; one cine; layering) and OPT-SIMPLIFY's S2 (one view) and S5 are not done. S2/P5 wait on
   the owner's call on the page view. The rest are proposals, each its own row with a failing check first.
2. **Names**: NAMES-1's renames are present (`requestFrame` in 16 client files). Left over: item 2's screen word
   *unchecked* → *no digest*, and item 6's `exactSource` → `exactClient` (4 files), both named as not done in NAMES-1.
   One stale doc line is new to this review: `client/README.md:271` still says `requestExactFrame`. A mechanical
   cleaning of one line.
3. **Optimisation**: OPT-THEORY's P1–P5 and OPT-ROUND-2's R0–R5 are protocols. They are decided by measurement
   rows (and R3/R4 by the phone runs, which are the phone session's). Nothing about them changes on `main`'s path
   until a row measures.
4. **The lab out of the workspace** (coordination Open 6): the seven `lab/` crates are still root-workspace members
   (`Cargo.toml:18–24`). This is a structural proposal and the owner's call.
5. **The docs fold**: DOCS-FOLD did the client's part. Turning `codecs.md`, `metadata.md` and `viewer.md` into work
   state is the docs move that UNIFIED-CLEAN named. Also open: the audit's item 1 (the two study-DB schemas, the
   PACS line's fix) and its items 2, 7 (`handoff/` and `lab/`'s list, the owner's yes).
