state: done
started: 2026-11-11T02:05Z
heartbeat: 2026-11-11T02:15Z
outputs: one comment each: #341 issuecomment-6784989213, #340 -6784991727, #350 -6784993748, #338 -6785000198, #339 -6785002351; no branch changed
## Resume
Done. Nothing to continue.
## Result
* #341 (gate in a cloud session): merge as is. Reproduced: dispatch rig without built/ 164/164 with the skip by name; mutant
  (line removed) 164/171, the 7 "exact … undefined" FAILs. CI builds xxh3 and rejects unlisted SKIPs, so no coverage is hidden.
  789/789 with the build not reproduced (needs Docker's emscripten build). Optional: hash-pin meson; a staleness check for ingest/.build.
* #340 (OQ line, WebCodecs first): merge after changes: rebase against #350 (they conflict in optimal-quality.md), state a day old,
  point the "Not yet run" clause at #341. Claims hold against oq-depth-cut 6f61ff0b.
* #350 (AV1 harvest): merge after changes: the same conflict (its route bullet is the pre-cut rule; take #340's); the dav1d-WASM
  "1.9–4.7" figure dropped without a correction; body still has a Generated-by line (FOOTERS-NEW). Numbers spot-checked, hold.
* #338 (plan): not as is: a plan in docs/lines/, mostly superseded (D1/D2/D4, O1, both UNSUREs done); keep on claude/plan, a dated
  paragraph plus pointer in coordination.md.
* #339 (browser decode reference): merge as is; 6 quotes re-fetched verbatim (V8, V10, V11, X1, C35, G1); follow-up: the four stale
  claims in docs/decode/README.md and hardware.md corrected in place.
Fixtures: the rig's grey-16/colour-8 frames only; one 4-core cloud container, no GPU, no decoder build.
Owner: merge #340 or #350 first (the other rebases); whether #338 goes to main at all.
