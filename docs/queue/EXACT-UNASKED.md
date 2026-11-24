state: done
started: 2026-11-24T09:27Z
heartbeat: 2026-11-24T09:34Z
by: S9GrEwyB
outputs: claude/exact-unasked e8464e777 (docs/client/evidence/exact-unasked.md, docs/lines/client.md), PR 440 (draft into claude/unified); claude/work-ledger docs/queue/EXACT-UNASKED/size.py, size-output.txt
## Resume
Done. Nothing owed by this row; EXACT-UNASKED-REVIEW (a session that wrote none of it) reviews PR 440.
## Result
Docs only, nothing run, gate not run (check_links 0 unresolved, comment budget passes). Derived from the delivery
run's measured C1 rows (claude/delivery b8cd8c71; size.py reproduces its 15 C1 predictions to the ms) and the device
model's per-class HTJ2K decode.
- A dwell trigger, one exact frame, after the view's fill: 1.09-2.11 MB a dwell (4.6-15 view frames).
- Trigger -> painted 0.2-1.3 s on CLEAN, PUB, LTE after the fill and LOSS, every class; 6.2-7.2 s at a loaded
  ~0.8 s round trip (CR), past ACR's 3 s bound: there A's safety argument does not hold.
- Bytes against B: view share + dwelt share; under B until 78-93 % of slices. A +-1 window triples the bytes.
- The link binds on every profile; decode a third or more only on an entry phone on a fast home link.
Fixtures and limits: 3 timed DBT volumes of one dataset, Q 8 G 8; 4-core cloud host, no GPU, software decode,
Chromium 153; relay <= 90 Mbit, not a radio; one premium phone, one home link; no ultrasound clip (theory only);
no reader; Td from a CT abstract (Beard 1994); C1 missed its model short-RTT and lossy, measured medians used.
Owner decision (BRIEF-WEEKEND): the exact frame on a dwell (one frame, after the fill, Td a lab lever) as a draft PR
extending "on an explicit Lossless request" by one case? Recommended yes; a no answers visually-lossless item 3 no.
