# Red team of the demo tip, 2026-11-11

`claude/demo-fixes-0` at `618e13c8`, read from the code (`client/viewer/`, `client/view/`, `client/decode/`,
`client/transport/consumer.js`, `server/dev-server.py`, `ingest/coded-frames/ingest.py`). Every hit is a failing test
on `claude/demo-redteam`, its finding in the test's doc comment; none is in `scripts/gate.sh` yet, and nothing is
fixed. Each test was also run against a sketched fix (not committed) and passed there, so it fails for its finding
alone. No browser, no server and no fixture series were run: these are node tests of the modules.

| # | the page shows | where | test |
| --- | --- | --- | --- |
| 1 | *Lossless* on a frame of another source: `checkPair` compares `framesSha256` only when both carry it, and no ingest writes it, so frame count, size, depth and sign are the whole source check | `viewer/pair.js` `checkPair` | `viewer/pair-source.test.mjs` |
| 2 | *Lossless* on a frame read through another series' photometric, rescale or per-frame rescale: the controller paints the exact frame through the optimal-quality metadata, and `checkPair` compares none of them | `viewer/pair.js` `checkPair` | `viewer/pair-source.test.mjs` |
| 3 | the wrong depth after the cut, labelled *Optimal quality*: `Controller.take` shifts every frame of a cut series by D − 10 whatever its bits, so the stored form's 12-bit frames under the cut's metadata (both in the demo set) are painted ×4 | `view/controller.js` `take` | `view/depth-cut.test.mjs` |
| 4 | a lossless button that can only fail: `checkPair` reads `digests.algorithm` alone, not one 16-hex digest per frame | `viewer/pair.js` `checkPair` | `viewer/pair-source.test.mjs` |
| 5 | nothing wrong today: `pairOf` admits the ids "." and "..", which resolve to other paths ("/series/./metadata" is this series' own); `checkPair` refuses that one as AV1 | `viewer/pair.js` `pairOf` | `viewer/pair-source.test.mjs` |
| 6 | the overlay gives the exact frame the optimal-quality series' Q, G and depth cut ("htj2k · … · Q 8 · G 8 · 10-bit depth cut of 12"): `showQuality` appends the series' parameters to every frame | `viewer/viewer.js` `showQuality` | none: the text is built in the page, with no node seam; owed to `demo-check.mjs` |

Finding 1 contradicts a claim the code makes on purpose: `pair.test.mjs` accepts a pair without `framesSha256`, and
`client/README.md` §Optimal quality says a digest proves a frame its own series', not this one's source. The fix needs
the owner's call on what names the source (a `framesSha256` the ingest writes into both, or another key).

**Attacked and held** (no test added): a lossy frame labelled *Lossless* (`Controller.quality` admits only the
exact-frame slot, filled only by the exact series' checked frame, asks keyed by index); an exact frame whose digest is
not checked (the exact downloader always gets the digests; a missing one is *Lossless check failed*); a stale frame
(the exact frame is never stored or cached; the OPFS cache takes only checked frames and is off by default); a
WebCodecs refusal not taken to dav1d (every refusal, failed probe and failed import is, `av1.test.mjs` §lossy; a
failure inside a group is not, the owner's call; dav1d refuses a unit whose predecessor it did not decode); a frame
of the wrong index (waiters keyed by index, digests by index); races of `l` with steps and paints (the label can lag
to *Optimal quality* over a lossless paint, never the other way).

**Not attacked here**: loss and reordering on the wire (QUIC streams; TEST-MOBILE's netem pair), a real GPU, a phone.
A WebCodecs probe that stalls once (2 s, `STALL_MS`) is cached as failed for the worker's life and sends every later
frame to dav1d; whether a stall is a refusal is a design question, not a test.

Fixtures: none; the claims are about code paths. The demo set is three DBT volumes (`dbts_a1`, `dbts_b1`, `dbts_c1`)
from one dataset; no ultrasound cine; 4-core cloud host, no GPU.
