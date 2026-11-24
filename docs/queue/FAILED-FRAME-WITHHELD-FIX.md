state: done
started: 2026-11-23T11:17Z
heartbeat: 2026-11-24T04:40Z
outputs: claude/failed-frame-withheld 4de895f61, 45f2c98c0, 41dfb1cc6 (PR 438, body §FAILED-FRAME-WITHHELD-FIX)
## Resume
Done. Next row: FAILED-FRAME-WITHHELD-FIX-REVIEW (a session that wrote none of PR 438, its review or this fix).
## Result
B1 closed: resume()'s failures after its re-dials run out carry lost: true (downloader -> consumer onError and ask rejection -> Controller.refused(i, reason, lost)); a lost frame is asked once more (worker view: FrameStore.lost(i), then the want; page view: asked again while current), withheld on its second loss.
The first claim's failing tests (17ea1f69b) had three faults, corrected before the fix in 4de895f61 (a cached data: transport URL; page view losing every frame; a worker-view want expectation that ignored frame 1's miss).
Mutants M1-M8 all killed (M4 by a hang). m2 closed (README, store.js comment); m1 not closed: the browser side of a withheld frame named untested in README and PR body; n1, n2 left (n2's store comment shortened).
PR body's B1 sentence corrected in place, marked corrected 2026-11-24.
Gate: scripts/gate.sh --quick at 41dfb1cc6 green (611 s); skipped the decoders' rebuild, the absence checks (run by hand, all pass) and nested Firefox workers (no FIREFOX_PATH). wasm-pack 0.13.1 built from crates.io, the OpenJPH and xxh3 vendors fetched.
Fixtures and limits: node unit tests with fake workers, transport and paint; no browser run of a lost or withheld frame; re-dials driven at tries 2, redialMs 1.
