state: done
started: 2026-11-15T19:17Z
heartbeat: 2026-11-15T19:21Z
outputs: claude/mobile-decode ab0dddf0 (docs/decode/mobile/README.md), fae7498c (docs/lines/client.md); claude/phone-protocol d2c4949b (next-round.md asks M4–M22, §10 item 7); PR 397 (draft, existing)

## Resume

Done. Next row: MOBILE-DECODE-COMPARE-REVIEW, by a session that wrote none of README.md. Brief and amendments
unchanged since the start.

## Result

* One table across the nine option files at `f4021c40` (README.md §2); numbers quoted from the files, not re-derived.
* Full precision today only off hardware: AV1 software (the only row timed on a phone, 133–135 ms), HTJ2K software,
  lossy HTJ2K (checked only from one WASM build), HTJ2K in WebGPU (exact, lab tool, untimed).
* Hardware: checked only at 8 bits by inversion (7.78 bits or fewer, 1.16–2.49× bytes); unchecked AV1 hardware fails
  amendment 1 alone; HEVC/VP9/H.264 the same route, bytes unmeasured.
* Lossy HTJ2K and the content rectangle shrank on their own cloud cells (median 1.05× bytes; crop ≈1 except dbts_b1).
* Sources decide alone (§3, five fetched today and quoted): exact decoding makes an ingest digest valid for hardware;
  WebCodecs' format may be null; WGSL may reassociate (no float GPU check); no phone promised level 5.0; WASM floats
  deterministic short of NaN.
* Asks M4–M22 added one line each to next-round.md §Decode-option cells; left out with reasons: tiles/8-bit view and
  other codecs' byte cell (owner's), WGSL XXH3 (not built), the 8-bit rounding cloud cell (owed, not phone).
* Leaning (labelled): AV1 software stays the route of record until cell 1, M20 and M1–M7 report.
* Fixtures: three timed DBT volumes, 19 for bytes; 4-core cloud hosts, no GPU; one phone, one link. Nothing run.
* Owner: decode at the screen's size reopens "no low-resolution preview"; hardware-paints-first shows unchecked frames.
