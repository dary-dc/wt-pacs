state: done
started: 2026-11-11 17:51
heartbeat: 2026-11-11 18:20
outputs: `claude/dataset-hub` 4200d599 (docs only, from `claude/demo-fixes-2`; no PR, as the row says)
## Resume
Done. `docs/reviews/dataset-hub.md` written; `docs/lines/codecs.md` §Open item 5 added on the same branch.
## Result
* What is coded again per session: the 23 demo series (368 MB, 637–689 s on 4 cores plus the tool build); the
  sources already have one place (IDC's bucket and two Zenodo records, pinned in `lab/av1/data.json`).
* Key: a recipe (source pin and sourceFingerprint, `ingest/tools.sh`'s pins, tree hashes of the code that writes the
  bytes, Q/G/cut/preset) hashed; a pin file maps it to each file's SHA-256 and location, so the host is untrusted.
* Hosts weighed with quoted limits: release assets (lead: free, no bandwidth limit, 2 GiB a file, curl only), Git
  LFS (10 GiB a month of reads on Free, ~27 full fetches), container registry (free public, digest-addressed),
  Zenodo (DOI, frozen versions, 100 files), a model hub, a paid bucket. Plain git is out: 100 MiB file limit,
  the exact `dbts_b1` bundle is 107 MB.
* Licences: EA1141 CC BY 4.0 allows sharing coded series with the modification indicated, the licence linked and the
  DOI cited (TCIA policy); four CC BY 3.0 sets not checked.
* Not measured: whether the same recipe gives the same digests on another host (only byte counts matched, two
  cloud hosts). That decides whether a session can verify a hosted set by re-coding one series.
* Fixtures: the three EA1141 DBT volumes and their 23 demo series; 4-core cloud hosts without a GPU.
* Owner decisions: (1) adopt the hub, and which host; (2) whether to issue a write token (contents: write) for
  sessions to upload, or upload from a machine that has the files.
