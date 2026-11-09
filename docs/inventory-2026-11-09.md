# Inventory of branches and open PRs, 2026-11-09

Temporary: removed once the owner has decided. Read from `origin` after `git fetch --prune` at
2026-11-09 18:10 UTC: **232 remote branches besides `main`, 191 open PRs** (190 drafts; #319 the
only one ready).

**How to read the tables.** *Date* is the tip's commit date. *−b/+a* is behind/ahead of `main`
(`0cf5424a`, 2026-10-26). *In* names the branches whose history contains this tip (`git merge-base
--is-ancestor`); "core+N" means `claude/core` and N other branches. *PR* is the open PR, its base,
and `d` for draft. *Holds* is read from the commits and changed files, not the name. Branch names
drop the `claude/` prefix. Proposed actions: **merge** (into what, after which review), **keep**
(purpose), **archive** (tag `archive/<name>`, one index line, then delete), **delete** (only when
fully merged), **close** (a PR whose head another PR carries). "Unsure" means the evidence does not
settle it.

**Two facts shape every table.**

1. **`av1-unified-mainbase` is the de-facto integration branch.** It is 62 commits ahead of `main`
   and 3 behind (the rustls bump, #184). 65 open PRs have it as their base; the four `line-*`
   branches and `claude/core` all merged it before anything else. Its own product change is small
   (`client/decode/av1*.js`: onePass on by default; a signed 8-bit range fix; `ingest/` two small
   fixes); the rest is `lab/av1` and `docs/`. It merges into `main` cleanly on its own.
2. **On 2026-10-30 the owner had every draft folded into one branch per line:** `core` (#250),
   `line-server` (#254), `line-hygiene` (#256), `line-pacs` (#258), `line-viewer` (#255, paused).
   Each folds its PRs with `--no-ff`, one merge commit each. Most older draft PRs are therefore
   *carried* by a line PR and need closing, not reviewing; a few moved on after the fold and are
   not carried at their tip — those are marked.

No archive index file exists on `main` yet (33 `archive/*` tags do). Where the index line goes is
the owner's choice (unsure; `docs/archive.md` is a candidate).

## Order of merges into `main` (proposed)

```
main ← av1-unified-mainbase ← line-hygiene ← line-server ← core (+#289 ← #299 ← #303, #302) ← line-pacs
                                                                    line-viewer: keep parked
```

Chains as they stand today (branch → base → … → main):

* `core-review2`, `core-asking-plan`, `core-m5b` → `core-fold-2026-11-02` (#289) → `core` (#250) → `main`
* `view-start`, `paint-read`, `native-parity`, `native-metrics` → `core-fold-2026-10-30` (#273) → `core` → `main`
* `core-start2`, `core-busy2`, `core-clock`, `core-s7-fixed`, `opfs-theory`, `opfs-c-shared` → (contain `core-fold-2026-10-30`) → `core` → `main`
* AV1: `av1-noise-point` → `av1-quality-metrics` → `av1-quality-profiles` → `av1-unified-mainbase` → `main`;
  `av1-preview-noise` → `av1-snr-preview` → `av1-profile-carriers` → `av1-svc-preview` → `av1-unified-mainbase`
* PACS: e.g. `sqlite-lock-behaviour` → `sqlite-engine-fair` → `sqlite-engine-eval` → `metadata-update-cost` →
  `metadata-pair-bench` → `metadata-format-survey` → `metadata-turso` → `av1-unified-mainbase`; all carried by `line-pacs` → `main`
* Viewer: `viewer-seam`, `viewer-seam2` → `line-viewer` → `main`; `cine-no-skip`, `viewer-a-step1` → `viewer-requirement-fixes` → `av1-unified-mainbase`

## 1. Main and the integration base

| branch | date | −b/+a | in | PR | holds | proposed action |
| --- | --- | --- | --- | --- | --- | --- |
| `main` | 10-26 | — | — | — | the product, last merge #184 | — |
| `av1-unified-mainbase` | 11-04 | −3/+62 | grey-path, residual-exact, top-first, webcodecs-profiles, us-data-search | none of its own | AV1 decode lab (breakdown, JS passes, merge-free), onePass on by default, LCEVC and complementary-codec notes, viewer docs | **merge into `main` first**, after a review of its 4 client files and 2 ingest files (onePass default, signed-range); everything else is docs/lab. Clean merge onto `main`, tested locally |
| `patch-with-git-apply` | 11-09 | 0/+1 | — | #319 →main, **ready** | `scripts/patch_crate.sh` uses `git apply`; GNU patch no longer needed | **merge** after review; CI decoders and deploy green, gate was running at 18:13 |
| `rustls-advisories-main` | 10-26 | −1/0 | main | — | the commit #184 merged | **delete** (fully merged) |
| `rustls-advisories-mainbase` | 10-26 | −3/+3 | mainbase+95 | — | the same bump on the mainbase line, plus a nightly decoder check | **delete** once mainbase is on `main` (carried) |
| `nightly-xxh3-pin` | 10-21 | −3/+1 | mainbase+133 | — | nightly builds each tree's decoders | **delete** once mainbase is on `main` (carried) |
| `deploy-prebuilt-server` | 10-14 | −213/0 | main | — | merged as #70 | **delete** (fully merged) |
| `lab-out-of-product-2yftz0` | 10-17 | −33/0 | main | — | merged | **delete** (fully merged) |
| `tidy-open-prs-ljtmay` | 10-17 | −64/0 | main | — | merged | **delete** (fully merged) |

## 2. Pre-rebuild history (before MAINBASE, row 150)

`docs/av1/MAINBASE.md` on `main`: `av1-unified` was rebuilt onto `main` and re-authored as
`av1-unified-mainbase`/`av1-mainbase`; "the old tips stay reachable … until the owner has looked".
Git sees these as unmerged because the hashes changed; `docs/av1/queue.md` on `main` records most
of their rows as done on mainbase. None should be merged.

| branch | date | −b/+a | in | PR | holds | proposed action |
| --- | --- | --- | --- | --- | --- | --- |
| `av1` | 10-12 | −407/+1137 | — | — | the old AV1 queue branch, pre-rebuild | **archive**: superseded by `av1-mainbase` (MAINBASE.md) |
| `av1-pre-main` | 10-12 | −407/+1134 | av1 | — | old tip kept for the owner's look | **archive** (same tip line as `av1`) |
| `av1-unified` | 10-11 | −362/+1450 | = pre-main | — | old unified work branch | **archive**: same commit as `av1-unified-pre-main` |
| `av1-unified-pre-main` | 10-11 | −362/+1450 | = av1-unified | — | old tip kept for the owner's look | **archive** |
| `av1-mainbase` | 10-17 | −407/+1419 | — | — | the AV1 queue (`docs/av1/queue.md`) and its rows to 271; queue.md says the queue lives here | **unsure**: keep if the queue is still read from it; else archive. Last commit 10-17 |
| `wip-210-ASKTHENFILLMEASURE` | 10-14 | −327/+1559 | — | — | row 210 measured: window not adopted; queue says "review", not done on mainbase | **archive**; unsure whether row 210's result should first reach `main`'s docs |
| `wip-211-…`, `wip-212-…`, `wip-213-…`, `wip-214-…`, `wip-215-…`, `wip-dockerread` | 10-13/14 | −327/+1556…1568 | — | — | rows 211–215, 195 on the pre-rebuild base; queue.md: each "done … on mainbase" | **archive** |
| `ccr-10b47d42-tr6zpv` | 10-14 | −327/+1538 | — | #37 →mainbase d | 38 400-byte initial window as default (row 181); since adopted through mainbase (queue row 181) | **close #37** (result on `main`; #254 says excluded), **archive** |
| `wip-208-DOCKERCLOUD` | 10-14 | −613/+10 | — | — | row 208's container rows; queue: done on mainbase | **archive** |
| `wip-219-VIEWERASKS`, `wip-226-GATEGAPS` | 10-14 | −578/+2 | — | — | rows 219, 226; queue: done | **archive** |
| `project-thread-9jumbi` | 10-14 | −578/+1 | — | #39 →mainbase d | asks first under 6 MiB as default (row 211, a trade-off, "do not merge") | **close #39**, **archive** (result on `main` via row 211) |
| `project-thread-9jumbi-212` | 10-14 | −578/+1 | — | #40 →mainbase d | cubic-classify as default (row 212, not adopted) | **close #40**, **archive** |
| `project-thread-9jumbi-189` | 10-14 | −578/+2 | line-server | #41 →mainbase d | 100 ms initial RTT as default (row 189) | **close #41** (carried by #254 under its proposal rule) |
| `onerror` | 10-03 | −595/+1 | — | — | downloader: an ask for a frame the fill owes leaves the fill's wanted set | **unsure**: one product commit, not found on `main`; archive unless the owner wants it re-proposed |
| `video-containers-research-ed5fg2` | 10-16 | −327/+4 | — | — | docs/video-containers: MP4, MXF layouts, licence costs | **archive**; `archive/42-video-containers` already exists — unsure if same content |
| `next-ideas-cdydy8` | 10-17 | −65/+2 | — | — | `docs/next/ideas.md`, open investigations | **archive** |
| `project-thread-9uugfm` | 10-21 | −49/+26 | — | — | `handoff/` files of 10-17…10-22 | **archive** |
| `wip-252-ONEQUEUEBUILD` | 10-16 | −86/+2 | wip-253 | — | row 249's candidate 1 built for measurement | **archive** (carried by wip-253) |
| `wip-253-ONEQUEUEMEASURE` | 10-16 | −86/+7 | — | — | row 253 measured: one queue a trade-off | **archive** |
| `wip-276-ONEQUEUEPRODUCT` | 10-16 | −100/+3 | — | #96 →mainbase d | one queue as product (candidate, not adopted) | **close #96**, **archive** |

## 3. The AV1 line (open lab work into `av1-unified-mainbase`)

All drafts by the queue's rule (pre-registered protocol, then run). None changes a product default
except where noted. Proposed rule for all: **a row run to its verdict merges into mainbase after
an independent review of the verdict; a row not run is kept until the owner says run or drop.**

| branch | date | −b/+a | in | PR | holds | proposed action |
| --- | --- | --- | --- | --- | --- | --- |
| `av1-svc-preview` | 11-09 | −3/+104 | — | #283 →mainbase d | scalable preview: theory, protocol, SVC rows through round 7 | **keep**: run in progress; candidate by its own terms |
| `av1-profile-carriers` | 11-05 | −3/+205 | — | #306 →svc-preview d | layered vs separate payloads, measured (amended, n 94) | **merge** after #283, after review |
| `av1-snr-preview` | 11-05 | −3/+256 | preview-noise | #314 →profile-carriers d | SNR preview, measured n 20 | **merge** after #306, after review |
| `av1-preview-noise` | 11-07 | −3/+260 | — | #316 →snr-preview d | arithmetic over committed rows; verdict | **merge** after #314, after review |
| `av1-quality-profiles` | 11-04 | −3/+166 | — | #290 →mainbase d | lossy profiles decode, measured (amended): D1–D3 refuted | **merge** after review |
| `av1-quality-metrics` | 11-08 | −3/+101 | — | #305 →quality-profiles d | quality metrics, 1 650 cells, verdict | **merge** after #290, after review |
| `av1-noise-point` | 11-09 | −3/+96 | — | #317 →quality-metrics d | noise-point P1–P6 measured today | **merge** after #305, after review |
| `av1-preview-depth` | 11-04 | −3/+80 | — | #312 →quality-metrics d | preview depth, 336 cells, P1/P6 hold | **merge** after #305, after review |
| `av1-split-preview-b` | 11-05 | −3/+133 | — | #311 →quality-profiles d | split preview B measured, verdict | **merge** after #290, after review |
| `av1-top10-why` | 11-04 | −3/+54 | — | #304 →quality-profiles d | why the top 10 bits cost more (WebCodecs depth limit) | **merge** after #290, after review |
| `av1-residual-apart` | 11-04 | −3/+47 | lossy-pixel-work, paint-depth | #288 →mainbase d | RESIDAPART, 60 rounds, partly unresolved | **merge** after review |
| `av1-residual-exact` | 11-07 | −3/+69 | — | #315 →mainbase d | residual rebuilds exact frames natively; browser 6 of 20 cells | **keep**: browser cells partial |
| `av1-lossy-pixel-work` | 11-04 | −3/+78 | — | #307 →mainbase d | PIXELWORK: run void by its A/A, no verdict | **unsure**: archive as void or re-run |
| `av1-paint-depth` | 11-04 | −3/+63 | — | #309 →mainbase d | reduced-depth paint behind a flag; `client/paint` touched; no timing | **keep** until timed; product code behind a flag needs review before any merge |
| `av1-grey-path` | 11-04 | −3/+70 | — | #308 →mainbase d | grey path measured: exact; R a speed-up in 6 cells | **merge** after review |
| `av1-top-first` | 11-04 | −3/+74 | — | #310 →mainbase d | TOPFIRST: both forms exact, both fail the cost | **merge** (negative result) after review |
| `av1-webcodecs-profiles` | 11-07 | −3/+63 | — | #318 →mainbase d | AV1 profiles through WebCodecs per engine, from specs | **merge** after review (docs only) |
| `av1-visually-lossless` | 11-02 | −3/+32 | — | #291 →mainbase d | what binds lossy viewing (docs) | **merge** after review |
| `av1-lcevc-lossy` | 11-02 | −3/+34 | — | #292 →mainbase d | LCEVC for lossy: not worth building (theory) | **merge** after review |
| `htj2k-progressive` | 11-05 | −3/+77 | — | #295 →mainbase d | HTJ2K quality layers, measured n 3; 163 lab files | **merge** after review; unsure the row volume belongs in history |
| `us-data-search` | 11-04 | −3/+65 | — | #313 →mainbase d | FIXTURES: ultrasound data search, short list | **merge** after review (docs) |
| `av1-complementary` | 10-31 | −3/+32 | mainbase+8 | — | merged into mainbase (#282) | **delete** once mainbase is on `main` |
| `av1-lcevc-2026` | 11-02 | −3/+33 | mainbase+6 | — | merged into mainbase (#284) | **delete** once mainbase is on `main` |
| `jxl-single-frames` | 10-28 | −3/+6 | mainbase+57 | — | JPEG XL single frames (docs) | **delete** once mainbase is on `main` |

## 4. The client core and its campaign

`claude/core` itself is §Core below. Every tip marked "core" in *In* is carried by #250 and its PR
should be closed when #250 merges (#250's body lists them; the owner closes them).

| branch | date | −b/+a | in | PR | holds | proposed action |
| --- | --- | --- | --- | --- | --- | --- |
| `core` | 10-30 | 0/+183 | rfri34+25 | #250 →main d | see §Core | **merge** (see §Core) |
| `core-fold-2026-11-02` | 11-02 | 0/+201 | review2, asking-plan, m5b | #289 →core d | 15 sources squashed onto core, raw rows left out, status column; supersedes #273, #260–#267, #275, #276 | **merge into core** after review; then close what it supersedes |
| `core-review2` | 11-02 | 0/+206 | — | #299 →core d | second review: a frame decoded twice, fixed with test | **merge** after #289 |
| `core-repaint-fix` | 11-03 | 0/+184 | — | #302 →core d | controller: a repaint before the frame is held no longer stops painting | **merge** after #299; conflicts with it in `controller.test.mjs` (tested), needs a rebase |
| `core-onepass` | 11-04 | 0/+184 | — | #303 →core d | onePass ported from mainbase | **unsure**: needed only if core merges before mainbase; differs from mainbase's version in 4 files |
| `core-asking-plan` | 11-02 | 0/+203 | — | #298 →core d | ADR asking-policy (proposed, theory) | **keep** until the owner decides the policy; then merge the doc |
| `core-m5b` | 11-03 | 0/+234 | — | #301 →core d | M5 under an amended fill bar: ring on both engines; build proposed, not built | **merge** the verdict after #289; keep rows out (#289's rule) |
| `core-start2` | 11-03 | 0/+582 | — | #294 →core d | §7 start levers split, B′+fix kept | **unsure**: built on `core-fold-2026-10-30`, not on #289; 399 commits of rows; re-fold onto #289 or archive |
| `core-busy2` | 11-03 | 0/+669 | — | #296 →core d | §7 busy page: B′ wins on both engines | **unsure**: same as #294 |
| `core-fold-2026-10-30` | 10-30 | 0/+435 | 10 | #273 →core d | first fold, superseded by #289 | **close #273**, **archive** (raw rows cited by commit from #289) |
| `core-decoders`, `core-perf`, `core-review`, `core-s7`, `core-m5`, `core-exp1`, `core-exp2`, `core-native` | 10-30 | 0/+185…284 | fold-10-30 | #260–#267 →core d | each squashed into #289 | **close** after #289 merges; **archive** (rows cited at their commits) |
| `view-start`, `paint-read` | 10-31 | 0/+494, +476 | start2, busy2 … | #276, #275 →fold-10-30 d | §7 start timing; per-paint pixel read | **close** after #289 (squashed there); **archive** |
| `native-parity` | 10-30 | 0/+440 | — | #277 →fold-10-30 d | native: browser display controls, product cine | **unsure**: not in #289; native shape decided "basic" (#289 source 1); merge or archive is the owner's |
| `native-metrics` | 10-30 | 0/+463 | — | #278 →fold-10-30 d | native window timed vs browser, interim run | **unsure**: as #277 |
| `core-clock`, `core-s7-fixed`, `opfs-theory`, `opfs-c-shared` | 11-03/04 | 0/+455…601 | — | — | run branches: frame clock (no verdict), §7 with both fixes (A stays), OPFS arm parameters, C-shared (no arm passes) | **archive** after their verdicts are cited in `frame-path.md`; unsure they are |
| `serene-rubin-wakfg7` | 10-30 | 0/+186 | fold-10-30+10 | — | the core's handoff and settings' status | **archive** (squashed into #289) |
| `client-architecture-division-rfri34` | 11-06 | 0/+184 | — | — | core + one doc: the client's four subsystems | **unsure**: one commit by a non-owner identity, no PR; propose as a PR on core or archive |
| `view-worker-target`, `review-red`, `review-blind`, `view-worker-target-rev`, `vw-experiments`, `recv-loop`, `view-worker`, `view-worker-want`, `vw-exp-1`, `vw-exp-2`, `vw-exp-3`, `vw-cache`, `vw-exp-2-review`, `worker-clock`, `frame-memory`, `frame-memory-m5`, `opfs-arms`, `opfs-arms-d`, `opfs-cache-fixes`, `native-view-review` | 10-28/30 | ≤ +36 | core | #228 #231 #232 #235 #239 #237 #229 #238 #243 #246 #245 #244 #252 #225 #226 #241 #227 #242 #212 #253 | view-worker design, experiments, OPFS cache and arms, frame memory | **close** when #250 merges; **delete** then (fully merged) |
| `vw-exp-1-review`, `worker-clock-build`, `frame-memory-m5-run`, `opfs-arms-run` | 10-30/31 | +23…+76 | fold-10-30 etc. | #248 #249 #259 #285 | follow-ups that moved after #250's fold; #289 takes their latest tips | **close** after #289; **archive** (rows cited at commit) |
| `design-opfs-cache`, `opfs-persist-sources` | 10-20/22 | +1, +2 | core | #124, #132 | OPFS cache design, persist() per engine | **close** with #250; delete then |
| `opfs-multigb`, `opfs-cache-build`, `opfs-cache-measure` | 10-28 | +4…+12 | — / via #212 | #187 #197 #204 | multi-GB store, store worker, M1–M4 (rows lost, #257) | **close**: carried into core through #212 at an earlier tip; unsure the last review commits are |
| `cache-policy` | 10-28 | +8 | — | #207 →opfs-cache-build d | what keeping frames on a device obliges (sources) | **unsure**: not in core; merge as a doc onto core or archive |
| `ask-patterns-survey`, `ask-patterns-map` | 10-28 | 0/+1, +2 | map | #219 →main, #224 →survey d | how viewers choose what to fetch; mapped onto the wire | **merge into core** beside #298 (they feed it), after review |
| `design-p2-ask-during-fill`, `ask-during-fill-measure`, `scroll-policies` | 10-20/28 | +1, +5, +10 | chain | #121, #135, #203 | ask during a fill: design, ASKSTREAM run, SCROLLPOLICY | **unsure**: #250 put #135 out of scope; a relayed "scope addition" awaits the owner (#250 §4) |
| `coldrtt-hint` | 10-28 | +8 | — | #208 →mainbase d | depth hint: −41 ms to first exact frame, on by default | **merge** into mainbase after review (product default change) |
| `askjump-measure` | 10-22 | +5 | — | #138 →mainbase d | askJump not resolved on this host | **archive** (lab flag, no verdict) |
| `readmin-cut-stream` | 10-22 | +4 | — | #136 →mainbase d | readMin names a cut queued before the read; failing test first | **merge** after review (product fix) — unsure it is still needed on core |
| `d4-workstation-results` | 10-22 | +2 | — | #130 →mainbase d | D4 workstation round, incompressible fixture | **merge** after review |
| `decoders-committed` | 10-22 | +3 | core-decoders+17 (not `core`) | #133 →mainbase d | built decoders committed (owner-approved) | **close** after #289 merges (it squashes #260, which carries this) |

## 5. Native

All of the native line is carried by `core` (#250 folds #247 with #189 #198 #201 #206 #209 #216
#218 #236 #240).

| branch | date | −b/+a | in | PR | holds | proposed action |
| --- | --- | --- | --- | --- | --- | --- |
| `native-wire`, `native-core-1`, `native-core-2`, `native-paint`, `native-window`, `native-cache`, `native-fill`, `native-view-design`, `native-view-design-mrev`, `native-view` | 10-28/29 | +6…+34 | core | #189 #198 #201 #206 #216 #209 #218 #236 #240 #247 | raw-QUIC core, wgpu painter, cache, window, view-worker on threads | **close** with #250; **delete** then |
| `native-step1-check` | 10-28 | +17 | — | #211 →native-core-2 d | step 1's lab check behind the relay | **unsure**: not in core; small; merge onto core or archive |

## 6. Viewer (paused by the owner 2026-10-30)

| branch | date | −b/+a | in | PR | holds | proposed action |
| --- | --- | --- | --- | --- | --- | --- |
| `line-viewer` | 10-30 | 0/+47 | seam, seam2 | #255 →main d | the parked viewer line | **keep** (purpose: parked viewer work); not for merge |
| `viewer-seam`, `viewer-seam2` | 11-02/03 | +50, +58 | seam2 | #297, #300 →line-viewer d | our painter inside Cornerstone3D; option B costs, phone protocol | **keep** with #255 |
| `viewer-requirements`, `viewer-requirement-fixes`, `viewer-a-step1` | 10-27/28 | +6…+16 | line-viewer | #193 #210 #215 | requirements; no-wrap, DX/CR rotate; 1:1 mode | **close** (carried by #255) |
| `cine-no-skip` | 10-30 | +13 | — | #251 →requirement-fixes d | cine never skips a slice (old page viewer) | **unsure**: #250 says re-base onto the core's controller; else archive |
| `viewer-spike` | 10-28 | +16 | — | #214 →viewer-architecture d | throwaway A-vs-Cornerstone3D spike, verdict | **archive** (its own title: throwaway) |
| `viewer-survey`, `viewer-integration`, `viewer-architecture` | 10-27/28 | +7…+13 | mainbase+56 | — | viewer survey, integration, architecture docs | **delete** once mainbase is on `main` (carried) |

## 7. Server and transport

| branch | date | −b/+a | in | PR | holds | proposed action |
| --- | --- | --- | --- | --- | --- | --- |
| `line-server` | 10-30 | 0/+75 | — | #254 →main d | 13 PRs: results of rows 189, 258–260, GSO, PGO, TAILPING, congestion and disk designs; no default changed | **merge** after mainbase and after review (its own index lists the open items) |
| `tracker-fix-gso-tiles`, `pgo-measure`, `tailping-theory`, `design-disk-scaling`, `design-congestion-controller`, `wip-258-EXECGAP`, `wip-259-TILEWILLNEED`, `wip-260-FILLWINDOW` | 10-16/24 | +1…+10 | line-server | #140 #139 #137 #123 #122 #88 #102 #103 | carried | **close** when #254 merges; delete then |
| `beeper-ebpf-explore` | 10-29 | 0/+2 | — | — | docs: eBPF fast path not a send-path candidate; kTLS lever | **unsure**: no PR; merge as a doc or archive |
| `telemetry-production-design` | 10-24 | +4 | — | #143 →mainbase d | ADR: client telemetry in production, sampled | **unsure**: in no line; owner's decision |

## 8. Hygiene, audits and deploy

| branch | date | −b/+a | in | PR | holds | proposed action |
| --- | --- | --- | --- | --- | --- | --- |
| `line-hygiene` | 10-30 | 0/+105 | — | #256 →main d | #112, #125→#134, #188→#202, #190→#200, #213, #131, #127, #114–#117 | **merge** after mainbase and after review; many items have "no review" in its index |
| `test-separation`, `design-simplification-sweep`, `simplification-u9-u12-audit`, `client-audit-r5`, `client-simplify-r5`, `server-audit-r5`, `server-simplify-r5`, `test-race-asyncfd`, `server-licence-notices`, `queue-status-232-236`, `page-without-transport-file`, `deploy-readme-host-nginx`, `smoke-not-a-default`, `arm64-server-build` | 10-18/28 | +1…+23 | line-hygiene | #112 #125 #134 #188 #202 #190 #200 #213 #131 #127 #114 #115 #116 #117 | carried | **close** when #256 merges; delete then |
| `deploy-dry-run` | 10-21 | −2/+15 | — | #129 →main d | #114–#117 combined, "not to merge" | **close**, **archive** |
| `merge-order-2026-10-28` | 10-28 | +6 | — | #217 →mainbase d | merge order, "not to merge" | **close**, **archive** |
| `merge-order-2026-10-29` | 10-30 | 0/+1 | — | #257 →main d | blockers note, "not to merge" | **close**, **archive** |
| `day-summary-2026-10-27` | 10-27 | +5 | — | #205 →mainbase d | day summary, "not to merge" | **close**, **archive** |
| `probe-sched-20261029-gh-yes` | 10-29 | 0/+1 | — | — | empty probe commit | **archive** (not merged, so not delete; no content) |

## 9. PACS: ingest, receive, metadata, disk layout, sync

`line-pacs` (#258) carries ~53 PRs and says itself "a draft, not to merge: it holds unfinished
implementation (D11)".

| branch | date | −b/+a | in | PR | holds | proposed action |
| --- | --- | --- | --- | --- | --- | --- |
| `line-pacs` | 10-30 | 0/+264 | — | #258 →main d | receiver crate, carrier crate, sender, pacs-verify, metadata/sqlite/study-index labs, ADRs | **keep** (purpose: the PACS line until D11's unfinished items are done); not for Friday |
| 48 branches: `metadata-turso` `page-open-metadata` `pacs-receiver-design` `metadata-format-survey` `metadata-pair-bench` `metadata-update-cost` `metadata-repetition` `sqlite-engine-eval` `sqlite-engine-fair` `sqlite-lock-behaviour` `update-compression` `parser-metadata-measure` `study-db-layout` `ce-compression-ratios` `sync-b-vs-e` `metadata-consolidated` `metadata-updates-design` `display-metadata-design` `viewer-metadata-design` `viewer-metadata-measure` `viewer-metadata-gz-row` `study-index-design` `study-index-proto` `study-index-engines` `study-index-placement` `serve-by-uid-design` `serve-by-uid-impl` `pacs-disk-layout` `design-records-combined` `update-flow` `pcs-transfer-design` `pcs-carrier` `pcs-carrier-impl` `pcs-reply-path` `reply-needed` `carrier-quic-choice` `carriers-explained` `transport-seam` `sender-package-build` `pacs-receiver-impl` `receiver-process-map` `verify-tool` `late-frame-cost` `sbnd-tail-rewrite` `sbnd-late-frames` `sync-prior-art` `sync-second-writer` `sync-shapes` | 10-20/28 | +3…+46 | line-pacs | #113 #118–#120 #126 #142 #144–#166 #169–#182 #185 #220–#223 | carried | **close** in favour of #258; keep the branches until #258 lands (it cites them) |
| `pacs-design-state` | 10-29 | +19 | — | #168 →mainbase d | the PACS design state; moved after the fold | **merge into `line-pacs`** (1 commit it lacks), then close |
| `pacs-disk-layout-measure` | 10-31 | +9 | — | #167 →pacs-disk-layout d | disk-layout protocols run; moved after the fold | **merge into `line-pacs`** (1 commit it lacks), then close |
| `pcs-pacs-options`, `rsync-options`, `rsync-updates` | 10-29 | +8, +9 | — | #230 →mainbase, #233, #234 →pcs-pacs-options d | PCS→PACS options; rsync delivery; late instances over rsync | **merge into `line-pacs`** (the line folded #230 #233 #234, but each tip moved after: 2, 1 and 1 commits it lacks) |

## Core: `claude/core`, where Friday's demo is built

**What it holds that `main` lacks** (183 commits, 178 files, +19 158/−785; 14 of the files are
raw lab rows). It contains `av1-unified-mainbase` as of 10-30 (`ea581ac`), so merging it brings that too.

* `client/view/` (new): the view worker — controller, frame store, cache, clock, view — as a
  variant `?view=worker` beside today's `?view=page`, which stays the default.
* `client/viewer/`: page rewired through the controller; `store.js` (OPFS cache) behind
  `?writer=`, off by default.
* `client/transport`, `client/decode`, `client/paint`: lab settings `span`, `waitAhead`, `pixels`,
  defaults equal to today's; paint worker and cells.
* `client/native/` (new crate, ~3 000 lines): raw-QUIC client, wgpu painter, cache, window,
  `--paint-thread ui|view|core`.
* `server/src/transport/{server,link,wire}.rs`, `common/fod`: `wt-pacs/1` beside h3 on the
  server's one endpoint; a stopped endpoint ends the accept loop. **This is a server change.**
* `scripts/gate.sh`: the new steps; `docs/adr/frame-path.md` §The core, glossary, ARCHITECTURE.

**Review state.**

* #250: draft, **no review submitted**; one independent review as a comment (six defects, fixed
  in #262, which #289 squashes in). Its body: gate full `GATE OK in 266 s` at 10-30, 14 mutants
  killed, one flaky test (`client/view/clock.test.mjs`, 1 in ~35).
* #289 (the fold of 11-02): draft, no review, **no CI run**; its own gate stopped at the decoders'
  rebuild (environment), the steps after it passed by hand.
* #299 (second review): fixes a frame decoded twice, with a failing test first.
* Nothing has been merged into `core` since 10-30; 17 open PRs target it.

**What blocks merging it into `main`.**

1. **CI `deploy` fails on #250** (run of 10-30): `cargo build -p series-server` in the image
   fails with "failed to load manifest for workspace member `/src/client/native`" — the root
   `Cargo.toml` lists `client/native`, `deploy/Containerfile` does not copy it. Same on every
   core branch read (`core`, `core-fold-2026-11-02`, `core-review2`, `core-busy2`). `main` is not
   deployment-ready after this merge until it is fixed.
2. It is a draft with no approving review; the owner's open decisions are listed in #250 §For the
   owner (cache off by default, page window not carried, `cine-no-skip` not folded, a relayed
   scope addition unconfirmed) and #289 §Status (six items waiting on the owner).
3. **Order with mainbase.** Tested locally on 2026-11-09 (scratch merges, nothing pushed):
   `main + mainbase` then `+ core` conflicts in `client/decode/av1-frame.js`; `main + core` is
   clean, then `+ #289` clean, `+ #299` clean, `+ #303` clean, `+ #302` conflicts in
   `client/view/controller.test.mjs`, and mainbase afterwards conflicts in the four `av1*` files
   (#303's port differs from mainbase's in each).
4. Size: #289's rule keeps raw rows out of the merge candidate, but `core` itself still carries
   14 row files #289 removes; merging #250 without #289 brings them.

**Smallest reviewed path to `main` by Friday** (proposed; each step a review by a session that did
not write it, gate green, CI green):

1. Fix the image build on `core` (copy `client/native`'s manifest, or exclude the member from the
   image's workspace), so `deploy` passes. One commit.
2. Review and merge **#289** into `core` (it supersedes #273, #260–#267, #275, #276), then **#299**,
   then **#302** rebased onto it. Leave #294, #296, #298, #301, #303 out of Friday.
3. Merge `av1-unified-mainbase` into `core` there, resolving the four `av1*` files once (instead of
   #303), and `main`'s 3 commits (#184).
4. Full `scripts/gate.sh` and CI on that tip; one approving review on #250; merge #250 into `main`
   with `--no-ff`. Defaults stay today's (`?view=page`, no writer, `span` 0), so the demo shows the
   view worker by URL setting, not by default — unsure whether that is what the demo needs.

## Open PRs with a "Generated by/with" line, a Co-Authored-By trailer, or a commit not authored by `dary-dc <crespoydelgado@gmail.com>`

Commits counted are those in the PR's own range (base..head).

**Body carries "Generated with/by" and a session link (89):** #37 #40 #41 #88 #112 #113 #118
#119 #120 #121 #122 #123 #124 #125 #126 #127 #129 #130 #131 #132 #133 #134 #135 #136 #137 #138
#139 #140 #143 #211 #214 #215 #216 #217 #218 #236 #237 #239 #240 #241 #242 #243 #244 #245 #246
#248 #249 #250 #251 #252 #253 #254 #255 #256 #257 #258 #259 #260 #261 #262 #263 #264 #265 #266
#267 #273 #275 #276 #277 #278 #285 #289 #291 #294 #296 #297 #298 #299 #300 #301 #302 #308 #309
#310 #311 #312 #316 #317 #318.

**Commits with a Co-Authored-By trailer:** #37 (135), #248 (4), #249 (4), #250 (33), #251 (3),
#252 (3), #253 (2), #254 (9), #255 (1), #256 (17), #257 (1), #258 (2), #259 (49), #260 (1),
#261 (14), #262 (11), #263 (13), #264 (57), #265 (24), #266 (3), #267 (3), #273 (144), #285 (55),
#289 (18), #294 (149), #296 (148), #297 (3), #298 (20), #299 (23), #300 (11), #301 (51), #302 (1).
A "Generated" line inside a commit message: #37, #256 (one each).

**Commits authored by someone else:**

* author `Claude <noreply@anthropic.com>`: #248 #249 #250 #251 #252 #253 #254 #255 #256 #257 #258
  #259 #260 #261 #262 #263 #264 #265 #266 #267 #273 #275 #276 #277 #278 #285 #289 #294 #296 #297
  #298 #299 #300 #301 #302 — and #37, which also has commits by another coding agent's identity.
* author `darian <crespoydelgado@gmail.com>` (same address, other name; GitHub web merges): #37
  #177 #250 #254 #255 #256 #258.
* committer only (author is `dary-dc`): #283, #290, #306 (committer `Claude <noreply@…>`).

**Not flagged by any test (101):** #39 #96 #102 #103 #114 #115 #116 #117 #142 #144 #145 #146 #147 #148 #149 #150 #151 #152 #153 #154 #155 #156 #157 #158 #159 #160 #161 #162 #163 #164 #165 #166 #167 #168 #169 #170 #171 #172 #173 #174 #175 #176 #178 #179 #180 #181 #182 #185 #187 #188 #189 #190 #193 #197 #198 #200 #201 #202 #203 #204 #205 #206 #207 #208 #209 #210 #212 #213 #219 #220 #221 #222 #223 #224 #225 #226 #227 #228 #229 #230 #231 #232 #233 #234 #235 #238 #247 #283* #288 #290* #292 #295 #303 #304 #305 #306* #307 #313 #314 #315 #319 (* committer only, above). Branches without a PR whose commits are by
`Claude <noreply@…>`: `client-architecture-division-rfri34`, `serene-rubin-wakfg7`, `core-clock`,
`core-s7-fixed`, `opfs-theory`, `opfs-c-shared`, `beeper-ebpf-explore`.
