state: done
started: 2026-11-15 13:58 UTC
heartbeat: 2026-11-15 14:06 UTC
outputs: claude/mobile-decode 65940452 (`docs/decode/mobile/htj2k-software.md`, `docs/lines/client.md`), draft PR 397 into claude/docs-client

## Resume

Done: `docs/decode/mobile/htj2k-software.md` and the line doc's In flight clause, pushed as `65940452`. Nothing next.

## Result

HTJ2K alone, in software (OpenJPH 0.31.0 WASM, SIMD128, one thread), worked out as its advocate:
* Ships today on every engine with WebAssembly SIMD (Chrome 91+, Safari 16.4+); exact by construction (integer 5/3,
  WebAssembly integer ops deterministic, S3); checked by today's exact-frame XXH3; full stored precision; every tool.
* Decode on a phone unmeasured; 78–127 ms a dbts_b1 frame predicted (T: phone AV1 135 ms ÷ cloud W/Hp 1.06–1.74).
  Cloud Hp 6.7–9.7 ns a sample.
* Bytes 4.6–14.6× the view at Q 8 (3.6–10× at the rule's Q). Fill bound by the wire below ~405–665 Mbit/s (D);
  dbts_b1 fill ~8.3 s against the view's 2.25 s at 103 Mbit/s, a tie or better on the measured home Wi-Fi.
* Levers measured in the cloud: 2-thread pool ×0.70–0.83 (ask), stripes ×0.60–0.68, prefix ×0.27–0.31 (decided out).
* Three phone cells named (Hp at 1–4 decoders; arm B on Wi-Fi; the pool on big/little cores).
Fixtures: three DBT volumes of one dataset, 4-core cloud hosts, one phone run; no HTJ2K frame timed on a phone.
Owner: the shipped OpenJPH 0.31.0 predates upstream 0.33.0's "Fixes CVE-2026-111151" (code-block buffer rows);
a pin bump and rebuild is the owner's call.
