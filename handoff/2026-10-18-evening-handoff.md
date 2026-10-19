# Handoff, wt-pacs, 2026-10-18 evening (~20:00 UTC)

For whoever orchestrates this work next. It supersedes [`2026-10-18-handoff.md`](2026-10-18-handoff.md); that file and
[`2026-10-17-handoff.md`](2026-10-17-handoff.md) stay as history (the latter holds the rules' long form). The decision
table is [`review-2026-10-16.md`](review-2026-10-16.md), one row per open PR or decision. The owner's direction is
[`targets-2026-10.md`](targets-2026-10.md). Re-check everything below live before acting: branches move.

## 0. Tomorrow's focus (Darian, 2026-10-18): metadata and the Turso integration

The next point, ahead of the rest. Today the page fetches one JSON file, `/series/metadata` (`client/viewer/head.js:9`),
served by the web host (nginx in the deploy, `server/dev-server.py` in development); the server reads no metadata.
What is already decided or drafted, to build on rather than reopen:
- [`docs/disk-layout/target.md`](../docs/disk-layout/target.md) on unified: no metadata in or beside the `.sbnd`;
  metadata only in the per-study database (Turso), one copy, where it is queried; files at `<StudyUID>/<SeriesUID>.sbnd`.
- [`docs/ingest/design.md`](../docs/ingest/design.md) §5 (d) on unified: one SQLite database per study, built at the
  PACS from the parser's groups (owner, 2026-10-11, so bad data in one study never forces a shared rebuild); the
  catalog compared (PostgreSQL recommended there, MySQL, the libSQL server) with a schema scope.
- `docs/av1/queue.md` (unified) ~line 3236: the catalog choice and its consistency with the study databases, open.

Open, for the session to lay out with him (purpose first, then options with what decides each, per §4 rule 2): who
serves metadata (the web host from the database, or the server); libSQL embedded, the libSQL server or Turso, and the
Rust crate for each and its maturity; the schema for what the viewer needs; how a study database is built, published
and replaced; the catalog and its consistency; what the client fetches and when; how fixtures and the gate move off
the JSON file. Start it as an interactive cloud session for Darian (like T1) that owns its PR; its brief must carry the
PR route of §5.

**State on 2026-10-19 ~15:10 UTC** (the thread is moving to a fresh local session; this orchestrator session ends):
- The cloud design session https://claude.ai/code/session_018FHUo5T2MwfpS8kVRK23MW (`trig_01DmFa5f5aN5bQcyjtUvJziA`)
  wrote the purpose document `docs/ingest/metadata-draft.md` on `claude/metadata-turso` (`1c91704`) and opened **draft
  PR #113** into unified (CI green). Its leanings, none measured: the Rust server serves metadata over HTTP through
  nginx; the page names study and series by UID. The bar it quotes (PORD, measured): the transport file arrived first in
  112/112 visits with 120 KB of metadata, which delayed the connection by 7 ms at 80 ms RTT, 29 ms at 160 ms.
- **Darian's first feedback (15:04 UTC, in that session), to be answered, explaining as you go:** (1) nginx is not a
  reverse proxy for the WebTransport server, so why proxy metadata through it; (2) the SQLite files and the pixels
  should live on the same server so there is no network request: is that realistic, and does it rule out the networked
  options; (3) he needs to understand the database's output (what the viewer gets out of it): a main goal, since that
  is where he can contribute; (4)(5) he does not see the relevance of build/publish/replace and the catalog yet;
  (6) the page fetches only what it needs, growing as client features grow; (7) the database is built on the parsing
  and packing machine, in the PCS ("PACS without A", https://github.com/opendicom/DECK_WebTransport): more bytes over
  an unknown network, but a better separation. His message is cut off in the run log after (7); ask him for the rest.
- The session's own goal for him: **educate**, plain words, mechanism kept (rule 4 below).

**To continue locally:** stop the cloud session first, so two sessions never work `claude/metadata-turso` at once (it
answered his 15:04 message and had a check-in queued, `trig_015JFR7Lw1R8HHgzwm1Dcmbo`, 15:06 UTC). Its full brief is
the routine's prompt (`RemoteTrigger get trig_01DmFa5f5aN5bQcyjtUvJziA`); the same rules hold, except that PRs go
through `handoff/tools/` (§5). Then: `git fetch`, check out `claude/metadata-turso`, read `CLAUDE.md`, the draft, the
PR #113 thread and the cloud session's last reply (`RemoteTrigger get_run_log cse_018FHUo5T2MwfpS8kVRK23MW`), and answer
the seven points above.

**Also open on 2026-10-19:** D4 not rerun yet (no new report in `wt-pacs-d4`, §3); S1 reviews fire Tuesday (§3).
`claude/wip-278-WASMIMAGE` deleted (merged by #99).

## 1. The goal

Darian (owner, GitHub `dary-dc`): unified (`claude/av1-unified-mainbase`) went into `main` on 2026-10-18 (§6);
one open PR per idea, each with a stated reason it is not merged. Since 2026-10-17 a design track: he iterates on
proposals himself, in cloud sessions he can open and talk to.

## 2. Where things are

| What | Where | Head |
|---|---|---|
| `main` | never pushed by an agent; changes only through a PR on Darian's word | `bf6a5b86`: **unified merged in, 2026-10-18** (#104, on his "merge it") |
| **Unified** | `claude/av1-unified-mainbase` | `5625dcf4`: everything below merged; final verification running (§3) |
| Decision table, targets, helpers | `handoff/` on this branch (`claude/project-thread-9uugfm`) | |
| Next-project ideas | `docs/next/ideas.md` on `claude/next-ideas-cdydy8` | `32d17bc9`, no PR |

**Merged into unified on 2026-10-18, each on Darian's word and with CI green on its head:**
- #109 (row 285): two client defects fixed (WASM ask order with `refill: "ask"`; an `onHead` that throws); both latent
  in the default client, which matters now that WASM is a product client.
- #110 (row 286): the WebSocket option-failure defect shown unreachable on Linux; merged as docs only (the code tried
  is `7b3e9bdb`, not kept: a test hook in the accept loop for a case Linux does not produce; Darian's call).
- #108 (rows 284 + 287): the read path's three latent faults fixed; a read-only re-review then found that one fix
  made a ring read error panic (reachable with `uring` on) plus two latent same-class faults; row 287 fixed all three
  on the same branch, each shown by a failing test and mutated.
- #99 (rows 277–278): the WASM client in the product and the deploy image. Unified merged in by hand (`565c676f`: two
  conflicts in `deploy/`, unified's lab moves kept, #99's WASM entries added).
- Merged branches deleted: `wip-280`, `wip-281`, `wip-284`, `wip-285`, `wip-286`. Probe PR #111 closed, branch deleted.
- No open PR is an ancestor of unified (`git merge-base --is-ancestor` and `git cherry` on every open PR, 2026-10-18).

## 3. In flight

**Final verification of unified `5625dcf4`: done, clean** (2026-10-18 19:43 UTC, session
`cse_01MDaUS1a7aL3byhgLdz5qix`). Full `scripts/gate.sh` exit 0 ("GATE OK in 545 s"; perf counts as in the baseline;
refusals 64/64 on ts, wasm and ws; ask-during-fill 3/3 on all six variants); only skip left: the viewer's cross-codec
arm and Firefox (no DICOM bundles, no GL display); `check_equivalence.sh --local` passed separately with nginx
installed. `cargo test --workspace` 224/0, `lab-levers` 139/0, `--no-default-features` builds. No conflict markers,
0 unresolved links, comment budget ok, no personal path, no attribution trailers. **One finding:** merge commit
`31cb948` (2026-10-17, "Merge remote-tracking branch 'origin/claude/av1-unified-mainbase' into wip-270") is authored and
committed by `Claude <noreply@anthropic.com>`; fixing it means rewriting unified's history (a force-push, against the
rules), so it is Darian's call. The other 36 non-`dary-dc` commits are `darian` / `GitHub` web merges of PRs, his own.
CI green on `5625dcf4` (push and PR runs); #104 mergeable, `main` an ancestor of unified (209 commits ahead).

**D4, the workstation run, on Darian's machine** (`~/Desktop/projects/wt-pacs-d4`, unified `85666200` prebuilt). The
2026-10-18 15:06 UTC run (`.local/workstation/report-20261018T150649Z`) finished host and ring, then stopped in the
readers: the lab's ring models (`hybrid_lazyring`, `uring`) register one buffer per slot, and at 250 kB × depth 4 × 16
readers that is ~15.5 MiB against this host's 8 MiB memlock hard limit (reproduced: 8 readers fit at 7 936 KiB, 9 fail
at 8 928 KiB). The product registers no buffers. It also started 3 minutes after boot at load 4.02, so its reader
timings are not used. Results already valid: the fast path PASS; io_uring in podman refused by default seccomp
(`ENOSYS`), by SELinux with our profile (`EACCES`), available with `label=disable`. Darian's rerun, raising memlock for
that one shell only (closing it restores 8 MiB):

```
sudo prlimit --pid $$ --memlock=134217728:134217728 && ulimit -l && cd ~/Desktop/projects/wt-pacs-d4 && until awk '{exit !($1<1)}' /proc/loadavg; do sleep 30; done && lab/scripts/workstation_run.sh --quick
```

On "D4 done": read the new `workstation-<stamp>.tar.gz`; readers' numbers into `docs/adr/disk-access.md` §12, the
io_uring/SELinux result into `deploy/README.md` §Open, on a branch with a PR; then `git worktree remove` the checkout,
`podman rmi wt-pacs-server`, and the directory. Offered, not asked for yet: `workstation_run.sh` checking memlock
before it starts and printing the `prlimit` line.

**T1, test code separated from product logic:** Darian's interactive cloud session
https://claude.ai/code/session_01Jafgu3arZSNF6ULSttdbKJ (`trig_01Hk3LcbnUajHf3gcTqcH3Se`). It owns the thread end to end
(purpose document, his iteration, the steps one at a time, its PR on `claude/test-separation`); only merging stays with
him and the orchestrator. Decided: test-only methods in a separate `#[cfg(test)] impl X` after the product impl; tests
in sibling files, the same layout everywhere. Open there: test-only fields (one per field or one `levers` field), lab
cfg pairs inside product functions, and the lab-only code that ships ungated in the default build
(`send_window_follows_cwnd`, `stall_left`, `PerFrameAsksFirst`, `reply_repeated_initial`, `segmentation_offload`,
`FrameStore::with_index`, `force_pool_reads`; check each before moving).

**S1, five design reviews, Tuesday 2026-10-20** (run once each; each session stays open for Darian):

| UTC | Review | Routine |
|---|---|---|
| 11:00 | An ask during a fill (P2: #96, #39) | `trig_01DNJh7dcVXkmmHDF9AXRNFT` |
| 11:10 | The congestion controller (#37, #40, #41) | `trig_01MfDGZQ3rnTHnHas4hZdjZB` |
| 11:20 | Disk reading efficiency and scaling (#88, D4) | `trig_01H3BXVdZs4z96jU5iWRfJZA` |
| 11:30 | The OPFS client cache | `trig_014xyMFgaV6JkTKBnohCHDNq` |
| 11:40 | A simplification sweep (not T1's scope) | `trig_01SRKtSeySK8rAHz5DszGv6r` |

Each writes a `## Proposed:` section in the doc that owns its subject, on `claude/design-<topic>`, and opens a draft PR.
**Next:** `list_runs` for each after 12:00 UTC; check the PR exists (if one failed, open it with `tools/pr_open.py`);
record it in the decision table. Darian continues in each session; nothing merges without his word.

## 4. Darian's rules (in force)

The long form is in [`2026-10-17-handoff.md`](2026-10-17-handoff.md) §3–4. Added or sharpened on 2026-10-18:
1. **Merges need his explicit word per PR** ("merge #N", or "merge it when done" for a named PR). He has merged nothing
   into `main` yet; that is his.
2. **Direction, not destination** ([`targets-2026-10.md`](targets-2026-10.md)): never ask him to fix targets (sessions
   per host, storage, sizes); gather what he already decided; designs name what decides each choice across a band,
   prefer switchable choices, and state the cost of switching later.
3. **Product logic stays readable:** new test-only code goes outside product functions (one-line seams at most); a fix
   for an unreachable case is recorded, not coded (#110).
4. **Explain before asking, plain words, keep the mechanism**; say what he must do, and that nothing is needed when
   nothing is.
5. Never push `main`, never force-push or rebase a shared branch; author and committer `dary-dc
   <crespoydelgado@gmail.com>`, no trailers. Prefer cloud routines; local jobs `nice -n 19 ionice -c3`, two cores.

## 5. How to work

**Cloud routines** (`RemoteTrigger`): environment `env_01JYTE3P4vcDau65CyvoLc55`, model `claude-opus-5-5`, tools
Bash/Read/Write/Edit/Glob/Grep, source `https://github.com/dary-dc/wt-pacs`; `create` then `run`, or `run_once_at` for a
time. Results through `list_runs` and `get_run_log`; a long final message is cut off in the log, so ask for a report
under 500 words and put detail in commit messages. **Opening a PR from a cloud session, verified 2026-10-18 (probe
#111):** only the GitHub MCP tool `mcp__github__create_pull_request` works (`draft: true`); `gh` fails (`HTTP 403: GitHub
GraphQL is not available from Claude Code sessions`) and a direct REST call is refused by the session's permission
classifier. Say so in any brief that opens a PR. Cloud sessions are not reachable with `SendMessage` from a local
session; a message for one goes through Darian.

**GitHub from the local machine** (no `gh`; the PAT in the git credential store), `handoff/tools/`:
- `pr_open.py HEAD_BRANCH "title" < body.md`: a draft PR into unified.
- `pr_edit.py N`: edit a PR body (stdin: JSON list of `[old, new]`; `""` old appends); strips footers.
- `pr_merge.py N SHA "title"`: mark ready and merge, pinned to `SHA`. Only on his word.
- `ci_wait.py SHA...`: full 40-character SHAs only; polls until gate, deploy and decoders complete.

**Local git:** edit the decision table without a worktree (`GIT_INDEX_FILE=<tmp> git read-tree origin/<branch>`,
`git update-index --cacheinfo`, `git commit-tree`, `git push origin <commit>:refs/heads/<branch>`). A merge with
conflicts goes in a worktree under `~/Desktop/projects/` (never `~/.cache`), removed once pushed; its commit hook needs
`mkdir -p <wt>/.local && ln -s ~/Desktop/projects/wt-pacs/.local/hooks <wt>/.local/hooks` (the term scanner).

## 6. Path to `main`

**Done 2026-10-18 ~20:10 UTC:** the final verification clean (§3); Darian accepted the one authorship finding and said
"merge it"; #104 merged with a merge commit pinned to `5625dcf4` (`bf6a5b86`). From here, unified is the working base
and `main` takes it again through a PR on his word.
