state: done
started: 2026-11-19T13:17Z
heartbeat: 2026-11-19T13:25Z
outputs: claude/engines 61f96f14, draft PR 410 into claude/unified
## Resume
Done. docs/decode/engines.md pushed; PR 410 open as a draft. Nothing left for this row.
## Result
docs/decode/engines.md: 12 client results x Chromium, Firefox, Safari macOS, Safari iOS; each cell sourced (E1-E26,
engine sources pinned at Chromium fb1f1ab4ba16, WebKit 4c0a9cbebc3d, Gecko d5236b1340fb; BCD 70a51a128b3f),
measured (version named), cloud-runnable (7 commands with predictions for ENGINE-SMOKE) or device only.
Chromium: every row measured or runnable. Firefox: all but the reports; its WebCodecs route fails by design, dav1d
serves. Safari: no row measured; WebCodecs AV1 only with AV1 hardware (WebKit enables it on detecting a decoder),
WebTransport only from macOS/iOS 26 (HAVE(WEBTRANSPORT)), SharedArrayBuffer exposed per global by the embedder.
demo-check.mjs is Chromium-only; Firefox's equivalent is client/viewer/check.mjs --engine firefox under Xvfb.
Docs only: check_links and comment budget green; gate not run. Line doc docs/lines/client.md updated.
Owner: nothing owed from this row; ENGINES-PAGE asks the decisions.
