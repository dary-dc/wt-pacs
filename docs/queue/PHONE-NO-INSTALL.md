state: started
started: 2026-11-11 01:42
heartbeat: 2026-11-11 01:56
outputs: claude/phone-no-install (from claude/demo-fixes-0 618e13c8)
## Resume
Demo tip: claude/demo-fixes-0 618e13c8. On claude/phone-no-install: c601bbdb (dev-server.py --bind, 4 tests, 5
mutants killed), 7db57ecb (gen_dev_cert.sh OPENSSL=..., gen_dev_cert_test.sh in the gate, 4 mutants killed).
demo-series.sh done (710 s, 23 series): table in docs/queue/PHONE-NO-INSTALL-harness/demo-series-table.txt.
Check (harness run.sh, needs iproute2, docker's rust:1 as the podman image, Playwright channel "chromium": the
headless shell ignores the flag): dbts_a1-q8-g8-cut with the flag 56/56 av1-webcodecs, l -> Lossless; without it
isSecureContext false, WebTransport undefined, 0 frames.
Chromium source for the flag (commit 463745830f5e): about_flags.cc:8057 "unsafely-treat-insecure-origin-as-secure",
kOsAll (includes kOsAndroid), outside any #if; flag_descriptions.h:4932 name "Insecure origins treated as secure".
Next: README §Demo variant "laptop without installs" (podman rust image as OPENSSL, jq for the hash, --bind
$LAPTOP_IP, chrome://flags); then the namespace check (docs/queue/PHONE-PAIR-harness, needs socat? not needed now:
no adb reverse), docs/lines/viewer.md note, draft PR into claude/demo-fixes-0.
## Result
