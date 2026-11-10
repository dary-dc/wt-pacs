# Plan: the demo, one path into main, a unified repository

Written 2026-11-10 from `origin` after `git fetch --prune` (02:30 UTC tips), the GitHub API and scratch merges. Every
step below waits for the owner's approval of this plan. Times are UTC. "Session" means a cloud run with the brief
shown. "Owner" means a decision or a merge word. A review is always done by a session that did not write the change
(`docs/lines/coordination.md` §Decisions).

## (a) State now

**Repository.** `main` is `5952559a` (#322), and CI `gate` on it is green (run 42740168702). There are 249 branches
besides `main`, 204 open PRs (203 drafts; #333 ready) and 34 `archive/*` tags. No archive index exists on any
branch. The inventory (`claude/repo-inventory:docs/inventory-2026-11-09.md`) was re-verified: all 122 rows of its
§2 and §6–9 hold, §3–5 hold except where shown below, and 17 branches are new since it was written.

**CI gap.** `.github/workflows/gate.yml` runs only on PRs into, and pushes to, `main` and
`claude/av1-unified-mainbase`. **No PR into `claude/core` has ever had CI**, and that includes every demo PR.

### The demo (optimal quality)

| part | branch, PR → base | what exists | review, CI | blocks |
| --- | --- | --- | --- | --- |
| core | `claude/core` 2e6fa5b2, #250 → main | view worker, OPFS cache, native crate, `wt-pacs/1`; 7 behind `main`, +183 | no review submitted; one independent review comment, whose fixes (#262) are not on `core`; CI `deploy` **fails** (40982941471): `failed to read /src/client/native/Cargo.toml` | the image build; its review |
| ingest | `claude/oq-ingest`, #321 → core | `ingest.py` `lossy`, `lab/av1/tools/ingest_coded.py --lossy Q G --exact-series`, `scripts/demo-series.sh` | **no review: `claude/oq-ingest-fixes` does not exist**; `lossy_test.py` not run (needs `ingest/tools.sh` and numpy) | its review |
| client | `claude/oq-client`, #320 → core; `claude/oq-client-fixes`, #327 → oq-client | `pair.js`, the Lossless button `l`, the quality label, `?overlay=1`, `dev-server.py --exact-*`; works under both `?view=page` and `?view=worker` | reviewed: the fixes are b1ba193a (an exact series of another source is refused) and 77709134 (the button asks again after a failed check); node tests pass | — |
| depth cut | `claude/oq-depth-cut`, #328 → core | **contains oq-ingest, oq-client and oq-client-fixes**; 10-bit codes `min((v + 2^(D−11)) >> (D−10), 1023)`, `lossy.bitsStored`, a window table with no shift pass, the overlay names the form; D ≤ 10 and signed series refused | no review; every node test passes, and `client/decode/depth-cut.browser.mjs` passes in headless Chromium (8 frames, WebCodecs = dav1d) | its review; quality not measured |
| phone | `claude/phone-setup`, #330 → core | README §The viewer on an Android phone: USB tethering, `adb reverse`, firewalld 4433/udp, netem | no review; checked only with a network namespace standing in for the phone | **covers one series, not a pair** (no exact server on 4434, no exact transport file, no firewalld rule for it) |
| web image | `claude/oq-depth-cut:deploy/nginx/wt-pacs.conf.template` | serves `/series/metadata` and `/wt/dev-transport.json` only | — | the image cannot serve a pair; only `dev-server.py` can |
| DICOM ingest | `ingest/from-dicom/` | unchanged on every branch | — | the OQ view is coded only by the lab tool (Open 6, not needed for the demo) |
| end to end | — | never run: no browser has shown a real pair, and no phone run has happened | — | everything above |

**Scratch merges (not pushed).** These merge **cleanly**: `core` → oq-ingest → oq-client-fixes → oq-depth-cut →
phone-setup; `main` + `core`; `main` + `core` + `#262`. Merged onto `core` + #289, the demo branches conflict in
`client/view/view.js` (3 hunks, not trivial), `controller.js` and `downloader.test.mjs`. That merge was resolved
locally and its tests passed (view 11/11, controller 29/29). **#289 causes the conflict, not #299 or #302.**

**Fix for the image build, tested.** One line in `deploy/Containerfile`, `COPY client/native ./client/native`. With it,
the `server` and `web` targets build on the merged tip and `deploy/check_equivalence.sh` reports equivalent on 11
paths. Copying only the manifest plus `src` is not enough: the crate's `paint-check` example is required.

**Gate in this container.** The full `scripts/gate.sh` fails at `client/contract/run_browser.sh` on both `main` and
the demo tip, with the same errors ("exact … undefined"). `client/decode/wasm/built` was absent, and CI builds it,
so the failure is most likely this environment's. **UNSURE**: not traced. On `main`+`core`+#289+#299+#302+mainbase,
the `cargo test` of `series-server`, `native-client`, `fod`, `frame-envelope` and `series-bundle` passed 171 of 171.

### Client and native

| item | where | state | blocks |
| --- | --- | --- | --- |
| second fold | `claude/core-fold-2026-11-02`, #289 → core | 15 sources; drops the 14 raw row files; carries #262's six fixes | no review, no CI; conflicts with `README.md` (#319, trivial) and with the demo branches (above) |
| frame decoded twice | `claude/core-review2`, #299 → core (contains #289) | fixed, with a test | #289 |
| repaint fix | `claude/core-repaint-fix`, #302 → core | fixed | a trivial `controller.test.mjs` conflict after #289 |
| onePass port | `claude/core-onepass`, #303 → core | **lacks mainbase's signed 8-bit range fix (faf6932d) and `reuseCopyBuffer`** | merging it would bring that bug back: close it |
| asking policy, M5, §7 runs | #298, #301, #294, #296 → core | proposed or run, not folded | the owner's word |
| native | carried by `core`; #277, #278, #211 | the M1/M2 core, a window | its image build (above); the shape decisions in `docs/native/README.md` §7 |

### Codecs and lab (AV1)

| item | where | state | blocks |
| --- | --- | --- | --- |
| integration base | `claude/av1-unified-mainbase` | −10/+62 against `main`, **merges cleanly**; 9 product files (+328/−25): `client/decode/av1*.js`, `ingest/coded-frames/ingest.py`, `ingest/from-dicom/dicom_series.py`, `scripts/perf_nightly.mjs` | no PR into `main`; no review |
| result chain | #290 → #305 → #317, #312, #311, #304; #283 → #306 → #314 → #316; #288, #307–#310, #313, #315, #318, #291, #292, #295 | as in the inventory's §3; `av1-svc-preview` moved (round 8) | reviews |
| new (11-09/10) | #323 window-q, #325 vl-metrics, #326 groups, #332 noise-ratio → the chain; #324 htj2k-tiles, #329 audit-quality, #331 encoder-settings, #334 audit-decode, #333 docs-lines-2 → main | window-q: Q 8 holds "error within noise" at every window width; audits: the noise bar is unsettled, "G saves nothing" holds only at Q 8, and the view is 0.10–0.28 of HTJ2K's bytes (not 0.07–0.22); encoder-settings: **Q 0 in `lossy_args` is lossless but labelled lossy**; groups and noise-ratio are unfinished | #329, #331 and #333 conflict textually in `docs/lines/codecs.md` and `README.md` |
| noise point | `claude/av1-noise-point:docs/av1/noise-point.md` | the top Verdict still says the held-out test is owed, while §8 reports it holding (10 of 10) | one edit |

### PACS and metadata, server, hygiene, viewer

| line | branch, PR | state | blocks |
| --- | --- | --- | --- |
| PACS | `claude/line-pacs`, #258 → main | "not to merge" (unfinished D11); carries 48 branches; `pacs-design-state`, `pacs-disk-layout-measure`, `pcs-pacs-options`, `rsync-options` and `rsync-updates` are 1–2 commits past it | the owner's decisions in `docs/lines/metadata.md` §Open 3 |
| server | `claude/line-server`, #254 → main | carries 9; 7 product files, no default changed | review; **conflicts with line-hygiene** in 6 `server/` files, in either order |
| hygiene | `claude/line-hygiene`, #256 → main | carries 14; 103 product files (tests split into `tests.rs`, notices, arm64, `CLAUDE.md` rules) | review; the conflict above |
| viewer | `claude/line-viewer`, #255 → main | paused; carries 3; seam branches #297, #300 | the owner's word |
| deploy docs | `claude/rootless-podman-and-selinux` (no PR) | rootless podman and SELinux docs; adds `--security-opt label=disable` in `client/decode/wasm/build/build.sh` | a draft PR and a review |
| glossary | across branches | two names for one concept, or one name for two: *lossy series* = *optimal quality*, and *exact series* defined twice (demo); *client cache* = *cache* and *credit* used two ways (core); *lab lever* means one thing on core and another on hygiene; *metadata group* = *group file*, *package* defined twice, *verdict* = *status*, and *revision* with three meanings (line-pacs) | the reconciliation steps D3 and U7 |

## (b) The plan

Sizes: S is under 2 hours of a session, M is half a day, L is a day or more. "Latest" is the latest safe finish that
still holds the demo at 2026-11-13 15:00.

### Demo path

| # | action | branch(es) | who, brief | review | done when | size | latest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D0 | decide O1–O5 | — | owner | — | answered | — | 11-11 09:00 |
| D1 | fix the image build, give `core` CI, drop the 14 raw row files (O1, O5) | `claude/core-ci` from `core`, PR → core | session: "Add `COPY client/native ./client/native` to `deploy/Containerfile`, add `claude/core` to both branch lists in `gate.yml`, and delete the 14 files #289 deletes (`git diff --diff-filter=D core core-fold-2026-11-02`). Run `scripts/check_links.py` and open a draft PR." | a second session reads the diff | CI `decoders`, `gate` and `deploy` green on the PR; owner merges | S | 11-11 12:00 |
| D2 | review oq-ingest | `claude/oq-ingest-fixes` from `claude/oq-ingest`, PR → oq-ingest | session (not oq-ingest's writer): "Review `core..oq-ingest`. Build `ingest/tools.sh`, run `lossy_test.py` and mutate each new test. Refuse Q 0 in `lossy_args` (`claude/av1-encoder-settings:docs/av1/encoder-settings.md`). Fix what you find, with failing tests first." | it is the review | `lossy_test.py` green with its mutants killed; findings listed in the PR | M | 11-11 18:00 |
| D3 | review the depth cut and the client fixes; reconcile the demo's glossary | `claude/oq-depth-cut-fixes` from `claude/oq-depth-cut`, with D2 merged in, PR → **core** (it carries #320, #321, #327, #328) | session (not oq-client's or oq-depth-cut's writer): "Review `oq-client..oq-depth-cut` and the two oq-client-fixes commits. Make one `docs/glossary.md` row each for *optimal quality*, *exact series*, *pairing* and *depth cut*, and remove *lossy series* as a second name and 'at the source's depth'. Mutate the new tests." | it is the review | node tests and `depth-cut.browser.mjs` green; CI green (after D1); one row per term | M | 11-11 20:00 |
| D4 | make the phone section run a pair | `claude/phone-pair` from `claude/phone-setup`, with D3 merged in, PR → core (it carries #330) | session: "Extend `README.md` §The viewer on an Android phone to a pair: the exact server on 4434, its transport file naming the laptop's address, firewalld 4434/udp, `dev-server.py --exact-metadata/--exact-transport`. Check it with the namespace harness, as phone-setup did." | a second session | the namespace check fetches an exact frame whose digest matches | S | 11-11 20:00 |
| D5 | merge into core | D1, D3, D4 PRs | owner: merge words; close #320, #321, #327, #328 and #330 as carried | D1–D4 | `core` holds all three; CI green on `core` | — | 11-12 08:00 |
| D6 | the end to end on real pairs | on `core` after D5; results in `docs/lines/optimal-quality.md` | session: "Build the decoders and `ingest/tools.sh`. Run `scripts/demo-series.sh` on `dbts_a1`, `dbts_b1` and `dbts_c1` at Q 8 and Q 24 and G 1, 8 and 16, with the depth cut on a1 and c1. Serve each pair with `dev-server.py`. In Chromium, check the label's four states, `l`, the digest match and the overlay's `path` (WebCodecs, or dav1d when forced). Name the fixtures and their limits." | a second session reads the record | every pair passes; the overlay shows WebCodecs where its probe passes; failures filed as fixes into core | M | 11-12 14:00 |
| D7 | the rehearsal on the laptop and the Android phone | `core` at D6's commit, its hash recorded | owner: the README pair run on the laptop's Chrome; the phone tethered, then on Wi-Fi with netem | — | both devices show *Optimal quality*, then *Lossless* on `l`; the commit hash noted | — | 11-12 20:00 |
| D8 | review #250 (core into main) | `claude/core` → `main` | session (wrote none of `core`'s demo work): "Review `main...core` with product paths and defaults first (`server/`, `common/`, `client/transport`, `client/decode`, `client/viewer`, `deploy/`). Run the full `scripts/gate.sh` with the decoders built. Post one review on #250, listing what is off the default path." | it is the review | an approving review, or blockers listed by 11-13 06:00; CI green | L | 11-13 06:00 |
| D9 | merge #250 into main with `--no-ff` | `main` | owner: the merge word | D8 | CI green on `main`; `main`'s tree equals D7's commit plus `main`'s 7 commits | — | 11-13 12:00 |
| D10 | the demo | `main`, or D7's commit if D9 slips | owner | — | — | — | 11-13 15:00 |

D1–D4 run in parallel. D2 → D3 is the only order among them: D3 merges D2 as soon as D2 is pushed. If D2 runs
late, D3 still goes to core without it and D2 follows as its own PR into core.

### Into main, after the demo

| # | action | branch(es) | who | review | done when | size |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | merge #333, then #334, #329, #331, resolving `docs/lines/codecs.md` and `README.md` by hand | `docs-lines-2`, `av1-audit-decode`, `av1-audit-quality`, `av1-encoder-settings` | owner, after a session reviews each | yes | on `main`, CI green | S each |
| M2 | open a PR `claude/av1-unified-mainbase` → main; review its 9 product files; merge | mainbase | session, then owner | yes | CI green; mainbase stays the AV1 line's branch (O8) | M |
| M3 | merge #289, then #299 and #302 into core, resolving `view.js` against the OQ work (the local resolution passed view 11/11); then mainbase into core (one `av1-frame.js` hunk: mainbase's `output()` with core's `frameBuffer`); close #303 | core | session writes `claude/core-fold-merge`; a second session reviews; owner | yes | CI green on core; the D6 pair run passes again | L |
| M4 | core into main again (M3's commits) | #250 or a new PR | owner | yes | CI green | S |
| M5 | `claude/line-server` (#254), then `claude/line-hygiene` (#256), resolving the 6 `server/` files once (O9) | the two lines | session per line review; owner | yes | CI green; the held defaults stay held | L |
| M6 | `claude/rootless-podman-and-selinux` as a draft PR into main | it | owner opens it or a session does; review | yes | CI green | S |

### Unification, line by line (every branch and open PR gets one action)

Names drop `claude/`. "Contained" was checked with `git merge-base --is-ancestor` on 2026-11-10. Closing a carried
PR loses nothing, because its commits stay reachable from the branch that carries them.

| # | group | branches (PRs) | action | evidence | when |
| --- | --- | --- | --- | --- | --- |
| U1 | fully merged into `main` | `deploy-prebuilt-server`, `lab-out-of-product-2yftz0`, `tidy-open-prs-ljtmay`, `rustls-advisories-main`, `docs-lines` | delete | ancestors of `main` | now (O6) |
| U2 | carried by mainbase | `av1-complementary`, `av1-lcevc-2026`, `jxl-single-frames`, `nightly-xxh3-pin`, `rustls-advisories-mainbase`, `viewer-architecture`, `viewer-integration`, `viewer-survey` | delete | ancestors of mainbase | after M2 |
| U3 | carried by `core` (32 branches) | `design-opfs-cache`, `frame-memory`, `frame-memory-m5`, `native-{cache,core-1,core-2,fill,paint,view,view-design,view-design-mrev,view-review,window,wire}`, `opfs-arms`, `opfs-arms-d`, `opfs-cache-fixes`, `opfs-persist-sources`, `recv-loop`, `review-blind`, `review-red`, `view-worker`, `view-worker-target`, `view-worker-target-rev`, `view-worker-want`, `vw-cache`, `vw-exp-1`, `vw-exp-2`, `vw-exp-2-review`, `vw-exp-3`, `vw-experiments`, `worker-clock` (#124 #132 #189 #198 #201 #206 #209 #212 #216 #218 #225–#229 #231 #232 #235–#247 #252 #253, per inventory §4–5) | close the PRs, delete the branches | ancestors of `core` | after D9 |
| U4 | squashed by #289 | `core-fold-2026-10-30` (#273), `core-{decoders,perf,review,s7,m5,exp1,exp2,native}` (#260–#267), `view-start` (#276), `paint-read` (#275), `vw-exp-1-review`, `worker-clock-build`, `frame-memory-m5-run`, `opfs-arms-run` (#248 #249 #259 #285), `decoders-committed` (#133), `serene-rubin-wakfg7` | close; archive | #289's body lists its sources | after M3 |
| U5 | core run branches, open decisions | `core-start2` (#294), `core-busy2` (#296), `core-asking-plan` (#298), `core-m5b` (#301), `core-clock`, `core-s7-fixed`, `opfs-theory`, `opfs-c-shared`, `ask-patterns-survey` (#219), `ask-patterns-map` (#224), `design-p2-ask-during-fill` (#121), `ask-during-fill-measure` (#135), `scroll-policies` (#203), `cache-policy` (#207), `opfs-multigb` (#187), `opfs-cache-build` (#197), `opfs-cache-measure` (#204), `client-architecture-division-rfri34` | #298 with #219 and #224 kept until the owner decides the asking policy; #301's verdict merged into core after M3; the rest archived once `docs/adr/frame-path.md` cites their verdicts | inventory §4 (unchanged) | after M3 (O10) |
| U6 | client fixes against mainbase | `coldrtt-hint` (#208, a product default), `readmin-cut-stream` (#136), `d4-workstation-results` (#130), `askjump-measure` (#138), `onerror` | #208 and #136: a review into core, if still needed after M3; #130 merged into mainbase; #138 and `onerror` archived | inventory §2 and §4 | after M3 |
| U7 | the demo branches | `oq-ingest`, `oq-client`, `oq-client-fixes`, `oq-depth-cut`, `phone-setup`, D1–D4's branches | delete after D9 (carried by `core`) | D5 | after D9 |
| U8 | native, not folded | `native-parity` (#277), `native-metrics` (#278), `native-step1-check` (#211) | the owner's word on the native shape; otherwise archive | inventory §4–5 | O11 |
| U9 | AV1 chain into mainbase | `av1-quality-profiles` (#290) → `av1-quality-metrics` (#305) → `av1-noise-point` (#317; fix the top Verdict first) → `av1-window-q` (#323), `av1-vl-metrics` (#325); `av1-preview-depth` (#312), `av1-split-preview-b` (#311), `av1-top10-why` (#304); `av1-grey-path` (#308), `av1-top-first` (#310), `av1-webcodecs-profiles` (#318), `us-data-search` (#313); `av1-visually-lossless` (#291), `av1-lcevc-lossy` (#292), `av1-residual-apart` (#288); `htj2k-progressive` (#295) | review, then merge into mainbase, in that order | inventory §3; new PRs above | after M2, a session per two PRs |
| U10 | AV1 kept (running) | `av1-svc-preview` (#283) → `av1-profile-carriers` (#306) → `av1-snr-preview` (#314) → `av1-preview-noise` (#316), the last three merged after #283 by review; `av1-groups` (#326), `av1-noise-ratio` (#332), `htj2k-tiles` (#324), `av1-residual-exact` (#315) | keep: running, or a protocol not yet run; #315 keep or archive (the residual is dropped: **UNSURE**) | the codecs report | the line decides |
| U11 | AV1 against a decision | `av1-paint-depth` (#309, product code behind a flag), `av1-lossy-pixel-work` (#307) | #309 archived (no reduced-depth preview, 2026-11-10); #307 archived as void (its A/A failed) | `docs/lines/codecs.md` on #333 | after M1 |
| U12 | pre-rebuild history | `av1`, `av1-pre-main`, `av1-unified`, `av1-unified-pre-main`, `av1-mainbase`, `wip-208…`, `wip-210…`, `wip-211-ASKFIRSTCAPMEASURE`, `wip-212-CCMEASURE`, `wip-213-INTERSLICE`, `wip-214-DISPLAYTAGS`, `wip-215…`, `wip-219…`, `wip-226…`, `wip-252…`, `wip-253…`, `wip-276…` (#96), `wip-dockerread`, `ccr-10b47d42-tr6zpv` (#37, no `claude/` prefix), `project-thread-9jumbi` (#39), `project-thread-9jumbi-212` (#40), `video-containers-research-ed5fg2`, `next-ideas-cdydy8`, `project-thread-9uugfm` | close the PRs; archive | inventory §2, re-verified; `docs/av1/MAINBASE.md` | O12 |
| U13 | carried by line-server | `design-congestion-controller`, `design-disk-scaling`, `pgo-measure`, `project-thread-9jumbi-189` (#41), `tailping-theory`, `tracker-fix-gso-tiles`, `wip-258…`, `wip-259…`, `wip-260…` (#88 #102 #103 #122 #123 #137 #139 #140) | close and delete | ancestors of line-server | after M5 |
| U14 | carried by line-hygiene | `arm64-server-build`, `client-audit-r5`, `client-simplify-r5`, `deploy-readme-host-nginx`, `design-simplification-sweep`, `page-without-transport-file`, `queue-status-232-236`, `server-audit-r5`, `server-licence-notices`, `server-simplify-r5`, `simplification-u9-u12-audit`, `smoke-not-a-default`, `test-race-asyncfd`, `test-separation` (#112 #114–#117 #125 #127 #131 #134 #188 #190 #200 #202 #213) | close and delete | ancestors of line-hygiene | after M5 |
| U15 | not to merge, notes | `deploy-dry-run` (#129), `merge-order-2026-10-28` (#217), `merge-order-2026-10-29` (#257), `day-summary-2026-10-27` (#205), `probe-sched-20261029-gh-yes`, `viewer-spike` (#214) | close; archive | the PR bodies say "not to merge" | now (O6) |
| U16 | server and telemetry docs | `beeper-ebpf-explore`, `telemetry-production-design` (#143) | the owner's word: a doc on line-server, or archive | inventory §7 | O11 |
| U17 | PACS | `line-pacs` (#258) kept; its 48 carried branches: `metadata-turso` `page-open-metadata` `pacs-receiver-design` `metadata-format-survey` `metadata-pair-bench` `metadata-update-cost` `metadata-repetition` `sqlite-engine-eval` `sqlite-engine-fair` `sqlite-lock-behaviour` `update-compression` `parser-metadata-measure` `study-db-layout` `ce-compression-ratios` `sync-b-vs-e` `metadata-consolidated` `metadata-updates-design` `display-metadata-design` `viewer-metadata-design` `viewer-metadata-measure` `viewer-metadata-gz-row` `study-index-design` `study-index-proto` `study-index-engines` `study-index-placement` `serve-by-uid-design` `serve-by-uid-impl` `pacs-disk-layout` `design-records-combined` `update-flow` `pcs-transfer-design` `pcs-carrier` `pcs-carrier-impl` `pcs-reply-path` `reply-needed` `carrier-quic-choice` `carriers-explained` `transport-seam` `sender-package-build` `pacs-receiver-impl` `receiver-process-map` `verify-tool` `late-frame-cost` `sbnd-tail-rewrite` `sbnd-late-frames` `sync-prior-art` `sync-second-writer` `sync-shapes` (PRs #113 #118–#120 #126 #142 #144–#166 #169–#182 #185 #220–#223); `pacs-design-state` (#168), `pacs-disk-layout-measure` (#167), `pcs-pacs-options` (#230), `rsync-options` (#233), `rsync-updates` (#234) | keep #258 (purpose: the PACS line until D11); merge the five moved tips into line-pacs after review; then close the 48 PRs and delete their branches | ancestors of line-pacs; the five are 1–2 commits past it | O13 |
| U18 | viewer | `line-viewer` (#255), `viewer-seam` (#297), `viewer-seam2` (#300) kept; `viewer-requirements` (#193), `viewer-requirement-fixes` (#210), `viewer-a-step1` (#215) closed and deleted; `cine-no-skip` (#251) archived | keep, parked | ancestors of line-viewer; `docs/lines/viewer.md` | now (O6) |
| U19 | bookkeeping | `repo-inventory` deleted once this plan is approved (it is superseded); `plan` kept until the plan is done | — | — | after approval |
| U20 | one name per concept | every glossary pair listed in (a), the line branches included | a session per merged line: one row per concept on `main`, code renamed where two names mean one thing | each line's review | after M5 |
| U21 | one implementation per job | `client/view/store.js` vs `client/viewer/store.js` (two "stores"); #303 vs mainbase's onePass (keep mainbase's); experiment flags no line uses (`?view=page` vs `worker`, `span`, `waitAhead`, `?writer=`), each kept or removed by the owner | session: a list with evidence per flag, then removals one per PR | review | after M4 |
| U22 | archive | everything marked archive above | session: tag `archive/<name>` on the tip, push the tag, add one line to `docs/archive.md` (O7), delete the branch; run `scripts/check_links.py` | a second session checks each tag against its tip | `git ls-remote` shows the tag and no branch | M |
| U23 | line files | every file in `docs/lines/` | the session of each step updates its line's file; a last session checks all seven against git | — | every "last verified" date is after U22 | S |
| U24 | PR bodies | the 89 with a "Generated by" line | owner's yes (O14): a session edits those bodies; history is not rewritten | — | none left | S |

## (c) Owner decisions needed

| # | question (yes/no) | what yes changes |
| --- | --- | --- |
| O1 | Give PRs into `claude/core` CI, by adding it to `gate.yml`'s branch lists (D1)? | Every demo PR gets `decoders`, `gate` and `deploy` before merging. No: the gate runs only locally, and the decoders are missing in cloud runs |
| O2 | Send the OQ work to core as one PR (D3's branch, carrying #320, #321, #327, #328), closing those as carried? | One merge word instead of four |
| O3 | Run the demo from `dev-server.py` on the laptop, leaving pairs in the web image (`deploy/nginx`) for after the demo? | No nginx change before Friday; `main` stays deployable for unpaired series |
| O4 | Let `core` reach `main` by 11-13 without #289, #299, #302 and #262? Their fixes are off the product's default path (`?view=page`, no writer): lab URLs, the native view and the Firefox harness. They follow in M3 | The demo path avoids the one non-trivial conflict (`view.js`). No: M3 moves before D5, and D3's conflicts are resolved against #289 |
| O5 | Remove the 14 raw row files from `core` in D1, as #289 does? | They never enter `main` |
| O6 | Act on U1, U15 and U18 now (delete what is merged, close what says not to merge)? | About 20 PRs and branches gone before the demo |
| O7 | Put the archive index at `docs/archive.md`? | U22 can start |
| O8 | Keep `claude/av1-unified-mainbase` as the AV1 line's branch after it merges into `main`? | U9's PRs keep their base |
| O9 | Merge line-server before line-hygiene into `main`? | The 6-file conflict is resolved once, inside hygiene's test split |
| O10 | Keep #298 (asking policy) with #219 and #224 until you decide the policy? | They stay open |
| O11 | Native shape: merge #277, #278 and #211 onto core, or archive them; and #143 and `beeper-ebpf-explore`: a doc or archive? | U8 and U16 |
| O12 | Archive the pre-rebuild branches (U12), including `av1-mainbase`? | About 25 branches gone; `docs/av1/queue.md` on `main` stays their record |
| O13 | Close line-pacs's 48 carried PRs now, keeping #258? | 48 fewer open PRs; #258 still cites each by commit |
| O14 | Strip the "Generated by" lines from the 89 PR bodies? | Bodies edited; commits untouched |

## (d) Risks to the demo

| risk | cheapest mitigation |
| --- | --- |
| No real pair has run in a browser; CI has never run on any OQ branch | D1 first (CI), then D6 a day before D7 |
| The phone section serves one series, not a pair | D4; D7 on the phone a day early |
| The phone's Chrome or the laptop's lacks WebCodecs AV1 at 10 bits, so dav1d is used | the overlay shows `path`; D7 records it; dav1d still shows the view, only slower |
| "Optimal quality" read as "proven visually lossless" | say it in the demo: Q 8 is the noise rule's candidate on DBT, and readers have not confirmed it; Lossless is one key away |
| D8 finds a blocker in #250 too late | demo from D7's recorded commit; `main` waits |
| The web image cannot serve a pair | O3: the demo runs from `dev-server.py` |
| Q 0 passes `lossy_args` and gets labelled lossy | D2 refuses it; the demo uses only Q 8 and Q 24 |
| The local gate fails without built decoders, and sessions misread it | every brief says to build `client/decode/wasm/build/build.sh` first, or rely on CI (O1) |
| Merges into core land after 11-12 08:00 | D6 and D7 shrink to `dbts_b1` (10-bit, no cut) and `dbts_a1` (cut) at Q 8, G 1 |

## (e) Unsure

* **UNSURE**: whether headless Chromium in a cloud run decodes AV1 through WebCodecs. The depth-cut browser test
  says yes for its fixture (64×48, 8 frames); real 10-bit DBT sizes have not been tried.
* **UNSURE**: why `run_browser.sh`'s "exact" checks fail in this container on `main` too. The missing decoder build
  is the likely cause, but it was not traced.
* **UNSURE**: whether #299's double decode reaches the default page view. If it does, O4's answer may change.
* **UNSURE**: whether `av1-mainbase`'s `docs/av1/queue.md` is still read (U12).
* **UNSURE**: whether `av1-residual-exact` (#315) has any use now that the residual is dropped (U10).
* **UNSURE**: which of the 34 `archive/*` tags is new since the inventory counted 33; the tags are lightweight and
  carry no date.
* **UNSURE**: whether the depth-cut fixture's `metadata.json` (`max` 4095 against 10-bit codes) misleads any reader
  of `meta.max` other than the controller.

Fixtures behind every number here: the three EA1141 DBT volumes `dbts_a1`, `dbts_b1` and `dbts_c1` (12, 10 and 12
bits; 56, 50 and 69 frames), the 19 DBT and 2 TRUS series of the quality runs, the synthetic depth-cut payloads and
`fixtures/us_cine_smoke`. All runs were on 4-core cloud hosts without a GPU, and none was timed for this plan.
