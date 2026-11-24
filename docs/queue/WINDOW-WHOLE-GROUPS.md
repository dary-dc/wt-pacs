state: started
started: 2026-11-24T12:27Z
heartbeat: 2026-11-24T12:32Z
by: VuNcjzKy
outputs: claude/window-whole-groups 5353ae8de (the failing test)
## Resume
Done: 5353ae8de on claude/window-whole-groups (from origin/claude/unified b059388b6): client/view/window.test.mjs, the
real downloader behind a stand-in transport and decoders, a Controller with budget 15 on 50 frames G = 8. On the tip it
FAILS: forward 268 frames on the wire for 50 steps, backward 280 (candidates.md's model said 398 and 234); a sawtooth
23|24 refetches groups 2 and 3 on every turn. So §2 holds in the product. Next: the change in client/view/controller.js
(wantFrom takes the group length: the k >= 2 whole groups nearest the frame) and client/view/store.js (frames outside
the want let go first); then mutate, gate, PR into claude/unified.
Commands: cd wt-pacs; git checkout claude/window-whole-groups; node client/view/window.test.mjs; scripts/gate.sh
## Result
