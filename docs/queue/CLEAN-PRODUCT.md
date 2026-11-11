state: started
started: 2026-11-11T17:48Z
heartbeat: 2026-11-11T19:09Z
outputs: claude/clean-product 1ab25a58
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
Part 2 started: FIX-2 done; merged --no-ff origin/claude/demo-fixes-2 into
claude/clean-product, and items 11-16 of claude/demo-clean:docs/reviews/experiments-off.md one commit each,
failing test first; coordination.md §Decisions correction; full gate; demo-check.mjs both views; draft PR.
Commands: git fetch origin; git checkout claude/clean-product; bash scripts/check_lab_absent.sh (~80 s cold).
Part 2 progress (pushed):
* 0eee2ad1 merge of claude/demo-fixes-2 d46811c6.
* 05247e22 check narrowed to the deploy images' stages (server, web): cargo must load the server's optional lab deps
  (with sources) to resolve, so the build stage can't drop lab crates without a workspace split -> item 16 is a
  proposal for the owner (structural), not done here. Mutants: lab COPY in server and web stage caught.
* f866da46 item 15: the three flags behind lab-levers; test first (failed on --send-window-follows-cwnd); mutants
  M1 tuning flag back to #[arg(long)] and M2 variant ungated both caught. server absence check OK.
* 1ab25a58 items 13+14: lab/viewer/hooks.js (page hooks via levers.js), check modules -> lab/viewer/, out of the web
  image; ViewWorker/Painter take one `lab` object; check.mjs --url routes lab/ from the checkout. Test first: crafted
  ?check=1 failed. Mutants caught: check off head's gate (crafted), worker not given the check module, watchWrites
  dropped (check.mjs). run_check.sh green; frame-clock check green; check_lab_absent.sh OK.
Was next: items 13+14 together (check and lab hooks out of viewer.js into one lab/ module loaded by head.js's gate;
check-page.js and view/check.js out of the web image; view worker's check import by a URL the lab object gives;
lab settings into one lab object; onePass on / reuseCopyBuffer off reduced) -- done but the flags. Next: the flags. Then item 11's removal commit +
revert, line file, full gate (INGEST_BUILD=$PWD/ingest/.build; dockerd started), demo-series + demo-check both views,
draft PR into claude/demo-fixes-2.
## Result
