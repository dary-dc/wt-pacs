state: started
started: 2026-11-12T09:22Z
heartbeat: 2026-11-12T10:45Z
outputs: claude/hidden-page-decode 9d7e8a5a (b495c649 failing test, 5afb9734 fix, test tightened, docs/reviews/hidden-page-decode.md); claude/hidden-page-decode-beacon (off claude/phone-tools: 4230419c failing tests, 0efeba4c visibility record, README); no PRs yet
## Resume
Branch claude/hidden-page-decode from claude/demo-fixes-2 (18d2d1ff), worktree /home/user/hpd (not yet pushed).
Theory so far, from claude/phone-rows raw/beacon-wifi-8766.jsonl load 2ed36cb0 (load 13): keyframes 0, 8, 16 were
DELIVERED via av1-webcodecs with decodeMs 17.6-18.1 s (decodeStart..decodeEnd inside the decoder worker), and every
other frame of their groups failed "frame N-1 of its group did not decode" = downloader.js pump()'s orphaned(). Groups
24-49 decoded normally (~110-220 ms). Not a WebCodecs reclamation error (that would fail the keyframe as
"undecodable: ... closed"). Reading: the page was frozen/throttled ~18 s; on resume the downloader's decodeMs
watchdog (10 s, downloader.js arm/replace) replaced the decoder that held each group; the new decoder has next=null,
record N-1 is acked/gone, so orphaned() fails the rest of the group instead of asking it again from its keyframe.
DONE: sources read (W3C WebCodecs ED §11 Resource Reclamation; Chromium main reclaimable_codec.cc/.h 90 s,
backgrounded + global pressure, decoder_template.cc pressure only IsPlatformDecoder; codec_pressure_gauge.cc
Android threshold 4) => our prefer-software decoders are not reclaimed by Chromium; load 13 is not reclamation.
Fix: downloader arm() re-arms a deadline that fires > deadlines.frozenMs (1000) late; test
aFrozenPageKeepsItsDecoder; mutants killed: no check, no re-arm, threshold ignored, due at arming, always re-arm,
no default, default 5 s. DONE also: beacon visibility on claude/hidden-page-decode-beacon (9 mutants killed, install() wiring survives in node),
docs/reviews/hidden-page-decode.md, docs/lines/client.md. NEXT: gate per claude/gate-cloud setup on /home/user/hpd
(scripts/gate.sh, --no-browser if browser fails), then two draft PRs (-> claude/demo-fixes-2, -> claude/phone-tools).
OLD PLAN: sources (WebCodecs spec §Codec reclamation; Chromium reclaimable_codec.cc; Page Lifecycle freeze), a failing
downloader test (replace a decoder holding a group after its keyframe was delivered -> rest of group must still
arrive), fix (re-ask the group from its keyframe on a fresh decoder), mutate, beacon visibility on claude/phone-tools
or the tip's lab beacon, docs/reviews/hidden-page-decode.md, gate, draft PR into claude/demo-fixes-2.
## Result
