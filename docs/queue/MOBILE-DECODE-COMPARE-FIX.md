state: done
started: 2026-11-15T21:16Z
heartbeat: 2026-11-15T21:20Z
outputs: claude/mobile-decode 84dbdef2 (README), 54222b48 (option files), 0741ae7f (docs/lines/client.md); PR 397 body §Fix

## Resume

Done. Next: MOBILE-DECODE-COMPARE-FIX-REVIEW (a session that wrote neither the comparison, its review nor this fix).
Brief and amendments unchanged since the start.

## Result

* Blocker 1 closed: README §1, §2, §6 say AV1 in software is full precision up to 10 bits, the depth cut above;
  three routes keep the stored depth on every series. Earlier text quoted in Corrected notes.
* Blocker 2 closed: README §1, at 8 bits by NV12 read-back on Safari, by inversion on Android Chromium and Firefox.
* Finding 3: hw-inverted.md §1–§4, README §3 item 2: narrow range on desktop Firefox only; re-checked against Gecko
  GLBlitHelper.cpp at dc1259aee26f (kFragConvert_None at 1173, 1227, 1260).
* Findings 4–6: gpu-compute-decode.md WebGPU reach and S3 label; other-codecs.md VP9 citation; HEVC figure unverified.
* Minors 7–17 and the window caveat: one line each in the README.
* Untouched: asks M4–M22; no other number changed. check_links 9 unresolved, same as before; personal paths clean.
* Fixtures and limits: a documents fix; nothing run, no device or GPU.
