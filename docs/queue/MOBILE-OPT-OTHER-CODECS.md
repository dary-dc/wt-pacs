state: done
started: 2026-11-15T14:00Z
heartbeat: 2026-11-15T14:09Z
outputs: claude/mobile-decode b6154b8d (docs/decode/mobile/other-codecs.md; docs/lines/client.md), PR 397 (draft)
## Resume
Done. Nothing owed by this row.
## Result
- Sources: H.264 (06/2026), H.265 V11 (01/2026), VP9 spec v0.7 and levels page, Android 16 CDD, Chromium 157.0.8103.79,
  WebKit 0e349c63, codec registry 2026-09-24; quoted verbatim in the file's §8.
- No browser hands back a hardware frame's samples above 8 bits, whatever the codec: Android Chrome wraps every
  MediaCodec frame as ABGR, desktop Chromium has no P010, Safari gives no format to 10-bit buffers, Firefox gives BGRX.
- At 8 bits: H.264, H.265 and VP9 all define their decoding exactly, so an ingest digest is valid for their hardware
  (H.265's best-effort note covers streams above a decoder's level). NV12 samples come back in desktop Chromium and
  Safari; on Android and Firefox only through new-options §3's inversion (theory).
- dbts_c1 and dbts_b1 need level 5 in every codec (H.264 5.1 for b1). Android requires an HEVC or VP9 decoder at UHD
  (level 5.1 rate) when the display condition holds; for AV1 its floor is 4.1. H.264 High takes 4:0:0 but no phone
  must support it above 1080p.
- Unknown: decode time on a phone, bytes on our data, whether decoders take portrait 2560x3328, Safari's WebCodecs
  decoder per codec.
- Leaning (labelled as one): this is new-options §3 run through a different decoder, worth it only where AV1 hardware
  is missing or refuses the size. HEVC first, then VP9, then H.264. Three phone asks in §6.
- Owner: whether to fund a cloud byte cell (8-bit HEVC/VP9/H.264 on the 19 volumes); HEVC licensing.
