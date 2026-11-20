# How fast a reader scrolls, and whether a display may skip slices

**Question:** At what rate do readers scroll a stack, and may the client skip slices when the link cannot keep up —
the stride that [`../../adr/stride-is-bandwidth-conservation.md`](../../adr/stride-is-bandwidth-conservation.md) chose —
or must every slice be shown?

*Folded 2026-11-14 from the survey of 2026-10-28 (`claude/ask-patterns-map:docs/ARCHITECTURE.md` §Asking for a stack:
what viewers do and its note on the stride ADR, `8ffe4674`; also `claude/ask-patterns-survey`, `07e85830`), and from
`claude/core-asking-plan:docs/adr/asking-policy.md` §1 and §7 question 6 (`eafa90ae`). Source reading only, nothing
measured in this lab. The full survey is [`how-viewers-and-readers-ask.md`](how-viewers-and-readers-ask.md).*

## Sources

| what | source | what it states |
| --- | --- | --- |
| scroll rate, CT | Diaz et al., Med Phys 2015;42(6):2925, lung CT, 3 radiologists ([abstract only](https://pubmed.ncbi.nlm.nih.gov/26127046/)) | "The scrolling speed … at the moment the signal was detected was measured at 25-30 fps"; the readers' own estimate was 5 fps. The only measured slices/s found |
| no skipping, DBT | [IHE RAD TF-2 Rev 23.0](https://www.ihe.net/uploadedFiles/Documents/Radiology/IHE_RAD_TF_Vol2.pdf) §4.16.4.2.2.1.3.9 | "The Image Display shall not skip slices during manual or automatic scrolling"; "if the Image Display is unable to keep up …, then the display will show all slices rather than scrolling faster"; "a maximum scrolling rate of at least 25 frames per second for an entire 5 MP display is desirable" |
| the stride ADR's rate | [`../../adr/stride-is-bandwidth-conservation.md`](../../adr/stride-is-bandwidth-conservation.md) §Decision Outcome, accepted 2026-08-26 | "At 9 slices/second a frame is on screen for 111 ms"; option B, skip frames during fast motion, chosen |

## What follows

* **The 9 slices/s is no source's.** The survey found none for it; the one measured rate, 25–30 slices/s at detection,
  is about three times it. The ADR's argument (a frame that would arrive after the cursor left is not worth sending)
  does not depend on the number, but its worked example does.
* **IHE forbids, for DBT, the skipping the ADR chose.** The ADR's two invariants (the settled frame always fetched, a
  skipped frame re-asked on a later pass) do not meet a rule that every slice be shown while scrolling.
* **The client's later design already follows IHE for cine:** the view worker's cine "never skips a frame"
  ([`view-worker-design.md`](view-worker-design.md) §Target, *Cine*), and the asking-policy proposal has cine and steps
  wait for a held frame ([`what-a-view-asks-for.md`](what-a-view-asks-for.md)). For a manual scroll nothing is decided.

## Verdict

**A contradiction for the owner, not resolved here:** the stride ADR is accepted and chooses skipping; IHE RAD TF-2
(2025) and every later client text (2026-10-28 onward) choose never to skip, at least for DBT. The newer side is the
survey and the asking-policy proposal; neither is an owner decision. The asking-policy proposal's question 6 asks the
owner whether the stride ADR should be corrected in place. Scope: one CT study's rate (abstract only, three readers) and
one profile's DBT rule; no rate for other modalities, nothing measured on a reader.
