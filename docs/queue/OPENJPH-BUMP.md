state: started
started: 2026-11-21T13:17Z
heartbeat: 2026-11-21T13:40Z
outputs: claude/openjph-0-33 e6788500 (no PR yet)
## Resume
Pushed claude/openjph-0-33 ddf4dfd2: pins.sh 0.33.0 at 345a8bcd, built/ and manifest rewritten (UPDATE=1), build README's pin row. Host notes: dockerd started by hand; the Containerfile's apt over plain http is refused by the container's proxy (405), so the build image was made from a scratch copy using https snapshot.debian.org with the proxy CA (same packages, same pins) and build.sh run without its `docker build` line; 0.31.0 rebuilt equal to the committed manifest first, 0.33.0 rebuilt twice equal (into build/.rebuilt).
Done also: prerequisites installed; 50 codestreams (the two contract frames, 48 synthetic from ingest 0.31.0 ojph_compress, odd heights, blocks 16/32/64, the served profile) decode to identical samples under both builds (scratch harness, results to the PR body); docs/decode/README.md corrected in place. Running `scripts/gate.sh --quick`. Next: `scripts/check_lab_absent.sh`, draft PR -> claude/unified, docs/lines/client.md PR row, done.
## Result
(pending)
