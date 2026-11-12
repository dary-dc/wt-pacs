state: done
started: 2026-11-12T09:22Z
heartbeat: 2026-11-12T12:05Z
outputs: claude/hidden-page-decode a66e9890, draft PR 376 -> claude/demo-fixes-2; claude/hidden-page-decode-beacon (off claude/phone-tools) 38e1906c+, draft PR 377 -> claude/phone-tools
## Resume
Done. PHONE-FIX-REVIEW reviews PR 376 (and 377). Branch commits: b495c649 failing test, 5afb9734 fix, test tightened,
9d7e8a5a/a66e9890 docs/reviews/hidden-page-decode.md + docs/lines/client.md. Beacon: 4230419c failing tests, 0efeba4c change, README.
Gate setup used here: dockerd, pip meson==1.9.1, client/decode/wasm/build/build.sh, ingest/tools.sh, rustup target add
wasm32-unknown-unknown, cargo install wasm-pack --version 0.15.0 --locked, client/transport/wasm/build.sh,
client/decode/wasm/fetch_openjph.sh, then scripts/gate.sh.
## Result
Load 13 was not WebCodecs reclamation: Chromium reclaims only platform decoders, backgrounded, under pressure, after
90 s idle (reclaimable_codec.cc/.h, decoder_template.cc); the client uses prefer-software. The trace: keyframes 0/8/16
delivered after ~18 s inside the decoder, the rest of their groups failed as orphaned. Reading: the page was stopped;
on resume the downloader's 10 s decode deadline fired late and replaced decoders that had just delivered a keyframe.
Fix (PR 376): a deadline firing > frozenMs (1 s) late is given again; a decoder silent through a running deadline is
still replaced. Test fails pre-fix; 7 mutants killed. Beacon (PR 377): visibility/freeze/resume/pagehide records with
visibilityState; 9 mutants killed, the install() wiring survives in node (DOM).
Gate OK (577 s) on PR 376's branch, with its own skips (native window, numpy checks, ingest compare, Firefox, nginx).
Limits: one load, one phone, one evening; visibility unrecorded in that run; nothing run on a phone.
Deviation: the beacon change is on a second branch (claude/hidden-page-decode-beacon) because lab/phone lives only on
claude/phone-tools; it overlaps the phone session's RUNNER-AUTO.
Owner decisions: whether a replaced decoder's group is asked again from its keyframe (the contract rig pins "rest
fails by name" today); merging 376/377 after PHONE-FIX-REVIEW.
