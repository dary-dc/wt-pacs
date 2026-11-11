state: started
started: 2026-11-11T17:48Z
heartbeat: 2026-11-11T17:53Z
outputs: claude/clean-product c2f6886c (from claude/demo-fixes-2 4ba95e1b)
## Resume
Part 1 done, 63140f29: scripts/check_lab_absent.sh in gate.sh's absence checks, plus the three lab flags of item 15
in server/scripts/check_telemetry_absent.sh. Fails today on: Containerfile's lab COPYs (item 16), the web image's
view/check.js + viewer/check-page.js (item 14), the 3 server flags (item 15). Mutants caught: lab-frame-cache and
lab-classify on by default, lab crate in default-members, shipped module importing /lab/ or ../../lab/.
"Product" for the check = what ships (both images, the default series-server build, default-members); gate-run test
tooling under client/ (paint/check.mjs, settle-check.mjs, dav1d scripts) is not checked.
Also done: c2f6886c, docs/lines/coordination.md §Decisions 11-04 rule corrected in place (part of part 2, docs only).
Items 11-12 read (not yet acted on): 11 lab/frame-clock is split: busy.js, phase.js, measure.js(+test) are harness
(lab/viewer/levers.js and its summaries, and the nightly total-time run.mjs import them); arms.js, page.js, index.html,
run.mjs, check.mjs, arms.test.mjs are the frame-clock protocol, built 10-30, never run: experiment -> a removal
commit, reverted at once, so the owner's yes is "revert the revert". 12 opfs-cache/browser.mjs: harness (gate's
settle-check imports it); stays in lab/.
Next: wait for docs/queue/FIX-2.md state: done; then git merge --no-ff origin/claude/demo-fixes-2 into
claude/clean-product, and items 11-16 of claude/demo-clean:docs/reviews/experiments-off.md one commit each,
failing test first; coordination.md §Decisions correction; full gate; demo-check.mjs both views; draft PR.
Commands: git fetch origin; git checkout claude/clean-product; bash scripts/check_lab_absent.sh (~80 s cold).
## Result
