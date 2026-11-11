state: done
started: 2026-11-11T14:44Z
heartbeat: 2026-11-11T14:49Z
outputs: claude/dav1d-lazy 7cf46ef7 (from claude/proposals), docs/lines/proposals.md §P6; no PR (the row names none)
## Resume
Done. Nothing to resume.
## Result
P6 written: theory and a pre-registered protocol, no build, no measurement (against the demo tip claude/demo-fixes-1 daee0d1d).
Today every AV1 page fetches dav1d three ways (head.js preload; each worker's av1.js init; compile only on first use):
636 484 B raw (dev-server.py, no gzip), 243 481 B gzipped, per cold page, possibly more if workers miss the HTTP cache
(a worker's fetch never consumes the page's preload: Fetch Standard, quoted).
Three forms: (a) today; (b) the brief's, fetch after the first refusal: +4.0 round trips (COLDRTT) +transfer on a refusing
device, +0.3 to +0.5 s to the first picture at 60 ms; (c) proposed, probe the metadata's layouts at worker start, fetch at
once if refused / no VideoDecoder / over 10 bits: the fetch hides in the 7-round-trip dial, 0 to +150 ms (assumption).
Accepting devices: -0.24 to -0.64 MB, first picture 0 to -250 ms (assumption). Refusing engines on record: Firefox 157, WebKit
(every frame on an iPhone); no phone's WebCodecs probed yet.
A failure inside a group loses the group's rest in every form (dav1d cannot start mid-group); (b)/(c) fetch at the first
failure, ready for the next keyframe.
Protocol: arms a/b/c, three P5 series, forced refusal (DEMO-UX item 3's lever) and forced mid-group failure, 20 Mbit 30 ms
clean and 1 % loss, cold/warm, 9 rounds rotated; rule stated first (bytes are the gain, no time cost allowed).
Fixtures and limits: dbts_a1/b1/c1, one dataset; headless Chromium on a 4-core host without a GPU; netem, not radio.
Owner: whether MEASURE-2 or a later row runs P6's protocol.
