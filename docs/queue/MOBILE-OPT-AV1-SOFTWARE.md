state: done
started: 2026-11-15 13:56 UTC
heartbeat: 2026-11-15 14:05 UTC
outputs: claude/mobile-decode `7949590c` (`docs/decode/mobile/av1-software.md`), `6edc0ef7` (`docs/lines/client.md`); draft PR 397

## Resume

Done. Nothing left for this row; MOBILE-DECODE-COMPARE reads the file.

## Result

* Theory and sources only (16 sources pinned in §9: WebCodecs WD 2026-11-09, Chromium main `aa345ede`, dav1d
  `4e3ab21f`, AV1 spec, libaom v3.15.1, HTML); nothing run on a device, GPU or coder.
* AV1 in software is the one route checked at full precision on every engine today: Chromium runs dav1d with its
  Arm assembly under `prefer-software`; dav1d-WASM (no asm exists for WASM, one thread) where WebCodecs refuses.
* On the phone it bounds the fill (measured: 133–135 ms a frame, `dbts_b1-q8-g8`, three decoders, ~22 frames/s).
* Found in Chromium's code: `optimizeForLatency` sets dav1d's frame delay to 1, so with one tile a decoder's
  threads share one frame; Chromium gives each decoder min(15, cores) threads, 3 × that for the product's three.
* Levers left, none measured on a phone: decoder count, `optimizeForLatency: false` for the fill, 2 × 2 tiles
  (0.64–0.72× on the cloud host; waits on the owner), CDEF/LR off, an 8-bit view, a threaded dav1d-WASM.
* Best case (theory): tiles would take the decode floor 2.25 s → 1.44–1.62 s if the phone has spare cores.
* §8 lists six phone cells (decoder count, latency flag, one decoder alone, sustained run, dav1d-WASM, tiles/8-bit).
* Fixtures: three DBT volumes of one dataset, 4-core cloud hosts without GPU, one phone, one evening.
