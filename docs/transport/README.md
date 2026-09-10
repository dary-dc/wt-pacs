# Transport

What this lane decided. Product source is the chunked send path, `--stream-mode`
default `shared`, `--prefault true`, Cubic default.

**Start here:** [`transport-conclusions.md`](transport-conclusions.md).

| Decision | What shipped |
| -------- | ------------ |
| **One shared stream** | `--stream-mode` defaults to `shared`. `per-frame` stays a product flag |
| **Chunked send** | `Bytes` view of the study mapping + `write_all_chunks` — no full-frame copy |
| **Prefault** | Fault frame pages off the executor (`--prefault true`) |
| **Cubic default** | Congestive loss → Cubic; radio loss → BBR. Default Cubic until the mix is measured |
| **Windows** | Left at quinn defaults. Memory is bounded by the send path, not `send_window` |
| **Runtime shape** | `--workers` defaults to one endpoint per core, each on its own single-threaded runtime over an `SO_REUSEPORT` socket. A session never changes thread |

Rejected arms (`copy` / `split`, `--ask-priority`, MTU / GSO / socket knobs) are not in
`server/`. GSO 10 → 32 was measured, not applied: the cap lives in quinn, and on the
real path it did not move the needle.

## Read next

| Doc | What |
| --- | ---- |
| [`why-these-changes.md`](why-these-changes.md) | Why each decision exists |
| [`adr-quic-stream-receive-window-defaults.md`](adr-quic-stream-receive-window-defaults.md) | Keep quinn window defaults; do not equalise S vs P/Q |

## Evidence and lab (on the archive tag)

Campaign TSVs, lane plans, HANDOFF, netsim, aead-bench, and the historical drivers are
not on this tip. They live on tag **`archive/transport-lab-2026-09`**.

```bash
# restore the campaign tree (docs + lab/transport + extra fixtures/traces)
git checkout archive/transport-lab-2026-09 -- docs/transport lab/transport \
  lab/fixtures/frames_32k_160 lab/fixtures/frames_500x250k lab/fixtures/frames_500x64k \
  lab/traces/cine_forward_30fps.json lab/traces/cine_scrub_30fps.json \
  lab/traces/l1_one_way_80.json lab/traces/l1_one_way_160.json \
  lab/traces/r6_scrub_500.json lab/traces/radiologist_jump.json \
  lab/traces/radiologist_read.json lab/traces/radiologist_review.json \
  lab/traces/radiologist_review_500.json
# put lab/transport/aead-bench and lab/transport/netsim back in Cargo.toml
```

Checking out `docs/transport` from the tag overwrites these lean face files. Prefer
`git show archive/transport-lab-2026-09:docs/transport/<path>` to read evidence without
replacing the tip.

`docs/lanes/L1-loss-run.md`, `docs/lanes/L2-ask-policy.md`, and `docs/measurements/r2/`
(CAMPAIGN / TASK / ARCHIVE) stay on `main`'s paths.
