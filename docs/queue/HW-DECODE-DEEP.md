state: done
started: 2026-11-14T19:01Z
heartbeat: 2026-11-14T19:14Z
outputs: claude/hw-decode c5f830b2 (from origin/claude/docs-client); draft PR #387 into claude/docs-client
## Resume
Done. Nothing pending.
## Result
- docs/decode/hardware.md corrected in place (§1, §4.1, §4.2, §4.3) and §11–§17 added; sources pinned (Chromium 157.0.8103.79, 158.0.8127.36).
- Phone (Chrome 157, Android): MediaCodec path skips Chromium's AV1 front end (4:0:0 is the device codec's call); frames still ABGR, copyTo gives BGRX: no hardware path returns the view's samples.
- Desktop: 4:0:0 still refused at gate 2; P010 still has no WebCodecs format; HBD formats were already stable at 141 (correction).
- GPU without read-back: WebGPU importExternalTexture and the quoted WebGL paths keep 8 bits in 157/158; WebGL half-float YUV upload unknown.
- isConfigSupported(prefer-hardware) matches profile and size only: it cannot tell whether a layout decodes.
- Galaxy S23's SoC: Qualcomm's two Snapdragon 8 Gen 2 briefs list "H.265 and VP9 decoder", no AV1; settled only on the device.
- §17: device probe (g8, g10, g8f, g10f, ramp10; prefer-hardware against prefer-software; record format, copyTo, decoder name, upload precision).
- Fixtures: no device, no GPU; the phone's exact 157 build not recorded. Gate stopped at prerequisites (WASM client unbuilt); docs-only, check_links 0 unresolved.
- Owner: whether an 8-bit, unchecked hardware view is ever acceptable beside the 10-bit software one.
