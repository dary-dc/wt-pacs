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

**Write none, then add back only what a reader needs at that line to avoid writing a bug:**

* a `SAFETY` contract,
* an invariant the types do not enforce,
* a unit or a framing constant the type cannot carry,
* a one-line pointer to the document that explains why.

Everything else — numbers, rationale, measurement narrative, the history of what was tried —
belongs in `docs/`, where it can be corrected without touching code. A comment that restates
its function's name is worse than none: it is a second thing to keep true. A name that needs
a sentence should be a better name; a function that needs a paragraph is probably two.

**One line, in the common case.** Two is a smell, three wants a reason. Most of what used to
be a paragraph here is a clause and a `docs/` pointer.

**Tests are the exception.** A test's doc comment states the claim the test makes, which is
worth more than its name alone — those are not counted and should not be cut.

`scripts/comment_budget.sh` enforces **0.18 comment lines per code line** per file, floor 10,
counting neither `SAFETY` blocks nor anything from `mod tests {` down. It runs in
`scripts/gate.sh`. The product sits at 0.10–0.18; going over is a signal about the code, not
a reason to raise the budget.

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
