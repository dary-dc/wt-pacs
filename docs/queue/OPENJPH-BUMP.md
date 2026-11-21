state: done
started: 2026-11-21T13:17Z
heartbeat: 2026-11-21T13:50Z
outputs: claude/openjph-0-33 ddf4dfd2, e6788500, 30431675; PR 425 (draft into claude/unified)
## Resume
Done. Next: UNIFIED-BUILDS-REVIEW (a session that wrote none of it) reviews PR 425 per the standing rule. Host notes for it: start dockerd by hand; the Containerfile's plain-http apt is refused by the container proxy (405), so build the image from a copy using https snapshot.debian.org with /root/.ccr/ca-bundle.crt (Acquire::https::CAInfo, --network host, https_proxy build-arg), tag it wt-pacs-decoder-build, and run build.sh without its docker build line; OUT must be inside the repo (build/.rebuilt), the container mounts only the repo and the cache.
## Result
OpenJPH 0.31.0 -> 0.33.0 (tag commit 345a8bcd, upstream's "Fixes CVE-2026-111151") in client/decode/wasm: pins.sh, built/ and manifest.sha256 rewritten by UPDATE=1 build.sh; the wrapper builds unchanged; dav1d and xxh3 outputs byte-identical.
Measured: 0.31.0 pins rebuilt equal to the committed manifest first; 0.33.0 rebuilt twice, equal. 50 codestreams (2 contract frames, 48 synthetic from the ingest's 0.31.0 ojph_compress: odd heights, 8-16 bits, blocks 16/32/64 and the served profile) decode to identical samples, lengths and ranges under both builds; 44/44 above 8 bits equal their raw input (the 4 8-bit inputs are misread by the 0.31.0 encoder, upstream #336, equal under both decoders).
Gate --quick OK (664 s; rebuild done by hand, 11 skips named in the PR body); check_lab_absent OK; links and comment budget green. docs/decode/README.md corrected in place; docs/lines/client.md has the PR row.
Fixtures and limits: synthetic grey frames and two contract frames, unsigned, reversible; no DBT volume; no time measured.
Not done: the ingest's encoder (ingest/tools.sh, encode.cpp's static_assert) stays 0.31.0, a separate call.
Owner: merge PR 425 or not.
