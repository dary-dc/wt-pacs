# IWDEEP — the 32-packet initial window behind phone-sized buffers

Row 181 runs row 167's protocol IWDEEP ([`../../docs/transport/link-conditions.md`](../../docs/transport/link-conditions.md)
§Re-measured, proposed); the reading and its verdict are there, under that item's *Measured*.

```bash
RELAY_PREFIX="chrt -f 50" WARM=60 RATES="0 18000 103000 309000" lab/scripts/first_ask_cells.sh ceiling 3
RELAY_PREFIX="chrt -f 50" OUT=$PWD/lab/iwdeep/rows.jsonl RATES=18000 lab/scripts/first_ask_cells.sh iwdeep 10
python3 lab/iwdeep/summary.py lab/iwdeep/rows.jsonl
```

`ceiling` is the relay's delivered rate on a 15 MB fill at 2 ms; `iwdeep` is the four arms (a fresh ask-only session
and a push-opened one, each at quinn's 12 000 bytes and at 38 400), Williams-ordered, one JSON row a run in
`rows.jsonl`. Every delivered frame is compared with its source file (`first_ask --expect-dir`); a run that fails it
records no time.
