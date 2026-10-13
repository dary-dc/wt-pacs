"""M-Lab NDT daily country statistics, one year (docs/transport/link-conditions.md §M-Lab).

Reads `histogram_daily_stats.json` files from statistics.measurementlab.net/v0/<continent>/<country>/<year>/
and prints the median over days of each day's quartiles; NDT mixes fixed and mobile access.
"""
import json
import statistics
import sys

FIELDS = ["download_Q25", "download_MED", "download_Q75", "download_minRTT_MED",
          "upload_Q25", "upload_MED", "upload_Q75"]


def summarize(path):
    rows = json.load(open(path))
    days = {r["date"]: r for r in rows}
    tests = sum(r["dl_samples_day"] for r in days.values())
    first = next(iter(days.values()))
    print(f"{first['country_code']} {first['year']}: {len(days)} days, {tests} download tests")
    for f in FIELDS:
        unit = "ms" if "RTT" in f else "Mbit/s"
        print(f"  {f:20s} {statistics.median(r[f] for r in days.values()):8.1f} {unit}")


if __name__ == "__main__":
    for path in sys.argv[1:]:
        summarize(path)
