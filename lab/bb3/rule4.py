"""Cell 4 of docs/transport/bb3-protocol.md against its rule: bbr-bound's time to every frame on the page over bbr's
on the lossy cells (bar 1.10) and over cubic-restart's on the clean and jitter cells (bar 1.01), per codec, link and CPU.

    python3 lab/bb3/rule4.py lab/bb3/cell4-losscc.jsonl [--with-void]
"""
import json, statistics, sys

rows = [json.loads(l) for l in open(sys.argv[1])]
with_void = "--with-void" in sys.argv
CODECS = {"htj2k": ("htj2k", "htj2kbbr", "htj2kbound"), "AV1": ("opt", "optbbr", "optbound")}
LINKS = ("r5000", "r20000", "r50000", "lte-good")
at = {(r["round"], r["variant"], r["link"], r["impairment"], r["throttle"]): r for r in rows
      if (with_void or not r["void"]) and r["exact"] == r["owed"] and not r["failures"]}
print(f"{len(rows)} visits, {sum(r['void'] for r in rows)} VOID, rounds {sorted({r['round'] for r in rows})}; "
      f"{'VOID counted' if with_void else 'VOID dropped'}; median of round-paired ratios [range] (n)\n")
print("| codec | CPU | cell | " + " | ".join(LINKS) + " |")
print("| --- | --- | --- | " + " | ".join("---" for _ in LINKS) + " |")
fails = []
for codec, (cubic, bbr, bound) in CODECS.items():
    for th in (1, 4):
        for imp in ("clean", "j20", "l1", "l2", "l5"):
            ref, bar = (bbr, 1.10) if imp.startswith("l") else (cubic, 1.01)
            cells = []
            for link in LINKS:
                rs = [at[k]["decodedMs"] / at[(k[0], ref) + k[2:]]["decodedMs"] for k in at
                      if k[1] == bound and k[2:] == (link, imp, th) and (k[0], ref) + k[2:] in at]
                if not rs:
                    cells.append("—")
                    continue
                m = statistics.median(rs)
                if m > bar:
                    fails.append(f"{codec} {th}x {link} {imp} {m:.3f}")
                cells.append(f"{'**' if m > bar else ''}{m:.3f}{'**' if m > bar else ''} [{min(rs):.2f}–{max(rs):.2f}] ({len(rs)})")
            print(f"| {codec} | {th}× | {imp} ÷ {'bbr' if ref == bbr else 'cubic-restart'} | " + " | ".join(cells) + " |")
print(f"\nover the bar (lossy > 1.10 x bbr, clean and j20 > 1.01 x cubic-restart): {len(fails)}" + ("".join(f"\n  {f}" for f in fails)))
