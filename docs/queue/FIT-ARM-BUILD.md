state: done
started: 2026-11-24T15:47Z
heartbeat: 2026-11-24T16:42Z
by: Eh9ts3Aw
outputs: claude/delivery 893f04aad..854372707 (lab only; PR 406, body §4)
## Resume
Done. Next: FIT-ARM-BUILD-REVIEW (a session that wrote none of it), then DELIVERY-RUN-2.
## Result
Lab only (plus a lab read of the window pass in client/paint and three lab parameter names in head.js). Every item of A2.8's build list built.
Model: 6 arms, 12 rounds; K3′ from B loads only; A2.7's table and A2.3's SPLIT ÷ A and x reproduced to the digit from the 23rd's inputs.
FIT: dbts_b1 level 1 (1280×1664), prefixes 26.9–27.3 % of a frame; level checked against ll.py, rest by the frame digest; window read-back equal byte for byte.
SPLIT: two sessions bytes-only, two decode slots of either form; its choices named in lab/delivery/README.md.
Mutants, each run: flip-level, no-clamp (45 of 50), canvas-readback stop; fit-ignored judge refuses; escaped VOID; k3-from-a refused; split-view-only pilot refuses.
Smoke, one load each, CLEAN: FIT b1 fill 2.76 s (pred 2.72), zoom 0.25 s (0.20); FIT a1 6.29 s; SPLIT b1 5.60 s x 0.29 beside A 5.98 s.
Found: the product's OpenJPH build has no decodeSubResolution (the package decodes the level); level decode ×0.49 of whole here, not A2.7's ×0.29 (3 loads; the run's K2 decides).
Gate: --quick green at 854372707 (399 s); docker daemon absent, so the decoders' rebuild skipped; the absence checks run by hand, green.
Fixtures and limits: dbts_a1, dbts_b1 (HTJ2K) and dbts_b1's Q8 G8 view; one 4-core container, no GPU, software decode, headless Chromium 153; TUN relay ≤ 90 Mbit/s; viewport assumed. Nothing is a result.
