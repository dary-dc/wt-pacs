state: done (one blocker open, round two; amendment 17 rows VIEW-MEMORY-BOUND-FIX-2 and -FIX-2-REVIEW appended)
started: 2026-11-23T06:47Z
heartbeat: 2026-11-23T06:51Z
outputs: PR 435 body §Re-review (at claude/view-memory-bound c15b0d482); claude/view-memory-bound 9e594fb54 (docs/lines/client.md); VIEW-MEMORY-BOUND-FIX-2 and -FIX-2-REVIEW appended to docs/queue-2026-11-14.md
## Resume
Done. Next: VIEW-MEMORY-BOUND-FIX-2 (a session that wrote none of PR 435, its review, its fix or this re-review), by its brief in amendment 28.
## Result
No code changed; gate not rerun (the fix's GATE OK is at the same head); controller 44/44; comment budget ok; check_links 0.
Every mutant the fix names, and m1's two, re-run by hand: all killed. Round one: B1 and m1-m4 closed.
One new blocker (round two):
* B1: the page view's fill is the window around frame 0, sent once; the page view has no store.downloader, so a step
  past it asks only its own frame on demand. Unit probe, 10 frames, budget 4: steps 4-9 each ask exactly [4]..[9],
  nothing ahead; the worker view asks each frame two steps early. README and what-a-view-asks-for.md ("a step asks only
  the frames entering it") hold for the worker only. On unified the page view holds every frame after its fill, so this
  is a step-latency regression in the default view (derived for dbts_b1, W 15) and biases PHONE-ROUND-2's cell 3.
Minor: m1 fillMs and the progress total count arrivals, so a demand ask during the fill ends it early (probe); m2 the
viewer.js survivor stands; n1 wantFrom's two-line comment.
Fixtures: unit tests and two unit probes on synthetic 3x2 frames in Node; nothing in a browser or on a device; memory not measured.
