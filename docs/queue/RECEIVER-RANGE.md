state: done
started: 2026-11-21T10:46Z
heartbeat: 2026-11-21T11:07Z
outputs: claude/receiver-range c37b5353d, draft PR 422 into claude/unified
## Resume
Done: 9f31b5f60 (tests), c37b5353d (README, payload-format §5 case 1, metadata §Open 5); draft PR 422. Nothing left.
## Result
Answer: no own range check. The receiver never types a sample. It carries each AV1 payload byte for byte and merges min/max as signed i64.
Tests (ingest/receiver/src/test/signed.rs): the four case-1 sources (-10…200, 0…200, -200…0, control -128…127) at split 0 and 1 are served as sent,
with signed range and digests; an addition at another offset keeps each frame's header and merges to -128…200. Both pass on today's code, so no fix.
Mutants, each against the whole suite of 51 tests: range cast to i8, range read unsigned, min/max swapped, merged offset zeroed, check_frames refusing min<0. All five killed.
The first two survived the existing suite (every earlier fixture's range was non-negative). One equivalent mutant (bits := depth) was replaced.
Gate: scripts/gate.sh --quick, GATE OK in 620 s. Skipped: the decoder rebuild and the absence checks (--quick; Docker Hub 429 on debian:bookworm-slim
also blocked build.sh); the native painter and window; the viewer's cross-codec arm and Firefox; nginx; nested workers (no FIREFOX_PATH).
Fixtures: synthetic payloads with stand-in AV1 units; nothing decoded or encoded, no DBT volume; one 4-core cloud host.
Not tested (theory): after such an addition, frames of one series are typed Int8 and Int16 side by side; whether the client handles that is the client's question.
Owner: nothing new; PR 422 is a test-only proposal.
