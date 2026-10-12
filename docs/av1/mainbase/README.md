# Row 150 MAINBASE — the rebuild, ready to publish

The night routine of 2026-10-12 built and verified the rebuild of `claude/av1-unified` on `main` (PR #34 kept) and
the re-authoring of both AV1 branches, then could not publish it: the force-push was refused by the session's
permission policy. The old tips were pushed as `claude/av1-unified-pre-main` (`581c507`) and `claude/av1-pre-main`
(`5cce6c0`). Everything needed to publish is here, and it is deterministic: run on those two tips, `replay.py`
gives `7cb02d3f` and `cf04350b` and the same 1 557-line map, checked twice.

## What was verified on the result (2026-10-12)

* 1 557 commits re-authored to `dary-dc <crespoydelgado@gmail.com>`, the 423 that descend from `main`'s `8407095`
  replayed onto `c7230a9`; 55 distinct conflicts over the history, all resolved (`table.py` says how: the tip's 24 by
  hand in `resolution/`, 25 by the branch's renames, 3 carried from the tip, 3 in `manual/`).
* 92 287 hash tokens carried; `rehash_check.py` prints nothing on both new tips and catches an old hash planted in a
  tree and in a message. `docs/cloud-queue.md` is left as it is (it names two replaced commits).
* (a) `verify_a.py`: outside PR #34's 48 files, 20 paths differ from the old tip, each only by hash replacements.
* (c) `scripts/gate.sh` green on the final tree (278 s; the decoder builds made with docker and checked against their
  manifest, so the viewer's page check ran: 3/3 exact in Chromium; Firefox and the numpy checks skipped by name).
* The new tip is a fast-forward of `main`. `MAINBASE.md.draft` is the report, (b) and (d) in it.

## To publish

```bash
git fetch origin
U=$(git rev-parse origin/claude/av1-unified); A=$(git rev-parse origin/claude/av1)   # U must still be 581c507
python3 docs/av1/mainbase/replay.py $U $A /tmp/mainbase        # map.tsv, refs.tsv, late.tsv (empty), tips
git worktree add /tmp/newu $(awk '/^unified/{print $2}' /tmp/mainbase/tips) && cd /tmp/newu
git switch -c mainbase
git apply "$OLDPWD/docs/av1/mainbase/names.patch" && git commit -am "MAINBASE: PR #34's code and docs in the branch's names where they merged cleanly"
git apply "$OLDPWD/docs/av1/mainbase/contract-link.patch" && git commit -am "docs/ingest: contract.md named as not yet written rather than linked, so the link check passes"
cp "$OLDPWD/docs/av1/mainbase/MAINBASE.md.draft" docs/av1/MAINBASE.md   # its two fixup hashes and §PR #34's files:
python3 "$OLDPWD/docs/av1/mainbase/report_files.py" HEAD                  #   regenerate for the new commits
git add docs/av1/MAINBASE.md && git commit -m "MAINBASE: the report"
scripts/gate.sh
python3 "$OLDPWD/docs/av1/mainbase/rehash_check.py" /tmp/mainbase/map.tsv HEAD $(awk '/^av1/{print $2}' /tmp/mainbase/tips)
git push --force-with-lease=claude/av1-unified:$U --force-with-lease=claude/av1:$A origin \
  HEAD:claude/av1-unified $(awk '/^av1/{print $2}' /tmp/mainbase/tips):claude/av1
```

Then, on the new `claude/av1`: `/tmp/mainbase/map.tsv` committed as `docs/av1/rehash-map.tsv` with
`rehash_check.py` beside it, row 150 done with the new hashes, rows 151, 155 and 156 `ready`. If
`claude/av1-unified` has moved past `581c507`, `replay.py` stops at its tip assertion or on a conflict
`table.py` has not met: resolve that one in `resolution/` or `manual/` and run again.
