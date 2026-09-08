# Working rules for this repository

A WebTransport PACS server: `server/` is the product, `lab/` measures it, `docs/` is where
every number and every reason lives. `README.md` runs it.

## Code

**Essentialist and self-documenting.** Readers run junior to senior. At equal functionality
and no other trade-off, the simpler code wins.

**Do not build for a future that may not arrive.** A speculative abstraction is a cost paid
now against a benefit that may never be collected. Build the shape the measurement asks for,
and no more of it.

**Propose before implementing when the change is structural.** Designs are reviewed.

## Comments

A comment carries only what a reader needs *at that line* to avoid writing a bug:

* a `SAFETY` contract,
* an invariant the types do not enforce,
* a one-line pointer to the document that explains why.

Everything else — numbers, rationale, measurement narrative, the history of what was tried —
belongs in `docs/`, where it can be corrected without touching code. A name that needs a
sentence should be a better name; a function that needs a paragraph is probably two functions.

`scripts/comment_budget.sh` enforces this at **0.25 comment lines per code line** per file,
with a floor of 12 lines so a small file can still carry a header. It runs in
`scripts/gate.sh`. Going over is a signal about the code, not a reason to raise the budget.

## Docs

Lean, and placed where they belong — extend the file that owns the subject rather than adding
one per finding. A claim that is not measured says so. A retracted claim is corrected in
place, not quietly dropped: `docs/disk-access/HANDOFF.md` §3 is the model.

## Measurement

The rules below have each already produced a wrong answer here when broken.
`docs/disk-access/HANDOFF.md` §6 has the full list and the evidence.

* **Interleave the arms.** Sequential before/after measured +8.1% on code that was a tie.
* **Mutate every new test** — break the code on purpose and watch the test fail.
* **Page-cache eviction is not a test lever.** Force the miss through the store's test levers.
* **Quote latency or throughput, not both** — one is the other divided by depth.
* **Say where the host saturates and claim nothing past it.**

## Before pushing

```bash
scripts/gate.sh          # client bundles, type-check, server tests, absence checks
scripts/gate.sh --quick  # skip the two absence checks
```
