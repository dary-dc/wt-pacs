state: started
started: 2026-11-24T11:46Z
heartbeat: 2026-11-24T11:54Z
by: 39HfyrXq
outputs: claude/us-end-to-end 4bcf85ec4 (no PR yet)
## Resume
Plan: scripts/stacks_end_to_end.sh (gate step, skipped by name when the fixtures are not cached): dbts_a1's pinned
DICOM object and usb_cine (+ usb_cine_rgb) wrapped as a multi-frame US object from the pinned frames, each through
ingest/from-dicom/from_dicom.py, the bundle's digests against the pinned frames, then client/viewer/check.mjs page
and worker. Fixtures: OUT=<cache> lab/av1/fetch_data.sh dbts_a1 usb_cine usb_cine_rgb (zenodo zip 1.5 GB). Build:
pip install meson==1.9.1; python3.11 -m venv .venv && .venv/bin/pip install --require-hashes -r ingest/requirements.txt;
ingest/tools.sh. Pushed: the script, helper and gate step. dbts_a1 measured: 56/56 exact in page and worker. Next: usb_cine(_rgb) once fetched, mutations, FIXTURES.md §Stacks end to end, gate, draft PR.
## Result
