state: started
started: 2026-11-22T18:17Z
heartbeat: 2026-11-22T18:19Z
outputs: claude/integrity-model (PR 429)
## Resume
B1 read in code at a59aa4310 and 4a2b4277f: refused(i) -> store.failed(i) drops i from owed; the ack has already
deleted the downloader's record, so the next want naming i sends it once more, after every failure, unbounded.
Scratch check (not committed): FrameStore at both refs, want [0,1,2], 0 and 2 put, 1 failed, two wants -> the
downloader is sent [0,1,2] then [1]. Next: edit docs/client/evidence/integrity-model.md on claude/integrity-model
(B1 in §1, §5, §6, §8, §9; then m1-m11), push, then the *Fixed* list in PR 429's body.
## Result
(pending)
