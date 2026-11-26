# How many bytes is the optimal-quality series, against its exact series?

**Question:** what fraction of the exact series' bytes does the client fetch for the optimal-quality series, at the
demo's Q and at the Q the noise rule would pick? It is an input to the delivery comparison
([`../design.md`](../design.md) §Open, *The delivery comparison*).

*Folded 2026-11-14 from: the demo's bytes as measured (`scripts/demo-series.sh`, tables in
[`../../av1/payload-format.md`](../../av1/payload-format.md) §Optimal quality and §Depth cut, and their summary in
`claude/direction:docs/lines/optimal-quality.md` §2 *Bytes, measured*, `b50be346`); and the bytes at the noise rule's
Q (`claude/docs-lines-3:docs/lines/optimal-quality.md` §What the harvest changes, `14ad30c3`;
`claude/av1-corrections:docs/av1/corrections.md` §1 and §6, `2e4efdfc`).*

## Results

*Measured* (`scripts/demo-series.sh`, 2026-11-09 and 2026-11-10, a 4-core x86-64 cloud host, the same to the byte
across runs), each `.sbnd` against its exact (HTJ2K) series' at G 1, 8 and 16; fixtures `dbts_a1`, `dbts_b1`,
`dbts_c1` of one dataset (56, 50, 69 frames; 12, 10, 12 bits):

| series | form the demo codes | Q 8 | Q 24 |
| --- | --- | --- | --- |
| `dbts_a1` | the depth cut | 0.0685–0.0687 | 0.0030–0.0064 |
| `dbts_b1` | its own 10 bits | 0.216–0.219 | 0.0152–0.0246 |
| `dbts_c1` | the depth cut | 0.088–0.090 | 0.0037–0.0081 |

So "about 0.07–0.22 at Q 8" is this table rounded. The 12-bit stored form is 0.0740–0.0742 (`dbts_a1`) and
0.0947–0.0959 (`dbts_c1`) at Q 8: the cut is 6–8 % fewer bytes there, and 1.12–1.28× the stored form's at Q 24. The
bytes say nothing of quality.

*Derived* (the harvest, 2026-11-10): Q 8 is the noise rule's Q on only two of the six timed (series, G) cells
([`which-quality-is-visually-lossless.md`](which-quality-is-visually-lossless.md)). At the rule's Q the
optimal-quality series is **0.10–0.28 of HTJ2K's bytes**, so the view plus a whole exact series is 1.10–1.28× the exact
series alone. The rule's separate G > 1 value makes G 16 cost 2.2–3.0× G 1's bytes on `dbts_b1` and `dbts_c1` (rule Q
12 · 8 and 8 · 4; 0.101 · 0.216 and 0.096 · 0.284 of HTJ2K); one value over G 1 and G 16 is owed.

*Corrected 2026-11-11 (audit):* "G 16 against G 1: at Q 8, 1.2 % fewer bytes" is an equal-Q reading, not equal
quality; Q 8 is the rung below a 2.4–4.2× byte cliff (corrected in place in `payload-format.md` §Optimal quality).

## Verdict, with its scope

Three DBT volumes of one dataset, one host. At the demo's Q 8 the client fetches 0.07–0.22 of the exact series'
bytes; at the noise rule's Q, 0.10–0.28 (*derived*). Which Q the product codes is the codecs line's and the PCS's.
