state: started
started: 2026-11-15 13:45 UTC
heartbeat: 2026-11-15 13:52 UTC
outputs: claude/mobile-decode (not yet created; from origin/claude/docs-client)

## Resume

Scope: amendment 20 (new options only). Read: design.md, payload-format.md, hardware.md (PR 387), hardware-10bit.md,
the HTJ2K-SCREEN/VERDICT, DEPTH8 and FILL-SPLIT results. `claude/mobile-decode` exists locally from
`origin/claude/docs-client`, nothing pushed on it yet. Sources fetched (AV1 spec, WebCodecs WD 2026-11-09, WebGL,
Android 16 CDD, DICOM PS3.5 2026d, OpenJPH, the HTJ2K white paper). Options being written into
`docs/decode/mobile/new-options.md`: a hardware frame checked by inverting its 8-bit picture (and a second picture
for more than 8 bits); a lossy HTJ2K view; the coded picture cropped to its content. Next: write the file, push,
append the MOBILE-OPT rows to `docs/queue-client-2026-11-14.md`, open the draft PR into `claude/docs-client`, add the
phone asks to `claude/phone-protocol:docs/phone-rows/next-round.md`, update `docs/lines/client.md`.

## Result

(none yet)
