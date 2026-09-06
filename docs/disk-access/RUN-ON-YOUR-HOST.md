# Run the read-path campaign on your own host

**Why:** risk **R1** in [`SCOREBOARD.md`](SCOREBOARD.md). Every published number here comes
from one 4-vCPU KVM guest, and two properties of that host generate the result — a ~34 µs
`spawn_blocking` round trip and an 8 MiB read-ahead window. Neither has been shown to hold
anywhere else, which makes this the largest open unknown in the investigation.

You do not need to trust that framing to run this. The comparison script answers it
mechanically: it prints **HOLDS / WEAKENS / FLIPS** for every regime.

There are two ways to get a second host. This doc is the second one.

| | Runs where | Data quality | Setup |
| --- | --- | --- | --- |
| [`.github/workflows/read-campaign.yml`](../../.github/workflows/read-campaign.yml) | GitHub-hosted runner | Direction only — shared, noisy vCPU | push a tag (below) |
| **This doc** | **Your machine or deployment host** | **Best — real hardware, quiet** | ~5 min |

### Starting the CI run

**Touch the trigger file and push.** From this branch:

```bash
date -u >> .github/campaign-trigger
git commit -am 'run the read-path campaign'
git push
```

The run appears under **Actions** within a few seconds and commits its results back to
`claude/disk-access-adr-validation-saz6m8`. A push only starts the workflow when
`.github/campaign-trigger` is in the diff, so ordinary commits never spend runner minutes.

**Why not the "Run workflow" button?** GitHub only lists `workflow_dispatch` workflows that
exist on the repository's **default branch**. While this file lives only on a feature branch
it will not appear in the Actions sidebar and cannot be dispatched from the UI. Once the
branch merges to `main` the button works and the trigger file becomes optional.

The best host to run this on is **the one you will deploy to**. It answers R1 and the
filesystem question at the same time.

## What it needs

* Linux, x86_64, ≥2 GB RAM, ~250 MB free disk
* Rust (`rustup`), `git`, `python3`, `bash`
* **No root.** `read_campaign` needs no privileges; only the separate memory-pressure
  campaign does, and that is not part of this
* ~3 minutes: the build dominates, the campaign itself is well under a minute

## Give this to a local Claude Code session

Open Claude Code in a clone of this repo and paste:

> Run the read-path campaign on this host to close risk R1, following
> `docs/disk-access/RUN-ON-YOUR-HOST.md`. Check out the branch
> `claude/disk-access-adr-validation-saz6m8` first. Record the host facts, run all phases,
> then run `compare_hosts.py` against `docs/disk-access/v10_campaign.tsv` and tell me whether
> each row HOLDS, WEAKENS or FLIPS. Commit the TSV, the host facts and the comparison to that
> branch and push. Use `run1` as the label; if a `run1` from this host is already committed,
> use `run2`. Do not edit any existing TSV.

Then read back the **hop tax ratio** and the **ranking table** — those two are the answer.

## Or run it by hand

```bash
git clone https://github.com/dary-dc/wt-pacs && cd wt-pacs
git checkout claude/disk-access-adr-validation-saz6m8
cargo build --release -p disk-access-bench -p check-fastpath

# 1. Host facts FIRST — a number without its host is not evidence.
LABEL=run1                                   # run2 if this host already has a run1
HOST=$(hostname -s)
FACTS=docs/disk-access/v23_campaign_${HOST}_host.txt
{ echo "date            $(date -u +%FT%TZ)"
  echo "kernel          $(uname -srm)"
  echo "nproc           $(nproc)"
  echo "cpu             $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | xargs)"
  echo "mem_mb          $(free -m | awk '/^Mem:/{print $2}')"
  echo "fs(workspace)   $(findmnt -no FSTYPE,SOURCE --target "$PWD")"
  for q in /sys/block/*/queue/read_ahead_kb; do        # skip loop/zram noise
    d=$(basename $(dirname $(dirname "$q")))
    case "$d" in loop*|zram*|ram*) continue;; esac
    [ -r "$q" ] && echo "read_ahead_kb   $d = $(cat "$q")"
  done
} | tee "$FACTS"

# 2. Does this host even have the fast path? (see DEPLOYMENT.md)
./target/release/check-fastpath lab/fixtures || true

# 3. Fixture — 84 MB, generated, never committed.
NAME=frames_16k_big BYTES=16384 FRAMES=5120 ./lab/scripts/gen_live_cell_fixture.sh

# 4. The campaign.
OUT=docs/disk-access/v23_campaign_${HOST}.tsv
BIN=./target/release/read_campaign
ST=lab/fixtures/frames_16k_big/frames_16k_big.sbnd
: > "$OUT"; FIRST=1
run() { local l="$1"; shift; local h=--no-header
  [ "$FIRST" -eq 1 ] && { h=; FIRST=0; }
  $BIN --study "$ST" --label "${LABEL}_${l}" --asks 512 --repeats 6 $h "$@" >> "$OUT"; echo "  ok: $l"; }

run A_stride --arms pool,uring,hybrid,pooled_pread --depths 1,2,4,8,16,32,64 --temps cold,warm --stride 250000 --monitors 0
run A_sweep  --arms pool,uring,hybrid,pooled_pread --depths 1,2,4,8,16,32,64 --temps cold,warm --stride 16384  --monitors 0
run B_prefetch_stride --arms pool,hybrid,uring --prefetch off,on --depths 1,4,16 --temps cold --stride 250000 --monitors 0
run B_prefetch_sweep  --arms pool,hybrid,uring --prefetch off,on --depths 1,4,16 --temps cold --stride 16384  --monitors 0
run C_readers --arms pool,uring,hybrid --readers 1,4,16 --depths 1,4 --temps cold --stride 250000 --monitors 0
for sz in 4096 65536 250000; do
  run "D_size${sz}" --arms pool,hybrid,uring --depths 1,16 --temps cold,warm --size "$sz" --stride 250000 --monitors 0
done
run E_safety --arms pool,uring,hybrid,pooled_pread --depths 1,16 --temps cold,warm --stride 250000 --monitors 1

# 5. The answer.
CMP=docs/disk-access/v23_campaign_${HOST}_compare.txt
python3 lab/scripts/analyze_read_campaign.py "$OUT" | tee    "$CMP"
python3 lab/scripts/compare_hosts.py docs/disk-access/v10_campaign.tsv "$OUT" \
        lab-kvm "$HOST" | tee -a "$CMP"

# 6. Push.
git add "$OUT" "$FACTS" "$CMP"
git commit -m "lab(disk-access): read-path campaign on $HOST (R1 second host)"
git push -u origin claude/disk-access-adr-validation-saz6m8
```

Run it **twice** on the same host if you can (`LABEL=run2` the second time, appending to the
same TSV). One run gives a median; two give an error bar, and the analysis script's
reproduction section then reports run-to-run drift — which is the only honest way to know
whether a difference is real. See [`RERUN.md`](RERUN.md) §Precision.

## Reading the result

`compare_hosts.py` prints three sections. The first two are the ones that matter.

**1. Hop tax.** The median `pooled_pread − pool` gap on warm cells — one `spawn_blocking`
round trip, measured directly rather than inferred. The lab host reads **34 385 ns**.

| Your host | Meaning |
| --- | --- |
| within ~2× | The constant transfers; the campaign's premise holds here |
| far smaller | The thread-pool hop is cheap on this machine, so **the whole argument for the ring weakens** — the recommendation would need re-deriving |

**2. Ranking.** Per regime × reads-in-flight:

| Verdict | Meaning |
| --- | --- |
| `HOLDS` | Same direction, comparable size — the conclusion travels |
| `tie both` | Inside drift on both hosts — no claim was made here |
| `WEAKENS` | Same direction, materially smaller — note it, do not panic |
| **`FLIPS`** | **Opposite direction. The recommendation is a property of the lab host.** Stop and re-open the decision |

**3. Absolute cost.** Magnitudes side by side. Expect these to differ — different CPU,
different disk. Only compare arms *within* a host, never across.

## Already measured

| Host | Hop tax | Ranking | Note |
| --- | ---: | --- | --- |
| lab KVM guest (baseline, [`v10_campaign.tsv`](v10_campaign.tsv)) | 34 385 ns | — | 4 vCPU Xeon 2.1 GHz, ext4, read-ahead 8192 |
| agent sandbox ([`v21_campaign_sandbox.tsv`](v21_campaign_sandbox.tsv)) | 26 275 ns (0.76×) | 20 HOLDS · 1 WEAKENS · **0 FLIPS** | **Same host class**, so a reproduction — not an independent host |
| GitHub runner ([`v22_campaign_ci.tsv`](v22_campaign_ci.tsv)) | 23 648 ns (0.69×) | 13 HOLDS · 6 WEAKENS · 5 tie · **0 FLIPS** | AMD EPYC 9V74, Azure kernel 6.17, **read-ahead 128 KiB** — different CPU vendor *and* the stock window. All eight `miss` rows hold (−44.6% to −76.3%). Five of the six WEAKENS are `mix` rows, where the smaller read-ahead window is the likely cause |
| Bare-metal laptop ([`v23_campaign_laptop-btrfs.tsv`](v23_campaign_laptop-btrfs.tsv)) | 24 470 ns (0.71×) | 11 HOLDS · 5 WEAKENS · 1 STRENGTHENS · **1 FLIPS** · 4 tie · 2 no-data | The quiet host. Intel i5-8250U, **btrfs-on-LUKS** (`RWF_NOWAIT` honoured — new), stock read-ahead. All eight `miss` rows at 4+ in flight hold. The one FLIPS is `hit/16/uring`, and it is **R8, not a read-path result**: `hit/16/hybrid` STRENGTHENS by the same amount at the same cell because both use the ring-shaped reader loop. Its btrfs mount has `compress=zstd:1` and the fixture is one repeated byte, so its cold magnitudes are host-specific |

The sandbox row is worth exactly what it says: the pipeline works end to end and nothing
flipped on a fresh instance. It is **not** a second host — same 4-vCPU Xeon, same ext4, same
8 MiB read-ahead.

The GitHub-runner row **is** a host change, and the useful one: a different CPU vendor and
the stock 128 KiB read-ahead rather than this campaign's 8 MiB. Nothing flipped there either,
and the hop tax that the whole argument rests on came back at 0.69× the lab's. What shrank
was the `mix` regime — unsurprising, since a 64× smaller read-ahead window changes which
cells land in "5–50% miss" at all, so those rows are not strictly like-for-like.

The laptop row closed that gap — a quiet, single-user bare-metal host on a third filesystem.
**R1 is closed**: across four hosts, two CPU vendors, VM and bare metal, ext4 / btrfs, the
`spawn_blocking` round trip is 24–34 µs and no `miss` row flipped anywhere.

Two things are worth carrying forward from these runs rather than the hop tax:

* **Read the `hit` rows as R8, not as a read-path result.** `pool` and `hybrid` reach a cache
  hit through different reader loops, so that regime measures loop shape. `lab/scripts/loop_shape_control.py`
  sizes it for any campaign TSV.
* **Record the filesystem's compression setting.** btrfs with `compress=zstd` plus this
  fixture's single repeated byte makes cold reads move almost no physical bytes. `check-fastpath`
  reports the filesystem; the mount options belong in the host-facts file beside it.
