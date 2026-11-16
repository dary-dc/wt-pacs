
## Clean (UNIFIED-CLEAN, 2026-11-16)

These are the mechanical items of the plan's §6 and of `claude/work-ledger:docs/queue/COMPLEXITY-AUDIT-report.md`, each in its own commit. Nothing was removed, because removals wait for the owner's yes. It is owed UNIFIED-CLEAN-REVIEW, by a session that wrote none of it. The logs are in `claude/work-ledger:docs/queue/UNIFIED-CLEAN/`.

| commit | what | source |
| --- | --- | --- |
| `5f853f89` | `scripts/gate.sh`: drops step "M5's rule on made-up rows", which ran nothing after `13f1edb7` | audit 3 |
| `bd0863f1` | the owner's first name replaced in `docs/video-containers/README.md:228` and `docs/reviews/pre-main.md:89` | audit 2, the two docs (`handoff/` waits for the owner) |
| `7805fb9e` | `docs/glossary.md`: *optimal quality* is the one name. *lossy stream* is marked as its earlier name, and *quality profile* points at it (role-based profiles are still open, `docs/av1/README.md` §Open questions). `window-q.md` and `noise-ratio.md` follow | audit 4, plan §6.5 |
| `08f10482` | `docs/lines/README.md`: the index's dates now match the files, and `plan.md` and `proposals.md` are named as not lines (what of `proposals.md` the client evidence holds). Coordination Open 8 updated | audit 8, plan §6.5 (the index only) |
| `8af63c6e` | **gate: line-hygiene's `deploy/server_notices.py --check` step put back. B4 dropped it.** Mutants: one notices line deleted fails; one `Cargo.lock` version changed fails | plan §6.1 |
| `ce06e946` | **gate: every `series-server` test under `lab-levers` again, unfiltered, as line-hygiene ran them. B4 took the tip's filter, which left `an_ask_during_a_fill_waits_behind_no_more_than_the_send_window` unrun.** Mutant `server.rs:166` (`send_window_follows_cwnd` never read): the filtered line passes, the unfiltered one fails that test | plan §6.4 |
| `1aaa075f` | coordination Open 8 | line doc |

**Correction to §Review (b), in place:** B4's gate is not only "the tip's plus nine added files". `scripts/gate.sh` lost two of line-hygiene's checks, which the last two gate commits above put back. This is the same class as the B2 blocker, and neither review caught it. A comparison of every `run` line of the eight source gates against this one now finds no line missing (each other difference is a superset).

**Checked, nothing to commit:** `Cargo.lock` is `--locked` clean; the notices are current (164 crates); the decoder builds match `manifest.sha256` (the gate rebuilds them); every lever is behind `lab-levers`; the comment budget is ok.

**Not done here:**
* the PACS line's two study-DB schemas (audit 1, a fix whose schema choice is the PACS line's);
* the two group-file readers and the lever field pairs (audit 5, 6; proposals);
* `handoff/` and `lab/`'s growth (audit 2, 7; the owner's yes);
* turning `codecs.md`, `metadata.md` and `viewer.md` into work state as PR 384 did for the client's three (a docs move larger than a mechanical cleaning).

**Gate** at `ce06e946`: **OK in 795 s, 58 steps** (one empty step removed, one restored). One skip: the viewer's cross-codec arm and Firefox. It ran after README's cloud lines, with wasm-pack 0.15.0, the decoders and their vendor, the transport clients, `ingest/tools.sh`, the `.venv`, and lavapipe, Xvfb, xdotool and nginx. The last commit touches only a line doc.

**`demo-check.mjs`** on `dbts_a1-q8-g8-cut`: **passed, page and worker**. The bundles are 67,815,143 and 4,642,293 B, the baseline's sizes.

**Fixtures and limits.** The gate used the repository's committed fixtures. The demo check used `dbts_a1` alone. The host was one 4-core cloud host with no GPU, headless Chromium and no Firefox. The duration comes from one run on a shared host and is not a measurement.
