# MERGE-INVENTORY-2: the branches moved since the plan, and the frozen list for stage A

Row MERGE-INVENTORY-2 of `docs/queue-merge-2026-11-15.md` (read only). `origin` re-read at **2026-11-15 12:53 UTC**
(`git fetch origin --prune`); the plan (`docs/queue/MERGE-ALL-PLAN-report.md`) read it at 2026-11-14 23:15. Nothing
merged or pushed but this file and the row's status file. The four `claude/unified-*` tips, `main` and
`line-hygiene` have not moved since the plan.

Method: every branch's patch-unique commit count (`git cherry` against its line's unified tip, as the plan's §2)
compared with the plan's column, and every branch the plan names nowhere; then queue status files for the rows that
own them. Fixtures and limits: one read of `origin`; push times are not visible, so "moved" is a changed count or a
commit after 23:15; test merges of the 11-14 group only, cumulative from today's `unified-client` (not after merges
1–54, so their counts are indicative); no build, no gate.

## 1. What moved or appeared

| branch | PR | tip | plan's count → now | added files the tip lacks | since 23:15 | verdict | why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `docs-client` | #384 | `46b16ad1` | 53 → 57 | 60/60 | `design.html`, `check_links` reads docs/ links (+ test), line doc | merge | DOCS-REVIEW done; DOCS-FIX not started (later pass) |
| `cache-plan` | #385 | `f26a78f0` | 12 → 19 | 17/17 | §7.1–7.5 advocates, §8 protocol | merge | CACHE-PROTOCOL done; CACHE-RUN results come later (later pass) |
| `report-plan` | #388 | `cb1c90d8` | 12 → 19 | 18/18 | §3.3, §3.5 advocates, §7 protocol | merge | REPORT-PROTOCOL done; results later (later pass) |
| `depth8` | #389 | `ddd3ec0e` | 13 → 46 | 32/32 | Stage C rows and §9 | merge | DEPTH8-MEASURE done |
| `oq-ingest` | #321 #390 | `8ea8aba6` | 7 → 8 | 1/1 | OQ-INGEST-REVIEW's item 6 (line doc) | merge | M6: PR 390 merged |
| `phone-protocol` | (#359) | `04797972` | 4 → 8 | 1/1 | `docs/phone-rows/next-round.md`, its review, report cells | merge | PHONE-NEXT-PROTOCOL(-REVIEW) done |
| `hw-probe` | #393 | `af4b6aeb` | 10 → 15 | 22/22 | probe fixes, headless read, review | merge | M9: HW-PROBE-PAGE-REVIEW done; after `docs-client` |
| `phone-rows` | — | `1354e67f` | carried by `fill-split` → 1 commit beyond it | — | `docs/reviews/phone-blind-read` §3 corrected (amendment 11) | merge | after `fill-split` |
| `hw10-routes` | #392 | `b2c10f52` | new | 59/59 | `docs/decode/hardware-10bit.md`, devices line | merge | HW10-ROUTES-REVIEW done; after `docs-client` |
| `cache-arms` | #394 | `5749ae40` | new | 88/88 | `lab/cache-arms`, `docs/reviews/cache-arms.md`, `scripts/gate.sh` | **later pass** | CACHE-FIX running (heartbeat 12:46) |
| `report-arms` | #395 | `d46f5497` | new | 88/88 | `lab/report-arms`, `server/src/transport/server.rs` (+46, `telemetry` feature), `scripts/gate.sh` | **later pass** | REPORT-BUILD-BEACON running (12:42); three builds and the review to come |
| `native-notes` | — | — | absent | — | — | **later pass** | NATIVE-NOTES not started; no branch |
| `work-ledger` | — | — | 783 → 917 | — | the queues | no | M7 |

Unmoved, checked: every other branch of the plan's §2 has the plan's count (`demo-e2e-line` is counted against
`unified-codecs`, its line). `hw-decode`, `link-targets`, `transport-design` are the plan's tips.

## 2. What rides in with a merged branch although its own PR is not merged

Commits of a not-merged branch (M3, M5, M6) that an included branch also carries, not on any unified tip:

* **PR 309 `av1-paint-depth`**: 25 of its 31 come with `av1-lossy-pixel-work` (#307); its `client/paint` change is in
  the other 6. Clean.
* **PR 370 `telemetry-client`**: 13 of 28 come with `fill-split`, `phone-rows`, `hidden-page-decode-beacon` (8 with
  `phone-devtools`): the phone tools and deploy labels (PRs 369, 377). The load report itself is in the other 15. Clean.
* **PR 265 `core-exp2`**: 10 of 24 come with every M2 branch (`core-start2`, `core-busy2`, `core-s7-fixed`,
  `core-clock`, `opfs-*`, `native-*`), among them a product change, `52bfb33a` "Downloader: a late frame of an ended
  run stays wanted", and `6bc85692` (committed decoders), both patch-unique on the tip. M2 resolves code to the tip,
  so MERGE-A-CLIENT takes the tip's `client/transport/*` **also where the merge does not conflict**, and says so.
* **M5, the viewer line**: 6 commits of `line-viewer` come with `cine-no-skip` (M4): viewer behaviour
  (`cb943122` a manual step stops at the ends, `f4543c8d` rotate and flip only on DX and CR, `92361637` keys ignore
  case), the viewer check and `dev-server.py`'s one-write log; patch-unique on the tip. M4 takes the tip's text where
  they conflict, so a non-conflicting hunk lands as a behaviour change: **a question for the owner** (merge them, or
  resolve `cine-no-skip`'s product files to the tip like M2).
* **For MERGE-B**: `report-arms` adds a `record::link` hook to `server/src/transport/server.rs` under `telemetry`;
  when it arrives (later pass) it is a fourth input to §5's written resolution.

## 3. The order, amended

The plan's §3 per line with the calls applied: M1 lineage first, each `-s ours`; M3's two (`wip-276`, `wip-253`),
M6's not-merged (`av1-paint-depth`, `core-exp2`, `oq-integrity-build`, `telemetry-client`, `demo-network`,
`lossless-under-loss`), M5's viewer, M7's ledger and the plan's "no" list left out. Client: `phone-rows` after
`fill-split`; **`docs-client` before every branch built on it**, then `link-targets`, `hw-decode`, `cache-plan`,
`report-plan`, `depth8`, `hw10-routes`, `oq-ingest`, `transport-design`, `hw-probe` (M9).

Test merges of that tail, cumulative from today's `unified-client`: `docs-client` clean; `link-targets` 1 file
(`docs/client/design.md`); `hw-decode` 3 (`docs/client/design.md`, `docs/decode/hardware.md`, `docs/lines/client.md`);
`cache-plan` 1 (`docs/lines/client.md`); `oq-ingest` 1 (`docs/lines/optimal-quality.md`); `report-plan`, `depth8`,
`hw10-routes`, `transport-design`, `hw-probe` clean. Docs only, one hunk each. (`phone-rows` alone conflicts in 5 files
from its `fill-split` base, which merges first in the chain; after it, one docs commit.)

**Later pass** (after their rows finish, each `--no-ff` on the staging branch then, the same rules): `cache-arms`,
`report-arms`, `native-notes`, and the moved tips of `docs-client` (DOCS-FIX), `cache-plan` and `report-plan`
(results, verdict reviews).

## 4. The frozen list (stage A merges exactly this, at these tips)

Frozen 2026-11-15 12:53 UTC. A branch that moves after this is merged at the tip below; its later commits are the
later pass's.

#### A1 codecs → `claude/merge-a-codecs` (from `unified-codecs` `9c050c073b`)

| # | branch | tip | merge |
| --- | --- | --- | --- |
| 1 | `av1-unified` | `e8f63746fb` | -s ours (M1) |
| 2 | `av1` | `69bed59ac4` | -s ours (M1) |
| 3 | `wip-dockerread` | `cd5901551d` | -s ours (M1) |
| 4 | `wip-213-INTERSLICE` | `b77d1d04f7` | -s ours (M1) |
| 5 | `av1-mainbase` | `1348bc06b3` | -s ours (M1) |
| 6 | `video-containers-research-ed5fg2` | `454edac429` | --no-ff |
| 7 | `av1-visually-lossless` | `95357d8348` | --no-ff |
| 8 | `av1-top10-why` | `c2b1c954ae` | --no-ff |
| 9 | `av1-preview-depth` | `a52fdd8823` | --no-ff |
| 10 | `av1-quality-profiles` | `1232918df3` | --no-ff |
| 11 | `av1-split-preview-b` | `3a96a8d87a` | --no-ff |
| 12 | `av1-profile-carriers` | `339e4fcca9` | --no-ff |
| 13 | `av1-preview-noise` | `b2b3df0597` | --no-ff |
| 14 | `av1-vl-metrics` | `b86628d629` | --no-ff |
| 15 | `av1-window-q` | `bb762be567` | --no-ff |
| 16 | `av1-noise-ratio` | `0a9d33ca35` | --no-ff |
| 17 | `av1-groups-settings` | `0e0e58c891` | --no-ff |
| 18 | `av1-svc-preview` | `440481f9f7` | --no-ff |
| 19 | `av1-lossy-pixel-work` | `5705a82907` | --no-ff |
| 20 | `av1-lcevc-lossy` | `196de50c5f` | --no-ff |
| 21 | `htj2k-progressive` | `a7f89db13b` | --no-ff |
| 22 | `av1-grey-path` | `a47b4f02ec` | --no-ff |
| 23 | `us-data-search` | `5b636f235c` | --no-ff |
| 24 | `av1-top-first` | `c2830266a2` | --no-ff |
| 25 | `av1-webcodecs-profiles` | `87640e5dd8` | --no-ff |
| 26 | `av1-residual-exact` | `6c6cfb44e1` | --no-ff |
| 27 | `av1-audit-quality` | `8d84867338` | --no-ff |
| 28 | `av1-encoder-settings` | `feeaaee6b1` | --no-ff |
| 29 | `av1-audit-decode` | `ea329b5479` | --no-ff |
| 30 | `av1-noise-ratio-line` | `386e35f5bc` | --no-ff |
| 31 | `browser-decoding` | `2a86024936` | --no-ff |
| 32 | `audit-measure` | `e5f8fff3d8` | --no-ff |
| 33 | `htj2k-tiles` | `13d62d2675` | --no-ff |
| 34 | `demo-e2e-line` | `18ea347163` | --no-ff |

#### A2 server → `claude/merge-a-server` (from `unified-server` `b9abdc290f`)

| # | branch | tip | merge |
| --- | --- | --- | --- |
| 1 | `ccr-10b47d42-tr6zpv` | `543afcd2a3` | -s ours (M1) |
| 2 | `wip-210-ASKTHENFILLMEASURE` | `c09ecf54a4` | -s ours (M1) |
| 3 | `wip-211-ASKFIRSTCAPMEASURE` | `24beba80ae` | -s ours (M1) |
| 4 | `wip-212-CCMEASURE` | `07db7f7063` | -s ours (M1) |
| 5 | `wip-208-DOCKERCLOUD` | `b1a5c82b4a` | -s ours (M1) |
| 6 | `d4-workstation-results` | `e052751336` | --no-ff |
| 7 | `scroll-policies` | `4bc2d5f267` | --no-ff |
| 8 | `deploy-dry-run` | `78974ef21d` | --no-ff |
| 9 | `readmin-cut-stream` | `4019518ad0` | --no-ff |
| 10 | `beeper-ebpf-explore` | `df847a3c1c` | --no-ff |
| 11 | `rootless-podman-and-selinux` | `5ce4f08769` | --no-ff |

#### A4 client → `claude/merge-a-client` (from `unified-client` `e5b20cba8d`)

| # | branch | tip | merge |
| --- | --- | --- | --- |
| 1 | `wip-214-DISPLAYTAGS` | `b3079e9b42` | -s ours (M1) |
| 2 | `wip-215-CLEANAUDIT` | `6cb03d8468` | -s ours (M1) |
| 3 | `onerror` | `ec61fba7d6` | --no-ff |
| 4 | `wip-219-VIEWERASKS` | `3e3e2d9459` | --no-ff |
| 5 | `wip-226-GATEGAPS` | `7fc6741487` | --no-ff |
| 6 | `askjump-measure` | `61a69b2c19` | --no-ff |
| 7 | `telemetry-production-design` | `deb236a3ee` | --no-ff |
| 8 | `coldrtt-hint` | `334214d2e9` | --no-ff |
| 9 | `cine-no-skip` | `440047ff35` | --no-ff |
| 10 | `ask-patterns-map` | `8ffe467437` | --no-ff |
| 11 | `cache-policy` | `680c9b4942` | --no-ff |
| 12 | `opfs-cache-measure` | `38fb59a7b9` | --no-ff |
| 13 | `native-step1-check` | `843a3903c3` | --no-ff |
| 14 | `native-parity` | `02e298ef75` | --no-ff |
| 15 | `native-metrics` | `224ad4e221` | --no-ff |
| 16 | `core-start2` | `a8243eca5e` | --no-ff |
| 17 | `core-busy2` | `3acecc9066` | --no-ff |
| 18 | `opfs-theory` | `c01750b737` | --no-ff |
| 19 | `core-s7-fixed` | `36ae72e007` | --no-ff |
| 20 | `core-clock` | `f36a747b8c` | --no-ff |
| 21 | `opfs-c-shared` | `a6a2701510` | --no-ff |
| 22 | `client-architecture-division-rfri34` | `39714b4c0e` | --no-ff |
| 23 | `core-asking-plan` | `b74ca8c513` | --no-ff |
| 24 | `core-m5b` | `fba512c530` | --no-ff |
| 25 | `plan` | `5b69cd7d9c` | --no-ff |
| 26 | `reviews-2026-11-10` | `c9d882a814` | --no-ff |
| 27 | `oq-integrity` | `39a7bdd35d` | --no-ff |
| 28 | `dav1d-lazy` | `7cf46ef7a7` | --no-ff |
| 29 | `fable-simplify` | `460488d9df` | --no-ff |
| 30 | `reviews-2026-11-11` | `7ab6a3aafc` | --no-ff |
| 31 | `fable-design` | `7946ad7c66` | --no-ff |
| 32 | `reviews-2026-11-13` | `8da33d8ece` | --no-ff |
| 33 | `proposals` | `5b4c334174` | --no-ff |
| 34 | `demo-simplify` | `d70ccb9f98` | --no-ff |
| 35 | `demo-understand` | `3171ee7b39` | --no-ff |
| 36 | `demo-pre-main-review` | `8ecd71b6a1` | --no-ff |
| 37 | `slice-touch` | `afbce9301d` | --no-ff |
| 38 | `demo-review-2` | `af91740159` | --no-ff |
| 39 | `phone-run` | `48f554a6d7` | --no-ff |
| 40 | `phone-protocol` | `04797972fe` | --no-ff |
| 41 | `dataset-hub` | `4200d599ff` | --no-ff |
| 42 | `phone-devtools` | `eb0283449e` | --no-ff |
| 43 | `merge-plan` | `a376221799` | --no-ff |
| 44 | `hidden-page-decode-beacon` | `5137f44960` | --no-ff |
| 45 | `fill-split` | `28810f62c4` | --no-ff |
| 46 | `phone-rows` | `1354e67f31` | --no-ff |
| 47 | `lines-ready` | `96d33ad00e` | --no-ff |
| 48 | `ingest-oq` | `68c15c2a6c` | --no-ff |
| 49 | `lab-off-main` | `3d196b960f` | --no-ff |
| 50 | `direction` | `a6e27ea5b6` | --no-ff |
| 51 | `hostnet-theory` | `8a1f0f596e` | --no-ff |
| 52 | `hidden-page-decode` | `22c68824b8` | --no-ff |
| 53 | `docs-client` | `a4cf8513ff` | --no-ff |
| 54 | `link-targets` | `a3b35708a3` | --no-ff |
| 55 | `hw-decode` | `b631179a56` | --no-ff |
| 56 | `cache-plan` | `f26a78f056` | --no-ff |
| 57 | `report-plan` | `cb1c90d856` | --no-ff |
| 58 | `depth8` | `ddd3ec0ede` | --no-ff |
| 59 | `hw10-routes` | `b2c10f52bc` | --no-ff |
| 60 | `oq-ingest` | `8ea8aba6d8` | --no-ff |
| 61 | `transport-design` | `96a829c887` | --no-ff |
| 62 | `hw-probe` | `af4b6aeb35` | --no-ff |

#### Stage B inputs

| branch | tip |
| --- | --- |
| `unified-pacs` | `7afeb9cac2` |
| `line-hygiene` | `8d5112fd74` |

Counts: codecs 5 `-s ours` + 29; server 5 `-s ours` + 6; client 2 `-s ours` + 60.

Commands:

```bash
git fetch origin --prune
git cherry origin/claude/unified-client origin/claude/<branch> | grep -c '^+'     # §1's counts (codecs: unified-codecs)
N="^origin/claude/unified-client ^origin/claude/unified-codecs ^origin/claude/unified-server"
comm -12 <(git rev-list --no-merges origin/claude/<excluded> $N | sort) \
         <(git rev-list --no-merges origin/claude/<included> $N | sort)        # §2's shared commits
```
