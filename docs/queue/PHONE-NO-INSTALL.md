state: started
started: 2026-11-11 01:42
heartbeat: 2026-11-11 01:47
outputs: claude/phone-no-install (from claude/demo-fixes-0 618e13c8)
## Resume
Demo tip: claude/demo-fixes-0 618e13c8. On claude/phone-no-install: c601bbdb (dev-server.py --bind, 4 tests, 5
mutants killed), 7db57ecb (gen_dev_cert.sh OPENSSL=..., gen_dev_cert_test.sh in the gate, 4 mutants killed).
Running: scripts/demo-series.sh (log /tmp/demo-series.log; rerun if lost: pip install meson==1.9.1 &&
scripts/demo-series.sh) for (3)'s byte table.
Chromium source for the flag (commit 463745830f5e): about_flags.cc:8057 "unsafely-treat-insecure-origin-as-secure",
kOsAll (includes kOsAndroid), outside any #if; flag_descriptions.h:4932 name "Insecure origins treated as secure".
Next: README §Demo variant "laptop without installs" (podman rust image as OPENSSL, jq for the hash, --bind
$LAPTOP_IP, chrome://flags); then the namespace check (docs/queue/PHONE-PAIR-harness, needs socat? not needed now:
no adb reverse), docs/lines/viewer.md note, draft PR into claude/demo-fixes-0.
## Result
