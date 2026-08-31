# L3 / disk-access — essentialist merge plan

> ⚠️ **Evidence under review — see [`docs/l3-disk-access-evidence-review.md`](l3-disk-access-evidence-review.md). Do not prune the harness or the TSVs from `main` until the numbers behind the ADR are re-derived.**

**Date:** 2026-08-31 · **Research branch:** `cursor/l3-executor-stall-bc88` (preserve on remote)  
**Rule:** Same as [`cleanup-plan-2026-08.md`](cleanup-plan-2026-08.md) — *a mechanism with no product role and thick lab-only evidence does not stay on `main`. Git history preserves everything.*

This is the plan for **what lands on `main`**, not execution yet.

---

## 1 · Goal

| | |
| --- | --- |
| **Ship** | Always-touch (L3 v1) disk access in the server + one self-contained ADR; gate only if C1/C2 re-clear it |
| **Preserve** | Full harness + campaign TSVs on the branch **until numbers are re-derived** — then prune for essentialist `main` |
| **Avoid** | Landing ADR tables that cite broken stall_n / asymmetric warm ranking; pruning the only raw record while wrong |

---

## 2 · Branch preservation (clone before reshape)

Do **not** delete or force-push the research branch.

| Step | Action |
| --- | --- |
| 2.1 | Confirm `origin/cursor/l3-executor-stall-bc88` is pushed (tip documents realistic wave) |
| 2.2 | Optional tag for archaeology: `git tag l3-disk-access-research <tip-sha>` on the research branch |
| 2.3 | Merge plan PR uses a **new branch** off `main`, e.g. `cursor/l3-essential-bc88`, containing only the IN list below |
| 2.4 | Research branch stays browsable for TSVs, harness source, and “how we measured it” |

Anyone who needs evidence depth checks out the tag or research branch; `main` carries the decision + product code.

---

## 3 · What lands on `main` (IN)

### Product (required)

| Path | Why |
| --- | --- |
| `server/src/media/frame_store.rs` | `frame_pages_resident`, `touch_frame_pages`, hybrid helpers |
| `server/src/transport/server.rs` | `send_one_frame`: mincore on executor, touch on pool when cold |
| `server/Cargo.toml` | `libc` for `mincore` |

Prefix APIs (`frame_prefix_*`, `pread_frame_prefix`) are **optional on main** — keep only if we expect progressive-serve work soon; otherwise drop from essential merge and leave on research branch.

### Docs (required)

| Path | Why |
| --- | --- |
| `docs/adr-frame-disk-access.md` | Single decision record: context, decision, consequences, alternatives, **explained headline tables** (warm/cold, user trace), follow-ups pointer |

ADR must remain readable **without** opening TSVs. It already embeds the realistic-wave summary; that stays.

### Docs (minimal pointer — pick one)

| Option | Path | Note |
| --- | --- | --- |
| A (preferred) | `docs/disk-access-later.md` | Short: Done table + Still optional (incl. multi-session load test) + Rejected — **no campaign links** |
| B | Fold follow-ups into ADR §Follow-ups only | Delete separate later file on main |

Lane file `docs/lanes/L3-executor-stall.md`: either **one-line “implemented → ADR”** on main or leave unchanged on research branch only.

### Workspace (if cold-page-bench stays on main at all)

| Path | Action |
| --- | --- |
| `lab/cold-page-bench/` | **Revert to pre-L3 extension** on essential merge *or* keep only if E3 floor is still referenced from active lane docs. Default: **revert extensions** — research branch has the extended version. |
| `Cargo.toml` / `Cargo.lock` | Only members/deps needed for what remains |

---

## 4 · What stays in research branch history only (OUT)

Do **not** add these to `main` in the essential merge:

| Category | Paths |
| --- | --- |
| Campaign harness | `lab/disk-access-bench/` (entire crate) |
| Extended L3 bench | `lab/cold-page-bench/` runtime-stall / blocking arms (if reverted on main) |
| Campaign specs & briefs | `docs/disk-access-campaign.md`, `docs/disk-access-team-brief.md`, `docs/disk-access-prior-art.md` |
| Raw measurements | `docs/measurements/r2/DISK_ACCESS_*.md`, `docs/measurements/r2/disk_access_*.tsv`, `docs/measurements/r2/L3_EXECUTOR_STALL.md` |
| Workspace entry | `lab/disk-access-bench` in root `Cargo.toml` |

Research branch tip remains the canonical place to re-run:

```bash
git checkout cursor/l3-executor-stall-bc88
cargo run -p disk-access-bench --release -- --realistic ...
```

---

## 5 · Merge procedure (when approved)

Sequenced like cleanup plan §5 — low risk first.

| Order | Step | Branch |
| --- | --- | --- |
| 1 | Tag research tip (`l3-disk-access-research`) | `cursor/l3-executor-stall-bc88` |
| 2 | `git checkout main && git pull` | `main` |
| 3 | `git checkout -b cursor/l3-essential-bc88` | new |
| 4 | Cherry-pick or copy **only IN files** from research tip (product + ADR + optional later.md) | essential |
| 5 | Revert OUT paths if they came along via merge (ensure disk-access-bench absent, workspace clean) | essential |
| 6 | `cargo test -p exact-server` (and full workspace if cold-page kept) | essential |
| 7 | Open PR: essential → `main`. Body links research branch + tag for evidence | essential |
| 8 | After merge: **leave** `cursor/l3-executor-stall-bc88` on origin; close/update PR #4 with pointer to essential PR | — |

**Do not** squash research branch commits into one mega-commit on main unless we explicitly want a single commit message; cherry-pick of 1–2 product commits + ADR commit is fine.

---

## 6 · Verification checklist (essential PR)

- [ ] `send_one_frame` uses `frame_pages_resident` + conditional `spawn_blocking` touch
- [ ] No `lab/disk-access-bench` in workspace or on disk
- [ ] ADR stands alone (decision + explained tables + follow-ups)
- [ ] `docs/disk-access-later.md` on main includes **multi-session cold-under-load** follow-up
- [ ] Research branch/tag documented in PR description
- [ ] No regression: server tests green

---

## 7 · Follow-ups after essential merge (not blocking)

From [`docs/disk-access-later.md`](disk-access-later.md):

1. **Multi-session load** — concurrent sessions on one runtime; measure *other* sessions’ latency while one goes cold (scale validation).
2. Real study disk confirm (ranking check off overlayfs).
3. `io_uring` lab prototype (learning; low expectation vs hybrid warm path).
4. Dedicated fault thread only if blocking pool contends under product load.

---

## 8 · Open choice before execution

| Question | Default recommendation |
| --- | --- |
| Prefix APIs on main? | **No** — research branch only until progressive serve is planned |
| `cold-page-bench` extensions on main? | **No** — revert; E3 floor doc can cite research branch |
| Keep PR #4 as-is or close after essential PR? | Close #4 with link to essential PR + research tag |

---

## 9 · Net effect on `main`

| | Research branch tip | Essential `main` |
| --- | --- | --- |
| Server | hybrid product path | same |
| ADR | full + evidence links | self-contained |
| Lab | disk-access-bench + extended cold-page | unchanged or reverted cold-page |
| Docs | ~2k lines campaign/prior art/TSV | ~100–150 lines ADR + short later |

Git history on the research branch retains the full measurement story for audit and replay.
