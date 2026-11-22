state: done
started: 2026-11-22T21:21Z
heartbeat: 2026-11-22T21:30Z
outputs: `claude/mobile-decode` `6eb0ac322` (`docs/decode/mobile/route-policy.md`; `docs/lines/client.md`); draft PR 397, no new PR
## Resume
Done. Nothing to continue. `75d11fcd4` the file, `6eb0ac322` the policy-to-column mapping and the line doc.
Sources fetched 2026-11-22 and pinned in the file's §9 (three quoted, each with URL, section, revision and sha256;
one read and not quoted, said so). Inputs read at: device-model.md `cf9f0b43`, next-round-results.md `093bd105`
(reviewed and fixed once; PHONE-READ-FIX-REVIEW and PHONE-READ-CODE-CHECK not done), the option files at `78f0a307`,
delivery-comparison.md on `claude/delivery`. Docs only: `scripts/check_links.py` the same 9 unresolved as before
(none in this file), comment budget ok, the gate not run. Next: ROUTE-POLICY-REVIEW (findings in PR 397's body),
then PHONE-ROUTE-PAGE. No row appended; nothing scheduled.
## Result
Theory and sources; nothing built, run or timed. Measured numbers are the 2026-11-22 round's: one premium phone, one
home Wi-Fi link (>= 568-595 Mbit/s), `dbts_b1` and `dbts_a1`'s cut, the view at Q 8 G 8; classes and profiles derived.
* One inequality under every policy: the exact series fills faster than the view when goodput > an exact frame's
  bits / the view's effective decode; both are read from a view fill's first group.
* The threshold: 53-191 Mbit/s entry, 80-419 middle, 220-521 premium (derived); on the round's phone 251-408
  (`dbts_b1`) and 590 (`dbts_a1`): the series is a variable, so a route per phone or per class is wrong for some.
* A class table has no key a page can read; a probe is dominated by the fill's first group. A per-session
  measurement does not conflict with the 2026-11-04 decision's letter; its code-path reason still binds.
* New: a split fill (each group asked in the form that spends the idle resource), arms A and B its ends; up to
  32 % under the better pure route, on one untested assumption. The first picture's threshold (96-264 Mbit/s) is
  below the fill's; the decoder count is the form's. Exact-frame latency missed by 0.10-0.12 s, unexplained.
* Narrows most: cell 1 on a middle-band phone with two fast cores, plus the two forms decoding together.
* Leaning: the view first as today, the fill reporting the rule's two numbers; no default changed, nothing reopened.
* Owner: whether seconds are worth bytes (B bought 1.94 s for 84 MB on `dbts_b1`, 0.24 s for 63 MB on `dbts_a1`);
  the split, as structural; a decoder count per form; unchecked hardware paints.
