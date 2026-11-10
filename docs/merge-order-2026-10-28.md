# Merge order, 2026-10-28 — not to merge

The branches of 2026-10-27/28, merged one at a time with `git merge --no-ff` onto a local scratch branch from
`claude/av1-unified-mainbase` at `ea581aca`, bases before children, each conflicting merge recorded and aborted.
`claude/native-fill` does not exist on the remote and is left out. The older PRs the new ones stack on were merged
first: #141, #124, #132, #121 (the base of #135) and #135. Reviews are the "Independent review" comments on each PR; no
PR has a formal GitHub review or a Claude Approvals check.

## The table

"After" names the PRs already merged in the scratch run when this one went in; "alone" means its own stack on
unified is enough. Conflicts with unified are those met in that run; conflicts with `main` are against `main` with
#112 (`claude/test-separation`) merged in, which itself merges cleanly, as does unified onto it.

| branch | PR | base | merges cleanly into unified after | conflicts with (unified run) | conflicts with main + #112 | gate on the combined tree | review verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `av1-frame-groups-record` | #141 | unified | alone | — | — | in the tree | no review |
| `gop-gaps` | #186 | #141 | #141 | — | — | in the tree | fixed in place; §5b–§5d left to the owner |
| `gop-pcs-note` | #194 | #186 | #141, #186 | — | — | in the tree | fixed in place (a misquote, a wrong pointer) |
| `gop-data-search` | #192 | unified | alone | — | — | in the tree | fixed in place; owner to decide whether to send the requests |
| `design-opfs-cache` | #124 | unified | alone | — | — | in the tree | no review |
| `opfs-persist-sources` | #132 | #124 | #124 | — | — | in the tree | no review |
| `opfs-multigb` | #187 | #132 | #124, #132 | — | — | in the tree | 5 claims fixed; 3 unstated rules left to the owner |
| `opfs-cache-build` | #197 | #187 | #124, #132, #187 | — | — | in the tree | a removal race fixed, with a test |
| `opfs-cache-measure` | #204 | #197 | #124, #132, #187, #197 | — | — | in the tree | **blocker: the raw rows are not committed** |
| `client-audit-r5` | #188 | unified | alone | — | — | in the tree | audit holds; 6 corrections in place |
| `client-simplify-r5` | #202 | #188 | #188 | — | — | in the tree | one doc line fixed; nothing lost |
| `jxl-single-frames` | #195 | unified | alone | — | — | in the tree | 2 wrong claims fixed in place |
| `design-p2-ask-during-fill` | #121 | unified | alone | — | — | in the tree | no review |
| `ask-during-fill-measure` | #135 | #121 | #121 | — | 9 files: `scripts/gate.sh`, `server/README.md`, the telemetry absence check, `server/src/main.rs`, and the transport's `lab_levers`, `link`, `pipeline`, `planner`, `server` | in the tree | no review |
| `scroll-policies` | #203 | #135 | #121, #135 | — | as #135 (it carries it) | in the tree | verdicts upheld after recomputation |
| `coldrtt-hint` | #208 | unified | alone | — | — | in the tree | no defect; two items open for the owner |
| `viewer-requirements` | #193 | unified | alone | — | — | in the tree | 5 findings fixed; its CI gate is red on a port-race flake, not re-run |
| `viewer-survey` | #191 | unified | alone | — | — | in the tree | 4 cells fixed; 3 claims not verifiable |
| `viewer-integration` | #196 | #191 | #191 | — | — | in the tree | 5 findings fixed; line counts left to the owner |
| `viewer-architecture` | #199 | #196 | #191, #196 | — | — | in the tree | 4 findings fixed; thresholds left to the owner |
| `viewer-spike` | #214 | #199 | #191, #196, #199 | — | — | in the tree | verdict A upheld — **a spike, not for the product** |
| `server-audit-r5` | #190 | unified | alone; **not after #188** | `docs/merge-readiness.md` with #188: both add a "Fifth round" section at the same place | — | **not in the tree** | audit holds; corrections in place |
| `server-simplify-r5` | #200 | #190 | #190 | as #190 (it carries it) | — | **not in the tree** | a stale line fixed; owner to confirm the lab removals |
| `native-wire` | #189 | unified | alone | — | — | in the tree | all sources hold |
| `native-core-1` | #198 | #189 | #189; **not after #135** | `server/src/transport/link.rs`, `server.rs` with #135: #135 adds the lab-only `Media::SharedAsksApart` and an `ask_stream` argument; #198 turns `Media::Shared` into the `QuicSend` of either transport | `common/fod/src/lib.rs`, the transport's `lab_levers`, `link`, `server`, `wire` | **not in the tree** | an accept-loop spin fixed; mutants killed |
| `native-core-2` | #201 | #198 | #189, #198 | as #198 (it carries it) | as #198 | **not in the tree** | bit-exact 109/109; all 10 mutants killed |
| `native-cache` | #209 | #201 | #189, #198, #201; **not after #197 or #206** | as #198, and `docs/adr/exactness-in-production.md` with #197: both rewrite the opening of "A client cache"; with #206, the native crate's `lib.rs` and `docs/native/README.md` (both add a module line, a bullet and a status line) | as #198 | **not in the tree** | a concurrent-writer defect fixed, with a test |
| `native-paint` | #206 | #201 | #189, #198, #201; **not after #209** | as #198; with #209 as above | as #198 | **not in the tree** | 3 defects fixed; "exact" holds on the software renderer only |

Each line merges cleanly on its own except native, whose two siblings #209 and #206 conflict with each other. The
`merge-readiness.md` and #206/#209 conflicts keep both sides; the #135/#198 one is code and needs a hand: `SharedAsksApart`
carried onto `QuicSend`, or #135's lab lever dropped.

## The gate on the combined tree

The combined tree is unified plus the 22 merges that applied (the 17 listed branches in the tree and the five older
bases), without #190, #200, #198, #201, #209 and #206.

* `scripts/gate.sh --quick`: **failed** at the browser step `client/contract/run_browser.sh`: dispatch over TS
  164/171, the 7 failures being the "exact" checks of the frame check's package. The same command on unified
  unchanged, in the same container, fails with the same 7 and nothing else: this container has no decoder build
  (`client/decode/wasm/build/build.sh` needs docker) and so no hasher. Not caused by the merges; not proved either way
  for a host with the build.
* `scripts/gate.sh --quick --no-browser`: **GATE OK** in 320 s. Skipped by name: every browser step, the decoder
  builds and golden payloads, the ingest steps that need numpy, pydicom or `ingest/tools.sh`'s build, the web host's
  check (no nginx), the two absence checks.

## Recommended order

Within a line, bases first; the lines in this order, since the later ones carry the resolutions:

1. **Frame groups:** #141 → #186 → #194; #192 at any point.
2. **Singles:** #195, #208, #193 (re-run #193's red gate first).
3. **Viewer docs:** #191 → #196 → #199. **#214 is the spike: not for the product, never merged.**
4. **Client cache:** #124 → #132 → #187 → #197 → #204, the last once its raw rows are committed.
5. **Client audit:** #188 → #202.
6. **Server audit:** #190 → #200, resolving `docs/merge-readiness.md` by keeping both fifth-round sections, the
   client's first.
7. **Ask during a fill:** #121 → #135 → #203. Against `main` these carry the lab levers' 9-file conflict.
8. **Native:** #189 → #198 → #201 → #209 → #206. #198 takes the code resolution against #135; #209 the
   "A client cache" paragraph against #197; #206 keeps both sides against #209. This line also conflicts with
   `main` + #112 in 5 files.
