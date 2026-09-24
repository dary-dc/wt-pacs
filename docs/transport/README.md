# Transport

What this lane decided. On this branch the product source carries `--stream-mode` default
`shared`, Cubic default and quinn's window defaults. **Corrected 2026-09-23:** the transport
branch's server half (`claude/clever-curie-flm0wi`) is merged here — the pooled `Bytes` send path is
the tree's only send path, and the GSO patch and the PGO script are here **as build-time opt-ins**,
each re-checked on this box first ([`why-these-changes.md` §9](why-these-changes.md#9--cpu-per-byte-segments-per-sendmsg-a-profile-guided-build-one-copy-fewer),
*Re-checked on this tree*). Until then (2026-09-19 to 2026-09-22) this tree wrote each frame with
`write_all` in 64 KiB slices. `--prefault` is accepted but unused (`server/src/main.rs`), here and
on that branch.

**Target:** a browser on a mobile, lossy wireless link, thousands of sessions per server.
**Start here:** [`transport-conclusions.md`](transport-conclusions.md). **What is open, in order:** [`NEXT.md`](NEXT.md).

| Decision | What shipped |
| -------- | ------------ |
| **One shared stream** | `--stream-mode` defaults to `shared`. `per-frame` stays a product flag |
| **Chunked send** | The read buffer handed to quinn as `Bytes` (`media/frame_pool.rs`) + one `write_all_chunks` — no second copy. −3 to −8 % CPU per ask in every cell, 5–6/6 |
| **Prefault** | A no-op flag here and on the transport branch: the readers have no mapping to fault |
| **Cubic default** | Congestive loss → Cubic; radio loss → BBR. Default Cubic until the mix is measured |
| **Windows** | Left at quinn defaults. Memory is bounded by the send path, not `send_window` |
| **Runtime shape** | One endpoint on tokio's multi-thread runtime. Per-core endpoints were built and parked on `claude/per-core-endpoints`: they break a session whose 4-tuple changes (T6) |

| **CPU per byte** | Frames handed to quinn uncopied (default). A profile-guided build (`scripts/pgo_build.sh`, −13 to −18 % CPU per ask on top, no cell against) and the MTU-derived GSO cap (`patches/quinn-0.11.11-mtu-gso.patch`, −7 to −36 % CPU per ask) are **opt-ins at build time**: the cap takes 250 KB at depth 1 with four sessions from p99 1.9 to 27.5 ms (0/6), which is the product's shape today ([`NEXT.md`](NEXT.md) row 9) |

Rejected arms (`copy` / `split`, `--ask-priority`, `pool:k`, MTU / socket knobs) are not in `server/`.
The GSO cap lives in quinn; `cargo build --release -p exact-server --config 'patch.crates-io.quinn.path="patched/quinn"'`
applies it at build time from crates.io plus that patch, and the gate checks the patch still applies.

## Read next

| Doc | What |
| --- | ---- |
| [`why-these-changes.md`](why-these-changes.md) | Why each decision exists |
| [`adr-quic-stream-receive-window-defaults.md`](adr-quic-stream-receive-window-defaults.md) | Keep quinn window defaults; do not equalise S vs P/Q |
| [`ask-during-fill.md`](ask-during-fill.md) | An ask does not overtake a running fill — it ends one. What that costs, and why stream priority does not arise |
| [`why-these-changes.md` §10](why-these-changes.md#10--latency-and-throughput-on-one-tree-where-they-part-and-what-joins-them) | Where latency and throughput part, and the open proposals (client window, depth-1 tail, 44-segment cap, workers, LTO) |
| [`NEXT.md`](NEXT.md) | What is still open, ranked for the target |

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
