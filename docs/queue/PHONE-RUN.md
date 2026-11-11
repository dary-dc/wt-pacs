state: started
started: 2026-11-11T15:20Z
heartbeat: 2026-11-11T19:20Z
outputs: claude/phone-devtools 4fd55e5c (request 4b: lab/phone/devtools.py, from c6da7275); claude/phone-run 48f554a6 (replaced, left as is)
## Resume
Coordinator's message of 18:50Z received: set up on c6da7275, no timed load until PHONE-TOOLS-2 names the run commit.
Done on c6da7275: wt-pacs-server-telemetry built locally (labels revision=c6da72751b9e, features=telemetry; two cores);
request 4b on claude/phone-devtools 4fd55e5c (tabs, console, eval, trace over adb forward; loopback test, 9 mutants
killed, added to the gate; not yet run against the phone). adb 37.0.1 user-only in ~/opt/platform-tools.
Running: demo series at c6da7275 (with sourceFingerprint) in a throwaway container, 2 cores, output kept under the
home directory in wt-pacs-data/demo-series/c6da7275-aom3.15.1-ojph0.31.0-dav1d1.5.4 (sources and coders beside it).
Waiting on the owner: firewall zones with tethering on; USB debugging. Next: README step 8's read-path check with
the image; the eye check. At the run commit: rebuild the image (revision label) and reuse the series only if
`git diff c6da7275 <run> -- ingest/ lab/av1/ scripts/demo-series.sh` is empty.
Note for the commands: the Second amendment's `nmcli radio wifi off` and `nmcli device modify ... never-default` go
through NetworkManager's polkit; this session hands them to the owner rather than running them.
## Result
(pending)
