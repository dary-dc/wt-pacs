state: done
started: 2026-11-15T22:16Z
heartbeat: 2026-11-15T22:19Z
outputs: PR 397 body §Re-review; claude/mobile-decode 7312b13d (docs/lines/client.md)

## Resume

Done. Brief and amendments unchanged since the start. Next for PR 397: nothing queued; the asks M4–M22 wait on the
next phone round.

## Result

* Subject: claude/mobile-decode ac429058..0741ae7f (README, three option files, the line doc).
* Blocker 1 closed: three routes at the stored depth on every series; AV1 in software full precision up to 10 bits,
  the depth cut above (README §1, §2, §6), the av1-software.md quote verbatim.
* Blocker 2 closed: NV12 read-back on Safari, inversion on Android Chromium and Firefox; quotes match the option files.
* Findings 3–6 closed; Gecko GLBlitHelper.cpp re-fetched at dc1259aee26f: 1173/1227/1260 kFragConvert_None, the
  matrix at 1300/1542/1754, the AndroidHardwareBuffer blit delegating to the EGLImage one.
* Minors 7–17 and the window caveat present, each number matching its option file; next-round.md untouched.
* No blocker open; amendment 17's loop ends. One cosmetic minor: 27 README lines over the wrap.
* Fixtures and limits: a documents re-review; nothing run, no device or GPU; the CDD not re-fetched.
