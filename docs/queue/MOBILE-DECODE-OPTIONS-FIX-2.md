state: done
started: 2026-11-26T22:16Z
heartbeat: 2026-11-26T22:19Z
outputs: claude/mobile-decode cdc1dc80b (new-options.md §3 step 2, §Fix 2; hw-inverted.md §3), 3c3538094 (docs/lines/client.md); no new PR (PR 397's branch)

## Resume

Nothing left. MOBILE-DECODE-OPTIONS-FIX-2-REVIEW is next (a session that wrote none of the file, its reviews or
either fix).

## Result

* Docs only. check_links: 9 unresolved before and after, none new; the gate not run.
* B2 corrected in place: new-options.md §3 step 2's "So the ingest signals 1 (BT.709)" and hw-inverted.md §3's
  "the ingest signals BT.709" struck, with the corrected text beside them.
* What is true today (M, 2026-11-26, client/decode/av1-payload.js sequence() over parsePayload's first frame):
  grey420/g8.av1 mono 0, cp 2, tc 2, mc 2, range 1; optimized/g8.av1 and g10.av1 mono 1, mc 2. ingest.py's
  encoder_args writes no colour description for "420"; lossy_args is --monochrome.
* What the route needs (T): its ingest writes --matrix-coefficients=bt709, or its page sets matrix: "bt709"; never
  "rgb". Neither is built.
* Sources fetched again 2026-11-26: S1 (colour config syntax; matrix_coefficients table, 2 MC_UNSPECIFIED), S2
  (VideoColorSpaceInit; §9.12 "bt709"). Quotations verbatim.
* n1 not taken (a second edit to retracted text).
* Fixtures: three contract payloads' sequence headers only; nothing decoded, nothing run on a device.
* Owner: nothing new.
