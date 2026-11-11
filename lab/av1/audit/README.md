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
