state: done
started: 2026-11-12T06:16Z
heartbeat: 2026-11-12T06:50Z
outputs: claude/direction d81dc673 (0d131907 docs/lines/codecs.md and docs/lines/README.md's date; d81dc673 a link fix), no PR (the owner reviews claude/direction on Friday)
## Resume
Done; nothing left.
## Result
* docs/lines/codecs.md in the brief's six parts, read against the demo tip 18d2d1ff, the queue's status files and the open AV1/HTJ2K PRs.
* Folded in, corrected in place: #357's corrections (bytes 0.10-0.28 at the rule's Q; σ by Immerkær's estimator; the two bars;
  "a higher Q does not" withdrawn), #350's harvest, #373's measured B0/B/A/C (decode 1.24-1.74 Hp at Q 8, 1x; x* 4.7584/4.6359/4.8024).
* On main after the merge: the AV1 payload doc, the lab tool's OQ pair (Q 0 refused, sourceFingerprint), the decode route,
  cubic-restart default with bbr options, the lab harness under the absence check.
* Open, ranked: (1) which reading of VL sets Q, (2) G at equal quality, (3) decode on a slow device, (4) HTJ2K at screen
  resolution (HTJ2K-MEASURE running), (5) AV1 tiles, (6) the pair's controller, (7) corrections applied per branch,
  (8) noise detection for the PCS, (9) the chain into unified-codecs, (10-12) GPU/phone, server defaults, dataset hub.
* LINES-READY's question: yes, a server.md line file is proposed; the split is the owner's, server stays in codecs.md until then.
* Checks: scripts/check_links.py 0 unresolved. Docs only: gate not run.
* Fixtures named in the doc: dbts_a1/b1/c1 of one dataset (19 DBT volumes for quality), no ultrasound cine, 4-core hosts without a GPU, one phone run.
* Owner: the VL bar and reading; whether a temporally denoised view counts; the controller; HTJ2K level picture and the PCS profile ask; the hub; the server.md split.
