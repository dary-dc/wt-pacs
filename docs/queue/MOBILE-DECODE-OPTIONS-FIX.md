state: done
started: 2026-11-26T20:17Z
heartbeat: 2026-11-26T20:21Z
outputs: claude/mobile-decode ee0d3c3f9 (docs/decode/mobile/new-options.md §2, §2.1, §3, §5, §8, §Fix; hw-inverted.md §3; docs/lines/client.md); no PR (PR 397's branch)

## Resume

Nothing left. MOBILE-DECODE-OPTIONS-FIX-REVIEW is next, by a session that wrote none of the file, its review or this fix.

## Result

* Docs only; nothing run. Sources re-read 2026-11-26: S8 (Tables 7–9), S4 (H.273 V4 PDF §8.3), S1 §6.4.2, S2 §7.6
  and §9.12, S5 [5.1/H-1-15], S6 at 2026d's own URL and at *current* (2026e); quotations added are verbatim.
* B1: §5's decode bullet leads with Cell D (M: 1.12–1.21× the lossless frame; 2.0–2.5 lossy frames in one
  dav1d-WASM AV1 frame, 1.02–1.55 in one WebCodecs AV1 frame, D); the 0.78 prediction kept below, struck as refuted;
  S8's Tables 7/8 (DEC:CPLEX 143 against 115 at 2 bpp, 0.80×) as the reason. Added caveat: Table 7's 5/3 is the
  irreversible Part-2 kernel, so the source gives the direction only. The phone's lossless HTJ2K decode (2026-11-22)
  noted beside the struck "unmeasured".
* m1: equation 45 covers matrices 1, 4–7, 9, 12 only; identity (0) quoted; AV1 forbids identity at 4:2:0, so the
  hazard is the page's "rgb" override; ingest signals BT.709. Same line in hw-inverted.md §3.
* m2 (T label), m3 (DEC:CPLEX), m4 (2026d pinned), m5 ([5.1/H-1-15], 8 294 400 samples a level-5 size) done.
* check_links: 9 unresolved before and after, none new; the gate not run.
* Fixtures: none run; Cell D's are one cloud host, node 22, one thread, the middle 16 frames of dbts_a1/b1/c1.
* Owner: nothing new.
