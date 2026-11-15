state: done
started: 2026-11-15 14:26 UTC
heartbeat: 2026-11-15 18:00 UTC
outputs: claude/mobile-decode f4021c40 (docs/decode/mobile/hw-inverted.md; lab/decode/mobile/hw-inverted/ rows and code; docs/lines/client.md), PR 397 (draft, existing)

## Resume

Done. Nothing left for this row; MOBILE-DECODE-COMPARE reads §12. Brief and amendments unchanged since the start.

## Result

* Sources (pinned): Chromium 157.0.8103.79 and 158.0.8127.36 (identical on every function traced), WebKit 19c5103d,
  Firefox release dc1259ae, Vulkan-Docs f7de774c, OES_EGL_image_external, HTML, Android MediaFormat, vendor pages.
* No engine lets the page switch the upload's conversion off for a hardware VideoFrame; Chromium's copy reinterprets
  colour space "to disable color conversion"; Android's range and matrix are the driver's; Firefox always narrow.
* Studio swing on 16...235 is the one form all engines invert; one-to-one likely, not specified (Vulkan "should"
  round to nearest; an fp16 emulation of Firefox's mediump matrix merges one pair, 219 of 220).
* Check: 8.5 MB read back and hashed a dbts_b1 frame, half today's; phone time unknown.
* Cells (M, 19 DBT volumes, libaom 3.15.1/dav1d 1.5.4, one 4-core host, saturated, no time claimed): I2 19/19, I3
  12/14: 1.16-2.49x today's bytes; I1 12/19 (10-bit low); I4 miss: luma leaves 16...235 on every frame, so the form
  needs headroom (~200 levels); I5 129/129; second picture 1.03-1.62x today's (J1 4/6). Mutants n1, n3 fail
  predictions; n2, n5 only tests (e_N blind to an offset). Gate not run (docs and lab only; comment budget ok).
* Levels: only Dimensity 9400 ties AV1 decode to a size (8K); no vendor names a level.
* Owner: whether a checked 7.6-7.8-bit hardware view at 1.2-2.5x bytes is worth it; whether to open the second picture.
