state: done
started: 2026-11-12T06:22Z
heartbeat: 2026-11-12T06:25Z
outputs: claude/direction 2987c96b (docs/lines/native.md, docs/lines/README.md's row), no PR (the owner reviews claude/direction on Friday)
## Resume
Done. Taken by the session started for DIRECTION-METADATA, which another session had claimed at 06:21Z.
## Result
* native.md in the six parts, verified against the demo tip 18d2d1ff, MERGE-PLAN, LINES-READY, EXPERIMENTS-OFF,
  PRE-MAIN-REVIEW and the inventory. check_links.py: 0 unresolved; comment budget OK. No gate run (docs only).
* Corrected in place: the image build is fixed (core-ci-deploy copies client/native), so the old Open 1 is gone;
  lab/native-fill and native_cache_cells.sh are off the tip (3a4a5922), runs pinned at 0920153d and a237cf3e.
* New open item 1: the window's lab settings (--cine-hz, --busy-ui-ms, --steps, --steps-via, --stamp-painted) sit
  inside client/native, which the cleaning rule forbids in product modules; EXPERIMENTS-OFF item 10 did not check them.
* Open ranked after it: keep/off main (item 10), NATIVERUN (never run, runner owed), M4 on a phone, M1/M2 on a GPU,
  #277/#278/#211, docs/native/README.md §7's decisions, two untraced findings, N2/N3.
* Fixtures: cloud 4-vCPU containers without a GPU, synthetic and committed series, the three DBT volumes; no phone
  or GPU native run exists.
* Owner decisions: EXPERIMENTS-OFF item 10 (client/native keep on main or off); the window's lab settings moved
  (yes/no, after an inventory row); #277, #278, #211 merge or close; §7's cache policy, intended use, distribution.
