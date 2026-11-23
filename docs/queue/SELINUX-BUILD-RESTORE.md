state: done
started: 2026-11-23T00:47Z
heartbeat: 2026-11-23T01:09Z
outputs: claude/selinux-build-restore 29a5682aa (the restore), 66aa5fa7b (docs/lines/coordination.md); draft PR 433 into claude/unified
## Resume
Done. Next: SELINUX-BUILD-RESTORE-REVIEW (a session that wrote none of it), findings in PR 433's body.
## Result
The merge that dropped it: dd681539d (stage B2, claude/merge-a-server into unified, 2026-11-15), whose rule gave
client and deploy files the tip's form; git log -S misses it (merge diffs), found by walking unified's merges.
All four files of 5ce4f0876 had lost every hunk: build.sh's --security-opt label=disable; build/README.md §The
container and npm; README.md's pip; deploy/README.md §With podman, rootless and §Open's row closed. Restored as
written, except the podman block's decoder-build line (deploy no longer builds decoders, owner's decision D2; the
block not re-run without it) and §Container settings' "rest of rootless podman is unchecked", now a pointer.
Measured on a 4-core cloud host without SELinux (the flag is a no-op there; the SELinux effect was checked on
2026-11-09, not again): build.sh matches manifest.sha256 (Docker Hub 429, the pinned digest via mirror.gcr.io);
scripts/gate.sh in full, GATE OK in 727 s, skips named: native painter and window checks, the viewer's cross-codec
arm and Firefox, the web host's check (no nginx). check_links and the comment budget pass.
For the review: the same B2 rule leaves added lines of twelve more commits absent (a line match; PR 433's body
lists them), many likely superseded by design; not judged.
