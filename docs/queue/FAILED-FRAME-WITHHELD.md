state: done
started: 2026-11-23T09:17Z
heartbeat: 2026-11-23T09:43Z
outputs: claude/failed-frame-withheld (tests 5e2833075, fix 5dad82f96, docs 2d606f7e5 and after), PR 438 (draft into claude/unified)
## Resume
Done. Nothing next but FAILED-FRAME-WITHHELD-REVIEW (a session that wrote none of it).
## Result
A refused frame (server refusal, decoder that threw, the downloader's lost-ask re-asks run out, a depth cut's
frame at another depth) is withheld for the session: `FrameStore.withhold` keeps it out of every later want; a step
onto it asks nothing in the page view and waits for nothing in the worker view; the canvas is cleared in its place
(`paint(null)`), never the previous slice's picture, and a `withheld {i, reason}` event blanks the mark and label.
Tests in `client/view/controller.test.mjs`, pushed failing first; seven hand mutants, each killed.
Gate: full, every step green up to the decoders' docker rebuild, which Docker Hub refused twice (429); the diff touches
no decoder source; the three absence checks after it run by hand, green. Skipped by name: Firefox, the native
painter and window (no lavapipe, Xvfb), the web host (no nginx). Fixtures: node unit tests with a fake client;
headless Chromium for the gate's browser steps, one 4-core cloud container.
Not changed: an exact-only series' frame failing its check twice is still painted under NOT EXACT (the 2026-11-14
block decision unbuilt); `fillMs` never completes with a withheld frame (PR 435 m1 touches it).
Owner: the words on screen for a withheld frame are the frame-integrity page's call (its Withheld state).
