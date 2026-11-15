# Audit protocols, run (row MEASURE-1)

The runs of [`docs/av1/audit-protocols.md`](../../../docs/av1/audit-protocols.md); results under its §Measured.

**B0** (zero encodes), from a clone with every branch fetched:

```bash
IN=$(mktemp -d)
for k in 1 2 3 4; do git show 2f04f648:lab/av1/metrics/rows/shard-$k.jsonl > $IN/shard-$k.jsonl; done
git show 991c298b:lab/av1/metrics/rows/noise-point/arms.jsonl > $IN/arms.jsonl
curl -sS 'https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/common/quant_common.c?format=TEXT' \
  | base64 -d > $IN/quant_common.c
python3 lab/av1/audit/b0.py $IN lab/av1/audit/rows/b0.json                # the check must hold (exit 0)
python3 lab/av1/audit/b0.py $IN /dev/null --mutate-8bit                   # the mutation must fail it (exit 1)
```

**B** (the shared cells, B1, B2; amendment 1), from a clone with every branch fetched:

```bash
git worktree add --detach ../gs 0e0e58c8                         # the groups code, run unchanged
(cd ../gs && BUILD=$PWD/lab/.av1-build ingest/tools.sh && OUT=$HOME/data lab/av1/fetch_data.sh \
  dbts_a1 dbts_a2 dbts_a3 dbts_a4 dbts_a5 dbts_b1 dbts_b2 dbts_b3 dbts_b4 dbts_b5 dbts_c1 dbts_c2 dbts_c3 dbts_c4 dbts_c5 \
  dbt12_c dbt12_ea1141 dbt10_d dbt10_ea1141 && lab/av1/.venv/bin/pip install --require-hashes -r lab/av1/profiles/requirements.txt)
export GROUPS_DIR=$PWD/../gs/lab/av1/groups BUILD=$PWD/../gs/lab/.av1-build DATA=$HOME/data WORK=$HOME/work \
  PY=$PWD/../gs/lab/av1/.venv/bin/python
MUTATE=1 lab/av1/audit/b.sh      # the check's mutation: exit 0 only when --cpu-used=5 differs from the study
lab/av1/audit/b.sh 1             # G 1 (about 3 h on 4 cores); rerun to resume
lab/av1/audit/b.sh 16            # G 16 (about 2.5 h)
```
