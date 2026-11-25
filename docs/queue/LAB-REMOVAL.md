state: done
started: 2026-11-24T23:47Z
heartbeat: 2026-11-25T00:11Z
by: 1iAT8sEK
outputs: claude/lab-removal e1af31674, e0f21775d, 28fc6b6d6; draft PR 449 into claude/eval-release
## Resume
Done. Nothing left. LAB-REMOVAL-REVIEW is owed by a session that wrote none of PR 449.
## Result
The 36 directories of lab-list.md §Re-read are removed from claude/eval-release's tree (e0dd6d4fb). That is 526 files
and 99 849 lines, of which 18 059 are code lines by §Re-read's count. lab/ goes from 66 directories to 30. The 11 kept
directories and the device kit are untouched. Three code comments are repointed. The fourth, build_levels.sh, reads
claude/htj2k-progressive and is unchanged. .gitignore loses 12 lines.
Docs: 54 links now point at permalinks at e0dd6d4fb, and 61 paths are named beside that commit. check_links.py goes
from 115 unresolved to 0. lab/README.md's table is updated.
scripts/gate.sh, full, on a 4-core cloud container: OK in 877 s. check_lab_absent.sh is OK. Five steps were skipped by
name: the pair's invariants, the native painter, the native window, the cross-codec arm and Firefox, and nginx's
web-host check. No archive tag was made.
Limits: the trace is static. The run branches were read at 11-24 11:30 by LAB-REMOVAL-LIST. The tiles' level binding
lives only while claude/htj2k-progressive does. Fixtures: none, no measurement.
Owner: PR 449 merges on the yes to unified-to-main item 4. That yes also chooses between no tag (this PR) and
lab-list §For the owner's archive/lab-<dir>-2026-11 tags, which would be made from e0dd6d4fb before the merge.
