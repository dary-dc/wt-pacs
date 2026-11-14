state: started
started: 2026-11-14T19:01Z
heartbeat: 2026-11-14T19:06Z
outputs: claude/hw-decode (from origin/claude/docs-client), draft PR into claude/docs-client: pending
## Resume
Sources read so far (not yet in a doc): Chromium 157.0.8103.79 and 158.0.8127.36 (raw.githubusercontent.com/chromium/chromium/<tag>/):
gate 2 unchanged (av1_decoder.cc "Only YUV 4:2:0 and YUV 4:4:4"); Android MediaCodecVideoDecoder does not run AV1Decoder;
frames still ABGR (video_frame_factory_impl.cc:157); HBD copyTo formats unconditional at 157 (and "stable" already at 141),
P010 still not in IsFormatEnabled; WebGPU importExternalTexture zero-copy NV12 only, else N32 ("High bit depth formats
should also use F16, but do not yet"); WebGL video upload intermediate N32 (video_frame_image_util.cc:354). Android docs
(Last updated 2026-08-03): AV1ProfileMain8/10 "AV1 Main profile 4:2:0". Qualcomm SD8G2 brief lists no AV1.
Next: vendor SoC pages, WebCodecs/WebGPU/WebGL/AV1 spec text, WebKit, Gecko, Apple; then write docs/decode/hardware.md
on claude/hw-decode (from origin/claude/docs-client).
## Result
