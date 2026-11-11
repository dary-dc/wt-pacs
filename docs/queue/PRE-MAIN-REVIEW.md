state: done
started: 2026-11-11 02:05 UTC
heartbeat: 2026-11-11 03:35 UTC
outputs: claude/demo-pre-main-review 8ecd71b6 (docs/reviews/pre-main.md; docs/lines/coordination.md line); no PR (findings)
## Resume
Done. Reviewed origin/main...36d286cd (claude/demo-fixes-0, the demo tip) as PR 250 lands it. Three subagents read
server/common/deploy, client transport/decode, client view/viewer; their key claims spot-checked by hand (S1, T4,
V1, V2, V5, commit metadata). Full gate run on 36d286cd. Nothing left to do.
## Result
No blocker on the default page view. 11 should-fix, 23 nits, each with file, line and smallest fix, in
claude/demo-pre-main-review:docs/reviews/pre-main.md (§1 server/common/deploy, §2 transport/decode, §3 view/viewer,
§4 off the default path, §5 gate).
Most visible: V1, every optimal-quality frame shows a grey "unchecked" badge beside "Optimal quality" (OQ metadata
has no digests). S1, the deploy image cannot serve an OQ series (nginx 404s the exact pair's paths). V5, the
pair's same-source check passes when the exact series lacks framesSha256. V2, `?cine` now means two things.
T1, want-path fail() re-entrancy strands frames (worker view only).
Gate: scripts/gate.sh full on 36d286cd, GATE OK in 649 s, decoders rebuilt to the committed bytes; skipped by name:
native painter/window (no lavapipe/Xvfb), cross-codec arm and Firefox, nginx equivalence. Fresh 4-core cloud
container, no GPU; review by reading, no fixtures timed.
Owner decisions: (1) PR 250 also lands ~5 100 lines of new lab dirs (lab/target-review calls itself throwaway) and
client/native (+3 303): keep on main or move off (§4). (2) Committed decoder binaries replace main's host build.
(3) 93 of 311 commits are authored by a non-dary-dc identity and 57 carry Co-Authored-By: squash the merge or not.
