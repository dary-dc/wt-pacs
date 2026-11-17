state: done
started: 
heartbeat: 2026-11-17T10:25Z
outputs: claude/mobile-decode 6e72321d (docs/decode/mobile/av1-chips.md), 277f0ccb (docs/lines/client.md); PR 397 (body unchanged)
## Resume
Done. Nothing owed by this row; AV1-HW-CHIPS-REVIEW is next (a session that wrote none of it).
## Result
docs/decode/mobile/av1-chips.md: per SoC family, sources quoted at pins (AV1 spec 5e04f3f75e73, AOSP Pixel codec files,
Android MediaCodecInfo, Chromium main, CDD 16, Qualcomm/MediaTek/Samsung pages).
* Only Google's Tensor (Pixel 6-9) publishes an AV1 size limit: 3840x2160 either orientation, <= 32 400 16x16 blocks.
  18 of 19 DBT volumes fit it; dbts_b1 (2560x3328) does not. No vendor names a level, 4:0:0 or a per-codec depth
  (Dimensity 9400's "8K60, 10-bit ... AV1" aside).
* 10 of 19 volumes fit level 4.x; 9 need 5.x (system B, dbts_a4, c1, c3). Android promises 1080p (CDD 5.3.9) and
  4.1 only of performance class V; its API has no monochrome AV1 profile.
* Galaxy S23's SoC now sourced (Samsung newsroom: Snapdragon 8 Gen 2 for Galaxy); its AV1 decoder still unsettled.
* Chromium on Android skips a hardware decoder below the stream's level or size (SelectMediaCodec).
* At a 4.1 ceiling: tiles, superres, large-scale tile and level 31 do not help; AV1 has no sub-picture. Strips as
  separate streams fit (4 for dbts_b1, 2-3 for the others); bytes and seams unmeasured, a cloud byte cell pre-registered.
Fixtures and limits: sizes of the 19 DBT volumes only; no device, no coding run; Qualcomm/MediaTek codec files not reachable.
Owner decision (later): whether strips enter the payload format.
