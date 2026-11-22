state: done
started: 2026-11-22T16:21Z
heartbeat: 2026-11-22T16:31Z
outputs: `claude/integrity-model` `35e7378cb` (`docs/client/evidence/integrity-model.md`; `docs/client/design.md` §Open; `docs/lines/client.md`, `optimal-quality.md`); draft PR 429 into `claude/unified`
## Resume
Done. Nothing to continue. Sources fetched 2026-11-22 and pinned in the file's §10 (nine, each with URL, section,
revision and sha256); the code read at `origin/claude/unified` `4a2b4277f` and `origin/claude/oq-integrity-build`
`a59aa4310`, not run. Docs only: `scripts/check_links.py` 0 unresolved, comment budget ok, the gate not run.
Next: INTEGRITY-MODEL-REVIEW (findings in PR 429's body), then INTEGRITY-PAGE. No row appended; nothing scheduled.
## Result
Theory and sources; nothing built, run or timed. No fixture used; the measured costs quoted are earlier rows' (4-core
x86 cloud hosts, no GPU, headless Chromium and Firefox, SwiftShader; four HTJ2K series, three DBT volumes of one
dataset; no phone, no hardware decoder, no US cine). Rates are servers' and PCs' (2008-2011); a phone's is unknown.
Not read: Rec. ITU-T T.803 | ISO/IEC 15444-4 (login page).
* Seventeen faults along a frame's twelve steps against four checks. The frame check covers the store to the decoder
  and cannot be replaced: AV1 §7.2 and T.800 §3.61 give one right answer a frame, and only a digest after the decoder
  holds a decoder to it. A coded-bytes digest detects nothing new; it locates, which is what justifies a re-ask and
  gives the server a one-hash re-check.
* Pass every check today with a green label (predictions, not run): a damaged display parameter in `metadata.json`;
  a held frame damaged after its check; a stale texture; frame j painted for i.
* Read in code, not run: a withheld frame paints nothing, so the previous frame's picture stays under the new index
  (PR 368's branch, and any refused frame on `claude/unified`). *Lossless check failed* covers three failures; one
  is a failed check. Five true states derived for a pair.
* Premise answered: every frame at full cost stands, on the measured costs (0.15-8 ms a frame; fills x0.94-1.15).
* Eleven fault-bench cells with predictions for the next queue (the file's §8); none appended as a row.
Owner, last (the file's §9): the five label states (*unavailable* apart from *check failed*; no ✓ on *Optimal
quality*); a withheld frame clears the canvas, no reveal; no frame stored without a digest; a digest over the metadata;
the coded-bytes digest with the server's re-check (structural). Would reopen, only if taken: amendment 22 by one case
(a re-ask after a coded-digest mismatch); the exact frame fetched unasked for a withheld view frame.
