state: done
started: 2026-11-14T23:13Z
heartbeat: 2026-11-14T23:27Z
outputs: claude/hw10-routes bbceb9e3 (9faeb4fd, bbceb9e3; from origin/claude/docs-client); draft PR #392 into claude/docs-client; claude/hw-probe 579b0378 (README asks only)
## Resume
Done. Nothing pending. Next row: HW10-ROUTES-REVIEW (a session that wrote none of it).
## Result
- docs/decode/hardware-10bit.md: routes for a checked 10-bit hardware frame, ranked; sources pinned in §10.
- Browser: none today, none behind a flag. copyTo has no P010; WebGPU import/copy go through an 8-bit N32 image after conversion; every WebGL2 hardware path is 8-bit (hardware.md §13's unknown resolved); Dawn's P010 biplanar format is Dawn-only; Android uses AIMAGE_FORMAT_PRIVATE (no planes).
- Native: MediaCodec ByteBuffer/YCBCR_P010 (ranked 1st for the phone), Vulkan (GPU hash, no read-back), D3D12, VA-API, NVDEC, VideoToolbox all return P010; 4:2:0 constant chroma needed except on NVDEC.
- XXH3-64 in WGSL is feasible (parallel block sums, one serial scramble chain); its cost is unmeasured.
- Probe: Chromium 141's copyTo({format:"I420P10"}) is a renderer crash by source (throw without return, then a fatal NOTREACHED); 153 rejects it (M); 157/158 reject it while parsing. Asks appended to lab/devices/README.md.
- Upstream: WebCodecs P010 format; Chromium 10-bit shared-image read-back; gpuweb#5281; an Android WebCodecs YUV output path.
- Fixtures and limits: no device, no GPU, sources only; 141 not reproduced; the fix commit was not identified. Gate stopped at prerequisites (WASM unbuilt), docs only; check_links has no new unresolved links; comment budget ok.
- Owner: whether a native client is the 10-bit hardware route.
