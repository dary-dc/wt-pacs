state: done
started: 2026-11-24T07:46Z
heartbeat: 2026-11-24T08:15Z
by: tbgnbMG2
outputs: claude/failed-frame-withheld d3b8bac38 (tests), f77a57eda (fix), 2ea09184c (README), eed7ebe0f (docs/lines/client.md); PR 438 body §FAILED-FRAME-WITHHELD-FIX-2
## Resume
Done. Next row: FAILED-FRAME-WITHHELD-FIX-2-REVIEW (a session that wrote none of PR 438, its review, its fix, its re-review or this fix 2; by: tbgnbMG2 is this one), findings in PR 438 §Re-review 2.
## Result
R-B1 closed: live() throws DialError on a failed dial after a closure; command()'s catch fails an ask's, fill's or want's frames with lost: true, so the view asks them once more before withholding.
Tests (failing first, d3b8bac38): downloader ask and want after a closure whose dial fails (failed without the fix: lost:false); controller: a want's frames failed lost are wanted again, none withheld.
m1 closed: resume()'s fill frames marked lost (kills R6). m2 closed: page view does not re-ask after the reader stepped away, asks on return (kills R1).
Mutants: R6, R1, D1, D2, store.lost removed, lost ignored: killed. D3 (every command failure lost) survives, argued equivalent on today's code.
Named, not changed: again()'s failed re-dial after a decoder loss also fails without lost (outside the brief's ask/fill/want); n1, n2 left.
Gate: scripts/gate.sh --quick at eed7ebe0f green, 374 s, skips named in PR 438; absence checks by hand pass; check_links 0 unresolved.
Fixtures and limits: node unit tests on fake transports (tries 2, redialMs 1, stallMs 20) and the controller rig; no browser run of a lost or withheld frame.
