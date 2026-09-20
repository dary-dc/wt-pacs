# Identification sweep — how to find levers nobody has written down

A procedure, not a finding. It was first run on 2026-09-18 and produced
[`improvements/2026-09-18.md`](improvements/2026-09-18.md): 22 candidates in one session, none of
them in any doc on any branch. Repeat it when the queue runs dry, when the target changes, or when
a new constraint is lifted (each of those reopens areas that were closed for a reason that no
longer holds).

The sweep **identifies**. It does not measure, build or design fixes — a finding is a lever, its
evidence, its expected size on the target, and who can run the measurement that decides it.

## Steps

1. **Split the clock from raw runs**, not from the summary table. For each goal (a fill's time to
   all frames; one frame asked on an idle session) say what share each stage holds. A stage that
   is 5 % of the clock cannot be the answer, however large its own ratio looks.
2. **List what the rig's regime hides.** Every measurement so far was taken somewhere; write down
   what that place makes free. For this project: loopback hides every round trip, all loss, slow
   start, buffer depth and outages; a desktop hides compile time, core count and memory; a warm
   profile hides first visits; a warm server hides first opens; one browser hides the others. Each
   hidden dimension is a search area.
3. **Inventory what is documented**, per area, across every live branch — the verdicts and the
   regimes they were reached in. This becomes each investigator's exclusion list. A verdict
   reached in a regime that does not apply to the target is not an exclusion; it is a lead.
4. **Fan out one read-only investigator per area**, in parallel, with the brief below. Areas that
   worked: session-setup round trips; the QUIC library's behaviour on a lossy link, read from its
   source; one ask on an idle session over a real RTT; encode parameters (ingest is ours); WASM
   and worker start-up; decode resources when the link sets the pace; serial fetches from
   navigation to first byte; unused browser-platform features; prior art in comparable systems.
5. **Reconcile conflicts** by sending one investigator the other's claim and asking which cell
   the older result actually measured. Both times this happened the older verdict turned out not
   to cover the cell.
6. **Screen against the goal before anything is ranked.** A candidate stays only if it moves a
   figure the comparison reports, on the comparison's own content, with the final image bit-exact.
   The first run skipped this and queued a fixtures row that moved nothing the comparison reports;
   it cost a cloud row and a documentation trail. A lever may change when bytes arrive or what
   is shown first, never the content.
7. **Rank by effect on the target**, keep the "looked at and dropped" lists so nobody re-looks,
   and record corrections owed to existing docs (`CLAUDE.md`: corrected in place, not dropped).
8. **Persist**: a dated file under `improvements/`, proposed queue rows, and the split between
   what a cloud container, a shaped-link VM, the workstation and a device must each do.

## The brief

Each investigator starts from the same frame. What made the difference, in order: opening with a
**code fact already verified** (file:line) rather than a topic; asking for **library source** to be
read, not its docs; demanding **arithmetic for the size on the target**; the **novelty check**; and
the **dropped list**.

```
AREA: <one hidden dimension>, and why the rig could never have shown it.
START FROM: <what is already verified, with file:line>.
INVESTIGATE: <4–7 numbered questions; name the sources — library source in the cargo registry,
  specs, browser source, engineering write-ups, papers>.
ALREADY DOCUMENTED, DO NOT REPORT: <the exclusion list for this area>.
RULES: read-only — no builds, runs, benchmarks, browsers, servers; write nothing outside the
  scratchpad; no git command that changes state, other branches only through `git show` /
  `git grep <ref>`; private material and its rules as the private handoff states them; generic
  web queries only; the owner's standing constraints, listed.
NOVELTY: grep every live branch's docs before reporting; drop what is documented unless its
  regime does not apply — then say exactly why.
OUTPUT, under 600 words: at most 5 candidates ranked by effect on the target, each with
  mechanism · evidence (file:line or URL, unverified marked) · size with arithmetic · cost
  elsewhere · the deciding measurement and who can run it. End with "looked at and dropped".
```

**Round two (2026-09-19, [`improvements/2026-09-19-sweep.md`](improvements/2026-09-19-sweep.md)).**
Areas that worked once the first round's rows had been measured: the *instrument's own model*
(what the impaired link does that a radio does not); a measured number with no mechanism (read the
library until arithmetic reproduces it); what a dev certificate and a dev static host make free;
the radio's idle states; a second browser engine checked against every dependency and planned
lever; the page half of the clock once the third-party SDK became changeable. Areas that returned
caveats and no lever: decode on phone silicon, a phone's memory ceiling — both need a device, not
a reader. Verify each report's opening code fact yourself before persisting it; one reachability
claim did not survive that check.

## What it cost

Round one: nine investigators, each inheriting the session's context: about 2.2 M tokens and ten
minutes of wall time, plus one reconciliation. Nothing ran on the shared box.

Round two: eleven investigators, **fresh rather than forked** — the frame (project, target,
constraints, rules, exclusions, output) in one shared file, each area's brief in another, a
three-line prompt each — about 1.3 M tokens on cheaper models and ten minutes a wave. A first
attempt at eleven forks-worth of the most capable model exhausted the session's usage limit before
any reported; launch in two waves, highest expected effect first, so a limit costs the tail and
not the head.

## What reopens areas

A sweep's exclusions are only as durable as the constraints behind them. When one is lifted —
a component that could not be changed becomes changeable, a second browser becomes a target, a
device arrives — re-run the areas that constraint had closed, and only those.
