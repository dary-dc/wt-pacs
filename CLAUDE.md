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

## Names

**A name states its role in the domain's words.** No word from the project's history — a queue row, a campaign
label, a numbered lever — and none that a standard the code touches uses for something else (DICOM's Item; ARM).
One concept, one name, defined once in [`docs/glossary.md`](docs/glossary.md).

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

`scripts/comment_budget.sh` enforces **0.18 comment lines per code line** per file (Rust, TypeScript, JavaScript, shell and Python), floor 10,
counting neither `SAFETY` blocks nor anything from `mod tests {` down. It runs in
`scripts/gate.sh`. The product sits at 0.10–0.18; going over is a signal about the code, not
a reason to raise the budget.

## Docs

Lean, and placed where they belong — extend the file that owns the subject rather than adding
one per finding. A claim that is not measured says so. A retracted claim is corrected in
place, not quietly dropped: `docs/adr/disk-access.md` §2 is the model.

**Each subject has one home, `docs/<subject>/`** (the client's is [`docs/client/`](docs/client/design.md)):

* **`design.md`** — the current design only, rewritten in place and never appended to, about three screens: *What it
  is* (one diagram, the components and who owns what), *Rules* (the invariants, one line each), *Decided* (the
  choice, the date, whose, a link to its evidence), *Open* (each question's options, what theory predicts for each,
  what decides it, the evidence so far with its scope).
* **`design.html`** — the same design drawn; it holds no claim `design.md` or the evidence does not.
* **`evidence/<question>.md`** — one file per question researched or measured, named by the question: the sources or
  the pre-registered protocol (dated, by whom), the results with their fixtures and where the host saturates, the
  verdict with its scope, a link to the raw rows. Theory and measured are labelled. A rerun adds a dated section.
* **`docs/lines/<line>.md`** — the work only: the goal in one line, what is in flight, PRs, owed runs, pointers. No
  design, no results.

**Keeping it true.** A result lands in its evidence file and, in the same commit, changes the one line of
`design.md` it moves and the page's box if one changes. A decision moves its question from *Open* to *Decided*.
Queue-row, campaign and lever names stay in the work ledger and never appear in `docs/` (§Names).

## Measurement

The rules below have each already produced a wrong answer here when broken.

* **Interleave the variants.** Sequential before/after measured +8.1% on code that was a tie.
* **Mutate every new test** — break the code on purpose and watch the test fail.
* **Page-cache eviction is not a test lever.** Force the miss through the store's test levers.
* **Quote latency or throughput, not both** — one is the other divided by depth.
* **Say where the host saturates and claim nothing past it.**
* **Choose between candidates so none loses to its build.** Survey with sources; eliminate only on a sourced hard
  constraint; write a best-effort design per survivor before building; an advocate per survivor, from a session that
  wrote none of them, fixes it before any run; a session that builds nothing pre-registers the protocol; run, give the
  verdict with its scope, and re-check each loser once for losing to its implementation. Worked example:
  `docs/client/evidence/cache-plan.md` (#385, at `7c180630`).

## Agents

Read [`docs/agents/`](docs/agents/README.md) before any work.

## Before pushing

```bash
scripts/gate.sh          # client bundles, type-check, server tests, decoders rebuilt, absence checks
scripts/gate.sh --quick  # skip the decoders' rebuild (docker) and the three absence checks
scripts/gate.sh --no-browser  # skip the browser steps, and say so
```
