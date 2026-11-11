state: started
started: 2026-11-11 02:08
heartbeat: 2026-11-11 02:31
outputs: claude/phone-protocol (from claude/demo-fixes-0 618e13c8)
## Resume
Read: README §Demo, §The viewer on an Android phone, claude/phone-no-install's README block (--bind, OPENSSL=, not
yet in the demo tip), client/viewer/viewer.js and index.html, docs/devices.md. Findings for the protocol: the status
line is one nowrap line with an ellipsis; measured in headless Chromium with the page's CSS, a 205-char line shows 49
chars at 412 px and stops at "codec a" at 915 px, so fill time, renderer and the last error are never visible on a
phone; a touch screen cannot step slices (wheel and keys only; drag is window/level). Next: write docs/devices.md §7
(the demo's phone run) on claude/phone-protocol from origin/claude/demo-fixes-0, line note in
docs/lines/optimal-quality.md, push, draft PR into claude/demo-fixes-0.
## Result
