state: done
started: 2026-11-15 13:59 UTC
heartbeat: 2026-11-15 14:07 UTC
outputs: claude/mobile-decode a9422dee (docs/decode/mobile/gpu-compute-decode.md, docs/lines/client.md), draft PR 397 into claude/docs-client
## Resume
Nothing left. Docs only: check_links.py clean for this file, check_personal_paths.sh clean; no gate (no code). Phone
cells listed in the file's §9, not added to next-round.md (MOBILE-DECODE-COMPARE carries the asks).
## Result
* Option 4 as its advocate. Theory and sources (8, pinned); nothing run on a GPU or a device.
* Found: the option is already built in the lab: lab/av1/decode/webgpuht, 1 158/1 158 frames exact on SwiftShader; only its time is unknown.
* Checked and full precision only on the reversible 5/3 path: WGSL integers wrap exactly, while f32 may be reassociated or fused (WGSL spec), so a 9/7 GPU synthesis cannot meet an ingest digest.
* Cost model (theory): 0.621 ns a sample on the ICIP 2019 low-end card -> 5.3 ms a dbts_b1 frame; breaks even with one phone software AV1 decoder if the phone GPU is <= 25x slower.
* Bytes: the exact series, 4.63x the view on dbts_b1; a fill matches today's view only above ~382 Mbit/s goodput (derived).
* Window/level and every tool work on the true samples, but only with a WebGPU painter (today WebGL2): structural, for review.
* Ships: Chrome Android 12+ Qualcomm/ARM (121), Safari iOS 26; not Firefox Android, not Xclipse.
* AV1 with GPU reconstruction: named only (section 8).
* Fixtures: 3 timed DBT volumes, lab exactness series, no GPU in the cloud, one phone, one home link.
* Owner: whether a WebGPU painter may be designed; whether the four phone cells join the next round.
