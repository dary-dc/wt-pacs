state: done
started: 2026-11-14T21:13Z
heartbeat: 2026-11-14T22:10Z
outputs: claude/hw-decode b631179a (e7457cd3, 6cf17612, b631179a); PR #387 body (Review section)
## Resume
Done. Nothing pending.
## Result
- 15 of 39 quoted claims drawn at random (seed 20261114), re-fetched at their pins: 15/15 hold; Android's reference pages changed hash, same text.
- Amendment 1: only desktop Chromium's 8-bit GREY420 (NV12 plane copy) and native return samples to an XXH3; nothing on the phone, nothing at 10 bits in a browser (§18.1).
- Amendment 10a verified: no spec defines the YUV-to-RGB conversion (WebCodecs §9.4.6, WebGPU §6.4/6.5, WebGL pixel storage), so a GPU hash cannot match an ingest digest.
- Amendment 10b verified: copyTo({format: "I420P10"}) is NotSupportedError by spec and in Chromium 157/158.
- Amendment 2: prefer-software arrived in WCDEC 5810acc8 with no recorded reason (a documentation finding); today's sources still support it.
- Amendment 3: GREY420 is the browser's only checkable hardware form, 8-bit, desktop Chromium, unmeasured on hardware.
- Corrected in place: WebGL's half-float path is CPU frames only; the S23's SoC is unsourced and a republished Qualcomm release claims AV1; §11, §16 notes.
- Fixtures and limits: no device, no GPU; sources only. Gate stopped at prerequisites (WASM transport unbuilt), docs-only; check_links 0 unresolved; comment budget green.
- Device-only: S23 AV1 hardware at all, 4:0:0 on its codec, GREY420 NV12 exactness and speed, WebGL shared-image precision (§17 probe).
- Owner: whether an 8-bit checked or an unchecked hardware view is ever acceptable; the reason line beside prefer-software.
