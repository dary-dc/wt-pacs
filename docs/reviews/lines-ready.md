# The line branches against the demo tip (LINES-READY)

Read from `origin` on 2026-11-12, 05:00–06:10 UTC. Findings only: nothing merged, no merge prepared. Every trial
merge below ran in a scratch worktree and was aborted.

* **Demo tip**: `claude/demo-fixes-2` at `18d2d1ff` (FREEZE-E2E's demo commit `157b7109`, then docs only).
  `main` at `017a3ca6`. `claude/core` and `claude/av1-unified-mainbase` are both ancestors of the tip.
* **The line branches** (`claude/line-hygiene` #256, `claude/line-server` #254, `claude/line-pacs` #258,
  `claude/line-viewer` #255, parked) all fork from the tip's history at `ab5f1f2d` and stopped on 2026-10-30; each
  is 412 commits behind the tip.
* **Method.** "Holds" is by patch (`git cherry`), then by content: for each file the branch changed since its merge
  base with the tip, whether the tip has the same blob, left the file untouched, or changed it too. A trial
  `git merge --no-commit --no-ff` of each branch onto the tip names the conflicts. Open PRs are matched by their head
  commit with `git merge-base --is-ancestor`, not by name.
* **Limits.** One read of `origin`. The gate was **not run** on any branch merged onto the tip: none merges cleanly,
  and resolving the conflicts would be preparing a merge. What stands in for it: each line PR's own CI on its
  2026-10-30 head, and the default `series-server` of each branch built and checked for lab sources the way
  `scripts/check_lab_absent.sh` does (§5). Review state is read from PR titles, bases and the queue's status files,
  not from each PR's review threads.

## 1. Summary

| branch | ahead of tip (non-merge) | in tip by patch | trial merge onto tip | own CI, 10-30 head | call |
| --- | --- | --- | --- | --- | --- |
| `line-hygiene` (#256) | 74 (56) | 0 | 29 files conflict | gate, deploy, decoders, arm64 green | product work worth bringing (hygiene), most of it not in the tip |
| `line-server` (#254) | 44 (25) | 0 | 3 files conflict | gate, deploy, decoders green | docs and rows worth bringing; its three server arms are experiments not adopted |
| `line-pacs` (#258) | 233 (161) | 0 | 6 files conflict | gate, decoders green; **deploy red** | product proposals awaiting the owner, labs done; six commits of its PRs missing |
| `line-viewer` (#255) | 16 (11) | 0 | 6 files conflict | gate, deploy, decoders green | product work for a paused line; stays parked |

No line branch is superseded as a whole, and none merges onto the tip without conflict resolution.

## 2. `claude/line-hygiene` (#256): product work, the hygiene line

Of the 132 files it changes, 48 the tip changed too, 1 is identical, 1 the tip moved away
(its `check-page.js`, now `lab/viewer/check-page.js`), and 82 the tip never touched. The conflicts sit
where the demo rewrote: `client/viewer/*`, `client/transport/{consumer,downloader}.js`, `server/src/transport/*`,
`server/dev-server.py`, `deploy/{Containerfile,README.md,compose.yml,nginx/*}`, `scripts/gate.sh`,
`docs/{ARCHITECTURE,glossary}.md`.

**Worth bringing (not in the tip), by the PR it carries:**

* #112, tests out of the product files: 20 `foo/tests.rs` files in `server/`, `common/`, `ingest/`; the tip still
  has 16 server files with an inline `mod tests {` and no `tests.rs`. Server line.
* #131, licence notices: `claude/line-hygiene:deploy/THIRD_PARTY_NOTICES`, `claude/line-hygiene:deploy/server_notices.py`,
  `claude/line-hygiene:deploy/licence-texts/`, the
  patched quinn crates' licences; none is in the tip. Deploy.
* #117, `claude/line-hygiene:deploy/build-arm64.sh` and its CI job; not in the tip.
* #213, `uring_reader` registers its fd through `AsyncFd::register_with_interest`, and server tests hand the
  fixture's bound sockets over; the tip's `uring_reader.rs` is unchanged since the fork, so the fix is absent.
* #200 and #202, the fifth audit round's safe-now items: V3 (one `.dockerignore`; the tip still has
  `.containerignore` and `deploy/Containerfile.dockerignore`), V9 (`WebTransportCloseInfo` through its typed
  getters; the tip still reads `closeCode` with `Reflect::get`), V10 (one `refuse`, exported by `av1-payload.js`;
  the tip's `av1-frame.js` still defines its own), V13, V7 and the doc items. Client and server lines.
* #116, no series opened by default: the tip's `deploy/compose.yml` still defaults `SERIES` to `us_cine_smoke`. A
  default on the product path, so the owner's call once the demo no longer needs it.
* #114 and #115: the page names its client and transport; the deploy README's cores and host nginx. They conflict
  with the demo's `head.js` and `deploy/README.md`; whether the tip already does the same is decided at the merge.

**Superseded in the tip:** V8 (`#failAll` inlined; the tip has no `#failAll`). The lab-levers split (13b6c53d) is
partly done in the tip by `f866da46` and CLEAN-PRODUCT; the merge keeps the stricter of the two.

**Waiting for the owner, not a merge question:** V1, the seven answered `lab/` directories. The branch removed them
(`06bfb17b`) and then put them back (`7feddb5b`) until the owner confirms; they are still in the tip.

**Cleaning rule:** nothing on the branch adds lab code to a product module; its changes move toward the rule.
`docs/merge-readiness.md` rounds 4 and 5 are docs the hygiene line owns.

## 3. `claude/line-server` (#254): docs worth bringing, three arms not adopted

33 files: 13 added, all under `lab/`; 20 changed, 7 of which the tip changed too (`server/README.md`,
`server/src/main.rs`, `server/src/transport/{lab_levers,server}.rs`, `scripts/gate.sh`, `docs/av1/queue.md`,
`docs/merge-readiness.md`). The tip never touched `server/src/media/read_path.rs` or
`server/src/transport/pipeline.rs`, which this branch changes.

* **Worth bringing, docs and rows (the server and transport results):** the congestion-controller and disk-scaling
  designs (#122, #123), TAILPING's theory (#137), PGO through the relay, held (#139), the GSO cap decided (#140),
  the 100 ms initial RTT proposal (#41, "do not merge yet"), rows 258–260 recorded in `docs/adr/disk-access.md` §9,
  `docs/levers.md`, `docs/transport/transport-conclusions.md`.
* **Experiments not adopted:** row 259's T1 (`TileReader::advising_past_slots`, `--advise-tile-names`, threaded
  through `ProductPipeline::new` as a `bool`), row 260's Wf (`FillReader::windowing_two_frames`), and row 258's G1
  and G2 in `read_path.rs` (built, "not measured" in `7454031b`). T1 and Wf were measured and not adopted (#102,
  #103). All three sit in product modules: bringing them breaks the cleaning rule (`coordination.md` §Decisions,
  2026-11-04 as corrected). Leave them in history; `lab/scripts/exec_gap.sh`, `tile_advice_ab.py`,
  `readahead.py` and `lab/pgo-relay/` go with them unless a line still runs them (none of the line files names one).
* **Not on the branch, server work by title:** #96 (one queue as product code, candidate, not adopted), #37, #39,
  #40 (proposals, do not merge), #130 (D4's workstation round), #136 (`readMin`), #138 (ASKJUMP, unresolved). None
  is in the tip.

## 4. `claude/line-pacs` (#258): proposals awaiting the owner

289 files: 252 added, 20 changed that the tip never touched, 17 the tip changed too. The trial merge conflicts in `Cargo.toml`,
`Cargo.lock`, `.gitignore`, `docs/adr/README.md`, `server/src/transport/{server,websocket}.rs`.

* **Product work, proposed, for the PACS line:** `claude/line-pacs:ingest/receiver` (#163), `carrier` and `carrier/sender` (#164,
  #177), `claude/line-pacs:common/from-disk`, `claude/line-pacs:common/study-db`,
  `claude/line-pacs:tools/pacs-verify` (#160), and serve-by-UID (#162:
  `claude/line-pacs:server/src/media/series_tree.rs`, `server.rs`, `websocket.rs`, the client sessions and the contract). All six
  crates become default workspace members. The PR says "not for merge yet", and `metadata.md` §Open 3 lists the
  owner decisions they wait on (hash column, reply, carrier, study-DB layout, viewer metadata, DB engine, study
  index, serving defaults, verdict travel). Serve-by-UID changes the serving path, and its `<Study>/<Series>.sbnd`
  is provisional until the disk layout (#152) is decided.
* **Labs, done:** `lab/{metadata-store,study-index,metadata-delivery,late-frame,disk-tree,tail-rewrite,
  sqlite-engine}`, with their rows. The owner's 2026-10-29 decision ("organize and evaluate from the research done,
  no new investigations") means none is in use by a running measurement. `lab/metadata-store` becomes a workspace
  member, so the image's workspace stage copies it as well (the same cost as experiments-off item 16).
* **Missing from the branch**, confirmed by patch: one or two commits each on #230 (`fd09d307`, `9c6d378a`), #233
  (`1617855c`), #234 (`d4a7f500`), #167 (`254edc68`) and #168 (`bddb09a8`). In every case the PR's file is newer
  than `line-pacs`'s. `metadata.md` §Open 6 says the same.
* **CI:** `deploy` failed on #258's 10-30 head; the log was not read here.
* **Cleaning rule:** no product crate depends on a lab crate (`git grep` over every manifest outside `lab/`); the
  default build's lab sources are in §5.

## 5. The default build's lab sources, per branch

`scripts/check_lab_absent.sh`'s build step, run on each branch's own tree (it cannot run whole: the branches have no
`deploy/web-files.sh`). The Containerfile check gives the same answer on all four and on the tip: only the
`workspace` build stage copies `lab/` crates, which the rule allows.

Running when this was first pushed; the rows follow once each build lands.

## 6. `claude/line-viewer` (#255): parked

10 files: the viewer's requirements (`claude/line-viewer:docs/viewer/requirements.md`; #193), the requirement fixes (#210)
and viewer A's step 1, the 1:1 mode (#215). The trial merge conflicts in `client/viewer/{viewer.js,check.mjs,
run_check.sh}`, `client/README.md`, `server/dev-server.py`, and the tip moved `check-page.js` under `lab/viewer/`.
Not on it: #297 and #300 (the seam inside Cornerstone3D), #251 (the cine never skips), #214 (a throwaway spike).
Product work for the viewer line, which is paused: it stays parked, with no unified branch.

## 7. One line, one branch, one doc

| line doc | unified branch | built from | its product work not in the tip (review state) |
| --- | --- | --- | --- |
| `client.md`, `optimal-quality.md` | `claude/unified-client` | the demo tip after FREEZE-E2E (into `claude/core`) | CLEAN-2 and NAMES-1, last, each its own merge (review rows in the two-week queue). The `claude/core` drafts not in the tip, #260–#267, #273, #275–#276, #294, #296, #301, #303, are runs and harnesses whose decisions #289's fold (in the tip) recorded; #303's `onePass` was retired by CLEAN-PRODUCT. #133 is the same decoders commit as #260. #285, #259, #249 (the frame clock, item 11, the owner's), #204/#197/#187/#207 (the OPFS cache chain), #203, #208, #135 are measurements or designs, unreviewed as product. #368, #369, #370 stay separate PRs. |
| `native.md` | none of its own: rides `claude/unified-client` | — | #277 (parity) and #278 (window timed), on the 10-30 fold, unreviewed; #211, a lab check. `client/native` is already in the tip. |
| `codecs.md`, AV1 and HTJ2K | `claude/unified-codecs` | `claude/av1-unified-mainbase` (an ancestor of the tip, so it carries only what the tip lacks) | Almost none: the 30-odd open AV1 and HTJ2K PRs are theory, protocols and audits. Product files in #309 (paint depth, behind a flag, lab) and one file each in #306, #314, #316. #357 (the audits' corrections) and #350, #335, #340, #347 (line docs). |
| `codecs.md`, server and transport | `claude/unified-server` | `claude/line-server` | §3's docs and rows; not its three arms. No line doc of its own: proposed, a `server.md` line file split out of `codecs.md` §State (*Server and transport*), for DIRECTION-CODECS to say yes or no. |
| none | `claude/unified-hygiene` | `claude/line-hygiene` | §2's list. No line doc: proposed, the hygiene line kept in `coordination.md` §Unification (steps 3 and 4 are its work), or a `hygiene.md` line file if the owner wants one. #129 (deploy dry run) says "not to merge". |
| `metadata.md` | `claude/unified-pacs` | `claude/line-pacs` | #168, #167, #230, #233, #234 (their missing commits, §4). Reviewed only as theory; the crates are proposals awaiting the owner. |
| `viewer.md` | none: `claude/line-viewer` stays parked | — | #297, #300, #251 |
| `coordination.md` | none (process) | — | #257, #217, #205 ("not to merge" records), #338 (the plan) |

PRs outside every line's product work: #358, #366 (proposals, docs), #359, #372 (phone and network docs on the demo
tip), #339 (browser decoding reference), #219, #224 (ask patterns), #313 (the ultrasound data search).

## 8. For the owner

* Whether `unified-server` and `unified-hygiene` get line docs of their own (§7), or live in `codecs.md` and
  `coordination.md` as now.
* Line-hygiene's V1 (the seven answered `lab/` directories) and #116 (no series opened by default).
* Line-server's three arms: left in history, as §3 proposes, or kept behind `lab-levers` if a line still wants them.
* Line-pacs: its crates stay proposals until `metadata.md` §Open 3 is decided; the UNIFY-PACS branch only assembles.
