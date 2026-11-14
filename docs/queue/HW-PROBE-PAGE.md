state: done
started: 2026-11-14T22:20Z
heartbeat: 2026-11-15T00:05Z
outputs: claude/hw-probe 0d330405 (from origin/claude/docs-client); PR to be opened by HW-PROBE-PAGE-REVIEW from docs/queue/HW-PROBE-PAGE-pr-body.md
## Resume
Done 2026-11-15T00:05Z by the cloud finish (steps 1 to 5); nothing left for a cloud worker. Next: HW-PROBE-PAGE-REVIEW
opens the draft PR from HW-PROBE-PAGE-pr-body.md; the phone run stays with the local session phone-tests.

The local brief, as it was:
Built by the local session phone-tests in lab/devices/ (amendment 15); the headless finish is handed to a cloud
session (the owner, 2026-11-14: cloud before this machine). Pushed at 77270295, not yet green:
make_hw_units.py (run locally with ingest's build: do not rerun unless the encoder changes), hw-units.json (9 units),
hwdecode.js (D0's matrix, 27 cells, each cell in a worker of its own; called from caps.js capabilities()),
hwdecode-worker.js (the cell's tasks: decode, copy per format, webgl2, webgpu, sources, environment),
hwdecode.test.mjs (headless Chromium through collector.py: as written, then mutants plane, expected, codec, unit,
paint), README section "The hardware-decode probe". runner.js's say() also logs "status: ..." so the test sees progress.

Known: Chromium 141 headless, copyTo({format: "I420P10"}) of a 10-bit software frame blocks the thread that calls it
(seen on the page's thread first, hence the worker per cell). Open at 77270295: the run as written stalls at cell 7
(g10-16, no-preference) and gives no D0 row in 240 s, although each task is bounded (hwdecode.js worker(): 10 s a
task, 30 s a decode, then the worker is ended and the task recorded as hung). Find why the bound does not fire
(suspects: a blocked worker blocking the page too, the decode task in the worker, or WebGPU's adapter in each
worker), fix it, keep every outcome recorded (a hang is an outcome, never a dropped cell).

Next, the cloud finish (one session, claude/hw-probe only, push after every step):
1. CHROME_PATH=<Chromium 141 headless> WAIT_S=600 node lab/devices/hwdecode.test.mjs --out target/hw-probe-headless.json
   (BASE_ONLY=1 runs the unmutated pass alone; NO_WEBGPU=1 drops --enable-unsafe-webgpu). Green means every claim
   PASS; the paint mutant may SKIP only if no path keeps more than 256 levels, and says so.
2. Mutate the test itself once per claim (break the code it checks, see it FAIL), list the mutants killed in the
   commit message.
3. Remove anything left from debugging; comment budget (scripts/comment_budget.sh); scripts/check_lab_absent.sh green;
   the gate per CLAUDE.md, naming every skip.
4. Commit the headless report's summary lines (not the JSON) into lab/devices/README.md's Tested paragraph, labelled
   headless Chromium 141, software paths only, SwiftShader, no device.
5. Write docs/queue/HW-PROBE-PAGE-pr-body.md here (title, question, what is built, how to run, what the headless run
   showed, untested: any phone, any hardware decoder, Firefox, WebKit; no Generated-by line or session link), then set
   this file's state: done with outputs and a Result. The phone run stays with the local session phone-tests.
## Result
Headless test green at 0d330405 on claude/hw-probe, in headless Chromium 153 (Chrome for Testing 153.0.8010.12;
141 could not be fetched in the container), SwiftShader, software paths only, no device: 11 claims PASS, paint
SKIP (no path kept more than 256 levels), 3.5 min.

The stall was the test's, not the page's: probe() removed rows/, which collector.py creates only at start, so
every D0 POST failed and the test waited out WAIT_S; a throw then left the collector holding the pipe. Fixed
(335e0c85, 1a5e99d2), with the plane claim's judged() on cells. Chromium 141's own blocking copyTo is not
reproduced (153 throws NotSupportedError); a new mutant, hang, spins in copyTo to I420P10 and the bound records it.

Mutants killed (each claim's code broken once): support answer not recorded; a decode's error dropped; the last
format not copied; the source pattern off by one; one codec string for all; luma judged against reversed samples;
the plane, expected, codec and unit mutants disabled; the task bound lifted under hang. Paint: not killable here.

Read: no-preference and prefer-software decode every unit exactly in the frame's own copy; prefer-hardware is
unsupported; every explicit YUV copyTo is refused, RGB copies inexact; WebGL2 at most 256 levels; WebGPU's import
fails on SwiftShader's fallback adapter. Gate (full) OK, 8 skips by name in 0d330405's message;
check_lab_absent.sh OK. Untested: any phone, any hardware decoder, Chromium 141, Firefox, WebKit.
