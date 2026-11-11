state: started
started: 2026-11-11T21:25Z
heartbeat: 2026-11-11T22:10Z
outputs: claude/clean-product (docs/reviews/clean-product.md)
## Resume
FREEZE-E2E already merged claude/clean-product c7c799e9 into claude/demo-fixes-2 (157b7109); review range d46811c6..c7c799e9.
Read so far (by reading the diff): server flags (f866da46), decode flags (c2034cb3), viewer hooks (1ab25a58), web-files.sh,
check_lab_absent.sh. CI on #367 tip b196f009: deploy job (check.mjs --url) SUCCESS 21:18Z; gate job in progress.
Findings so far: F1 lab/devices/arms.json's `asksfirst` arm passes --stream-mode per-frame-asks-first to the deploy
image (default build), which now refuses it: D2's device kit breaks (docs/devices.md §D2 says "the same binary").
F2 check.mjs --url is Chromium-only now (Firefox under --url lost; no CI/script uses it).
F3 on a host without lab/, a ?check= page gets no __viewerResult on refusal (hooks undefined), check.mjs waits 300 s.
Done 22:10Z (worktrees /home/user/cr-new=c7c799e9, cr-old=d46811c6, lost on restart): client unit tests 7 files pass on both trees;
cargo test -p series-server new tree: default 127+6+1 ok, lab-levers 132+6+1 ok; decode revert (old av1*.js on new) -> 6 of 723
fail; viewer revert (old viewer/view/painter/head/web-files on new) -> crafted.mjs FAIL ?check not refused, web image ships
client/view/check.js + client/viewer/check-page.js. F4 coordination.md §Unification 1 and §Open 4 still say archive tags.
Running: absence checks on both trees (logs /home/user/cr-abs-{new,old}.log). Was next: cargo test (default + lab-levers) and node client tests on old and new tree; per change, revert the code only
and run the new tests + scripts/check_lab_absent.sh; absence check on d46811c6 (fail) and c7c799e9 (pass); coordination
rule once; write docs/reviews/clean-product.md on claude/clean-product; line file; PR? (none: findings on #371's branch).
Commands: git worktree add ../old d46811c6; cargo test -p series-server [--features lab-levers]; bash scripts/check_lab_absent.sh
