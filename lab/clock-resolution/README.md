# clock-resolution

The resolution of `performance.now()` in headless Chromium under the static host's cross-origin isolation
(`server/dev-server.py` sends COOP/COEP): the smallest nonzero step of 200 000 back-to-back reads. The reading
and why a one-tick difference is not a finding are in [`docs/rig-limits.md`](../../docs/rig-limits.md) §6,
*The clock floor*.

```bash
pip install playwright && playwright install chromium   # or CHROME_PATH=<a Chromium>
python3 lab/clock-resolution/measure_clock_resolution.py
```

It prints the result and writes `.local/measurements/clock-resolution-local.json`; it exits 2 if the page was
not cross-origin isolated and 3 if no step was seen.
