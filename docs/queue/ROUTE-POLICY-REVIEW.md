state: done
started: 2026-11-22T22:27Z
heartbeat: 2026-11-22T22:34Z
outputs: PR 397's body §Review: ROUTE-POLICY-REVIEW; claude/mobile-decode d3f6d3892 (docs/lines/client.md)
## Resume
Done. Subject route-policy.md at 75d11fcd4 / 6eb0ac322. No blocker, so no fix rows appended. Next: PHONE-ROUTE-PAGE
(needs this and MOBILE-DECODE-REJUDGE, both done); it carries m1-m5 and re-checks after PHONE-READ-CODE-CHECK.
## Result
Documents review; nothing run. (M) is one premium phone, one home Wi-Fi link, one evening, dbts_b1 and dbts_a1's cut.
* No blocker. §3's rule and goodputs per class, §4.6's split formula and table, §5's fill table and exact-frame
  latencies recompute; S1-S3 match their sha256 pins, quotes verbatim; wire and storage claims hold against WIRE.md
  and payload-format.md. The leaning (view first, the fill reporting the rule's two numbers) stands.
* m1 first picture: the view's one-decoder time is 2.6-4.3x its effective time measured, not 3-4.3; the
  "exact frame first above" upper ends become 146, 1027, 495 Mbit/s (entry, middle, premium).
* m2 dbts_a1's cut is 0.0685 of exact, not 0.0742 (the uncut form): b_V 0.66 Mbit, G_A 40, 63.2 MB; G* unchanged.
* m3 first picture and exact-frame latency not given per policy as ranges (the brief asks).
* m4 PHONE-READ-CODE-CHECK still open; every (M) may be set apart by it.
* m5 the HTJ2K fill factor x1.36 may be the receive path, not decode (moves G_B only).
* Nits: README's +0.01-0.12 % vs payload-format's +0.20-0.23 %; rest 0.22 is (A); 2.7-3.3 cores are two windows;
  the view's 4th decoder's spreads overlap.
