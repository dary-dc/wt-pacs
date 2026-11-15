state: done
started: 2026-11-15T02:16Z
heartbeat: 2026-11-15T02:19Z
outputs: PR #392 body §Review (claude/hw10-routes); claude/hw10-routes b2c10f52 (docs/lines/devices.md)
## Resume
Done. Nothing pending. hardware-10bit.md itself not edited (the brief puts findings in the PR body); its fixes are a later firing's or the owner's.
## Result
- 16 sources fetched at pinned revisions (Chromium 141/153/157, Dawn, Vulkan-Docs, DirectX-Headers, xxHash spec); every quote holds; every §10 hash matches.
- F1: §6 WebGL2 on Ozone: a multi-plane P010 shared image can prefer the external sampler and take the texture-copy path to a float target; 8 bits unproven there, still converted, so closed.
- F2: §6 Skia bullet omits the packed types ValidFormatForDirectUploading accepts (fewer bits; conclusion holds).
- F3: §9 row 1 above row 2 follows the phone's priority, not the stated rule (cost favours Vulkan).
- F4: §10 omits 157 media_switches.cc (08f2faab9844).
- Ranking otherwise follows the table. Sources alone settle: no shipped browser route serves the checked 10-bit view. Device needed: row 1 (phone codec's AV1 Main 10 to P010 in ByteBuffer, bit-exact on 4:2:0 constant chroma, decode time); row 2 a Vulkan driver.
- Fixtures and limits: sources only; no device, no GPU, nothing run; the gate not run (docs only).
- Owner: whether a native client is the 10-bit hardware route (unchanged).
